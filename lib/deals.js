const crypto = require("crypto");
const prisma = require("./prisma");
const stripe = require("./stripe-client");
const { resolveFeeBps, calculatePlatformFeeCents } = require("./fees");
const { appendHistory } = require("./deal-history");

const DAY_MS = 24 * 60 * 60 * 1000;

class SlotUnavailableError extends Error {}
class DealStateConflictError extends Error {}

function publicDeal(deal) {
  return {
    id: deal.id,
    status: deal.status,
    slotPriceCents: deal.slotPriceCents,
    platformFeeCents: deal.platformFeeCents,
    totalChargedCents: deal.totalChargedCents,
    currency: deal.currency,
    startsAt: deal.startsAt,
    endsAt: deal.endsAt,
    payoutEligibleAt: deal.payoutEligibleAt,
  };
}

async function ensureStripeCustomerId(user) {
  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name,
    metadata: { vybridgeUserId: user.id },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

function validateCreative(creative) {
  if (!creative || typeof creative !== "object") {
    return "Creative is required to book a slot";
  }
  if (!creative.fileUrl) {
    return "Creative fileUrl is required";
  }
  if (!creative.width || !creative.height) {
    return "Creative width/height are required";
  }
  if (!creative.mimeType) {
    return "Creative mimeType is required";
  }
  return null;
}

// Books a slot for an advertiser: resolves their fee tier, opens a
// platform-side PaymentIntent for slot price + fee (the escrow — no
// transfer_data, funds simply land in the platform's Stripe balance), and
// atomically claims the slot + creates the deal + attaches the creative.
//
// Order matters for correctness: the PaymentIntent is created BEFORE the DB
// write. At this point it hasn't been confirmed by the advertiser yet, so no
// money has moved — creating it early and cancelling it on conflict is safe.
// If we did it the other way around (DB write first, then Stripe call) a
// failed Stripe call would leave a booked slot with no way to pay for it.
async function createDeal({ advertiserId, slotId, creative }) {
  const advertiser = await prisma.user.findUnique({ where: { id: advertiserId } });
  if (!advertiser || advertiser.role !== "advertiser") {
    return { status: 403, body: { ok: false, error: "Only advertiser accounts can book slots" } };
  }

  const creativeError = validateCreative(creative);
  if (creativeError) {
    return { status: 400, body: { ok: false, error: creativeError } };
  }

  const slot = await prisma.slot.findUnique({ where: { id: slotId } });
  if (!slot) {
    return { status: 404, body: { ok: false, error: "Slot not found" } };
  }
  if (slot.status !== "active") {
    return { status: 409, body: { ok: false, error: "Slot is not available for booking" } };
  }

  const feeBps = await resolveFeeBps(advertiser.lifetimeAdvertiserSpendCents);
  const platformFeeCents = calculatePlatformFeeCents(slot.priceCents, feeBps);
  const totalChargedCents = slot.priceCents + platformFeeCents;
  const dealId = crypto.randomUUID();

  const customerId = await ensureStripeCustomerId(advertiser);

  const paymentIntent = await stripe.paymentIntents.create({
    amount: totalChargedCents,
    currency: slot.currency,
    customer: customerId,
    automatic_payment_methods: { enabled: true },
    metadata: {
      vybridgeDealId: dealId,
      vybridgeSlotId: slot.id,
    },
  });

  try {
    const deal = await prisma.$transaction(async (tx) => {
      const claimed = await tx.slot.updateMany({
        where: { id: slotId, status: "active" },
        data: { status: "booked" },
      });
      if (claimed.count === 0) {
        throw new SlotUnavailableError();
      }

      return tx.deal.create({
        data: {
          id: dealId,
          slotId: slot.id,
          publisherId: slot.publisherId,
          advertiserId: advertiser.id,
          slotPriceCents: slot.priceCents,
          platformFeeBps: feeBps,
          platformFeeCents: platformFeeCents,
          totalChargedCents: totalChargedCents,
          currency: slot.currency,
          durationDays: slot.durationDays,
          status: "created",
          statusHistory: [{ status: "created", at: new Date().toISOString(), actor: "advertiser" }],
          stripePaymentIntentId: paymentIntent.id,
          creatives: {
            create: {
              fileUrl: creative.fileUrl,
              width: creative.width,
              height: creative.height,
              mimeType: creative.mimeType,
              fileSizeBytes: creative.fileSizeBytes || 0,
              status: "submitted",
            },
          },
        },
      });
    });

    return {
      status: 201,
      body: {
        ok: true,
        deal: publicDeal(deal),
        clientSecret: paymentIntent.client_secret,
      },
    };
  } catch (err) {
    // Nothing was ever charged (PaymentIntent unconfirmed) — safe to cancel.
    await stripe.paymentIntents.cancel(paymentIntent.id).catch(() => {});

    if (err instanceof SlotUnavailableError) {
      return { status: 409, body: { ok: false, error: "Slot was just booked by someone else" } };
    }
    throw err;
  }
}

// approved -> live in one write: starts_at/ends_at/payout_eligible_at are
// derived from durationDays and PAYOUT_BUFFER_DAYS and set together with
// the status change, never in a follow-up update — a deal can never be
// "live" with a missing or stale ends_at/payout_eligible_at.
//
// The pending_approval -> live transition itself is guarded by a
// conditional updateMany (status: 'pending_approval' in the WHERE), so a
// publisher click racing the auto-approve cron (or two racing clicks) can
// only ever have one winner; the loser gets a 409 instead of double-writing
// history or re-deriving ends_at from a different "now".
async function approveCreative({ dealId, publisherId, actor }) {
  const deal = await prisma.deal.findUnique({ where: { id: dealId }, include: { creatives: true } });
  if (!deal) {
    return { status: 404, body: { ok: false, error: "Deal not found" } };
  }
  if (publisherId && deal.publisherId !== publisherId) {
    return { status: 403, body: { ok: false, error: "Not your slot" } };
  }
  if (deal.status !== "pending_approval") {
    return { status: 409, body: { ok: false, error: "Deal is not awaiting approval" } };
  }

  const payoutBufferDays = Number(process.env.PAYOUT_BUFFER_DAYS || 4);
  const now = new Date();
  const endsAt = new Date(now.getTime() + deal.durationDays * DAY_MS);
  const payoutEligibleAt = new Date(endsAt.getTime() + payoutBufferDays * DAY_MS);
  const latestCreative = deal.creatives[deal.creatives.length - 1];

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.deal.updateMany({
        where: { id: dealId, status: "pending_approval" },
        data: {
          status: "live",
          startsAt: now,
          endsAt: endsAt,
          payoutEligibleAt: payoutEligibleAt,
          statusHistory: appendHistory(deal, [
            { status: "approved", at: now.toISOString(), actor: actor || "publisher" },
            { status: "live", at: now.toISOString(), actor: "system" },
          ]),
        },
      });
      if (claimed.count === 0) {
        throw new DealStateConflictError();
      }

      if (latestCreative) {
        await tx.creative.update({
          where: { id: latestCreative.id },
          data: { status: "approved", reviewedAt: now },
        });
      }

      return tx.deal.findUnique({ where: { id: dealId } });
    });

    return { status: 200, body: { ok: true, deal: publicDeal(updated) } };
  } catch (err) {
    if (err instanceof DealStateConflictError) {
      return { status: 409, body: { ok: false, error: "Deal state changed concurrently — refresh and retry" } };
    }
    throw err;
  }
}

// pending_approval -> rejected: refunds the advertiser in full and frees
// the slot. The refund call happens BEFORE the DB write, with an
// idempotency key derived from the deal id, so if this function is retried
// after the refund succeeds but the DB commit doesn't, Stripe hands back
// the existing refund instead of refunding twice.
async function rejectCreative({ dealId, publisherId, reason }) {
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) {
    return { status: 404, body: { ok: false, error: "Deal not found" } };
  }
  if (publisherId && deal.publisherId !== publisherId) {
    return { status: 403, body: { ok: false, error: "Not your slot" } };
  }
  if (deal.status !== "pending_approval") {
    return { status: 409, body: { ok: false, error: "Deal is not awaiting approval" } };
  }

  const refund = await stripe.refunds.create(
    { payment_intent: deal.stripePaymentIntentId, reason: "requested_by_customer" },
    { idempotencyKey: "deal-reject-refund-" + dealId }
  );

  const now = new Date();
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.deal.updateMany({
        where: { id: dealId, status: "pending_approval" },
        data: {
          status: "rejected",
          stripeRefundId: refund.id,
          statusHistory: appendHistory(deal, [
            { status: "rejected", at: now.toISOString(), actor: "publisher", reason: reason || null },
          ]),
        },
      });
      if (claimed.count === 0) {
        throw new DealStateConflictError();
      }

      await tx.creative.updateMany({
        where: { dealId: dealId, status: "submitted" },
        data: { status: "rejected", rejectionReason: reason || null, reviewedAt: now },
      });

      await tx.slot.updateMany({
        where: { id: deal.slotId, status: "booked" },
        data: { status: "active" },
      });

      return tx.deal.findUnique({ where: { id: dealId } });
    });

    return { status: 200, body: { ok: true, deal: publicDeal(updated) } };
  } catch (err) {
    if (err instanceof DealStateConflictError) {
      return { status: 409, body: { ok: false, error: "Deal state changed concurrently — refresh and retry" } };
    }
    throw err;
  }
}

module.exports = {
  createDeal: createDeal,
  approveCreative: approveCreative,
  rejectCreative: rejectCreative,
  publicDeal: publicDeal,
};
