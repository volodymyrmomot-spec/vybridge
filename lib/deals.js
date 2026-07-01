const crypto = require("crypto");
const prisma = require("./prisma");
const stripe = require("./stripe-client");
const { resolveFeeBps, calculatePlatformFeeCents } = require("./fees");

class SlotUnavailableError extends Error {}

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
        deal: {
          id: deal.id,
          status: deal.status,
          slotPriceCents: deal.slotPriceCents,
          platformFeeCents: deal.platformFeeCents,
          totalChargedCents: deal.totalChargedCents,
          currency: deal.currency,
        },
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

module.exports = {
  createDeal: createDeal,
};
