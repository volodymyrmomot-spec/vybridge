const crypto = require("crypto");
const prisma = require("./prisma");
const stripe = require("./stripe-client");
const { resolveFeeBps, calculatePlatformFeeCents } = require("./fees");
const { appendHistory } = require("./deal-history");
const { PLATFORM_CURRENCY } = require("./currency");
const { uploadCreative } = require("./storage");
const {
  notifyBloggerNewOffer,
  notifyOfferAccepted,
  notifyOfferDeclined,
  notifyBloggerPublished,
} = require("./deal-emails");

class DealStateConflictError extends Error {}

// Mirrors lib/deals.js's publicDeal, plus the blogger-specific fields.
function publicBloggerDeal(deal) {
  return {
    id: deal.id,
    status: deal.status,
    slotPriceCents: deal.slotPriceCents,
    platformFeeCents: deal.platformFeeCents,
    totalChargedCents: deal.totalChargedCents,
    currency: deal.currency,
    publishedUrl: deal.publishedUrl,
    publishedAt: deal.publishedAt,
  };
}

function validateClickUrl(clickUrl) {
  if (!clickUrl || !/^https?:\/\//i.test(clickUrl)) {
    return "clickUrl is required and must start with http:// or https://";
  }
  return null;
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

  await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

// Sends an offer to a blogger for one of their channels: resolves the
// advertiser's fee tier, opens an escrow PaymentIntent for price + fee, and
// creates the deal + its attached creative (either an uploaded file or a
// text brief — never both). Mirrors lib/deals.js's createDeal step for
// step: validate cheaply first, upload (if any) before the PaymentIntent,
// PaymentIntent before the DB write, cancel it on any DB failure.
async function createBloggerOffer({ advertiserId, channelId, contentType, creativeFile, briefText, clickUrl, priceEuros }) {
  const advertiser = await prisma.user.findUnique({ where: { id: advertiserId } });
  if (!advertiser || advertiser.role !== "advertiser") {
    return { status: 403, body: { ok: false, error: "Only advertiser accounts can send offers" } };
  }

  if (contentType !== "ready_file" && contentType !== "brief") {
    return { status: 400, body: { ok: false, error: "contentType must be ready_file or brief" } };
  }
  if (contentType === "ready_file" && (!creativeFile || !creativeFile.buffer || !creativeFile.buffer.length)) {
    return { status: 400, body: { ok: false, error: "Upload a creative image" } };
  }
  if (contentType === "brief" && !(briefText && briefText.trim())) {
    return { status: 400, body: { ok: false, error: "Enter a brief for the blogger" } };
  }
  const clickUrlError = validateClickUrl(clickUrl);
  if (clickUrlError) {
    return { status: 400, body: { ok: false, error: clickUrlError } };
  }

  const priceCents = Math.round(Number(priceEuros) * 100);
  if (!Number.isFinite(priceCents) || priceCents <= 0) {
    return { status: 400, body: { ok: false, error: "Enter a price greater than 0" } };
  }

  const channel = await prisma.bloggerChannel.findUnique({ where: { id: channelId } });
  if (!channel) {
    return { status: 404, body: { ok: false, error: "Channel not found" } };
  }

  const feeBps = await resolveFeeBps(advertiser.lifetimeAdvertiserSpendCents);
  const platformFeeCents = calculatePlatformFeeCents(priceCents, feeBps);
  const totalChargedCents = priceCents + platformFeeCents;
  const dealId = crypto.randomUUID();

  const customerId = await ensureStripeCustomerId(advertiser);

  // Uploaded before the PaymentIntent — a failed upload should never leave
  // an unconfirmed PaymentIntent needing cleanup.
  let uploaded = null;
  if (contentType === "ready_file") {
    uploaded = await uploadCreative({ buffer: creativeFile.buffer, mimeType: creativeFile.mimeType });
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount: totalChargedCents,
    currency: PLATFORM_CURRENCY,
    customer: customerId,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    metadata: {
      vybridgeDealId: dealId,
      vybridgeBloggerChannelId: channel.id,
    },
  });

  try {
    const deal = await prisma.deal.create({
      data: {
        id: dealId,
        bloggerChannelId: channel.id,
        publisherId: channel.userId,
        advertiserId: advertiser.id,
        slotPriceCents: priceCents,
        platformFeeBps: feeBps,
        platformFeeCents: platformFeeCents,
        totalChargedCents: totalChargedCents,
        currency: PLATFORM_CURRENCY,
        durationDays: 0,
        status: "created",
        statusHistory: [{ status: "created", at: new Date().toISOString(), actor: "advertiser" }],
        stripePaymentIntentId: paymentIntent.id,
        creatives: {
          create: {
            contentType: contentType,
            fileUrl: uploaded ? uploaded.secureUrl : null,
            briefText: contentType === "brief" ? briefText.trim() : null,
            clickUrl: clickUrl,
            width: uploaded ? uploaded.width : null,
            height: uploaded ? uploaded.height : null,
            mimeType: contentType === "ready_file" ? creativeFile.mimeType : null,
            fileSizeBytes: contentType === "ready_file" ? creativeFile.buffer.length : null,
            status: "submitted",
          },
        },
      },
    });

    return {
      status: 201,
      body: { ok: true, deal: publicBloggerDeal(deal), clientSecret: paymentIntent.client_secret },
    };
  } catch (err) {
    await stripe.paymentIntents.cancel(paymentIntent.id).catch(() => {});
    throw err;
  }
}

// pending_blogger_approval -> blogger_accepted. Guarded updateMany means a
// blogger click racing the (nonexistent, for this transition) system side
// can only ever have one winner — kept for consistency with the rest of
// the codebase's transition pattern even though nothing else currently
// competes for this one write.
async function acceptOffer({ dealId, bloggerId }) {
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) {
    return { status: 404, body: { ok: false, error: "Deal not found" } };
  }
  if (bloggerId && deal.publisherId !== bloggerId) {
    return { status: 403, body: { ok: false, error: "Not your offer" } };
  }
  if (deal.status !== "pending_blogger_approval") {
    return { status: 409, body: { ok: false, error: "Offer is not awaiting a response" } };
  }

  const now = new Date();
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.deal.updateMany({
        where: { id: dealId, status: "pending_blogger_approval" },
        data: {
          status: "blogger_accepted",
          statusHistory: appendHistory(deal, [{ status: "blogger_accepted", at: now.toISOString(), actor: "blogger" }]),
        },
      });
      if (claimed.count === 0) {
        throw new DealStateConflictError();
      }

      return tx.deal.findUnique({
        where: { id: dealId },
        include: { advertiser: true, bloggerChannel: true },
      });
    });

    await notifyOfferAccepted(updated);
    return { status: 200, body: { ok: true, deal: publicBloggerDeal(updated) } };
  } catch (err) {
    if (err instanceof DealStateConflictError) {
      return { status: 409, body: { ok: false, error: "Offer state changed concurrently — refresh and retry" } };
    }
    throw err;
  }
}

// pending_blogger_approval -> blogger_declined: full refund, same
// idempotent-refund pattern as lib/deals.js's rejectCreative. No slot to
// free (a blogger can hold several offers at once).
async function declineOffer({ dealId, bloggerId, reason }) {
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) {
    return { status: 404, body: { ok: false, error: "Deal not found" } };
  }
  if (bloggerId && deal.publisherId !== bloggerId) {
    return { status: 403, body: { ok: false, error: "Not your offer" } };
  }
  if (deal.status !== "pending_blogger_approval") {
    return { status: 409, body: { ok: false, error: "Offer is not awaiting a response" } };
  }

  const refund = await stripe.refunds.create(
    { payment_intent: deal.stripePaymentIntentId, reason: "requested_by_customer" },
    { idempotencyKey: "blogger-offer-decline-refund-" + dealId }
  );

  const now = new Date();
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.deal.updateMany({
        where: { id: dealId, status: "pending_blogger_approval" },
        data: {
          status: "blogger_declined",
          stripeRefundId: refund.id,
          statusHistory: appendHistory(deal, [
            { status: "blogger_declined", at: now.toISOString(), actor: "blogger", reason: reason || null },
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

      return tx.deal.findUnique({ where: { id: dealId }, include: { advertiser: true } });
    });

    await notifyOfferDeclined(updated);
    return { status: 200, body: { ok: true, deal: publicBloggerDeal(updated) } };
  } catch (err) {
    if (err instanceof DealStateConflictError) {
      return { status: 409, body: { ok: false, error: "Offer state changed concurrently — refresh and retry" } };
    }
    throw err;
  }
}

// blogger_accepted -> blogger_published: the blogger drops in the live post
// URL. Starts the 48h auto-confirm clock (see lib/payout-cron.js).
async function markPublished({ dealId, bloggerId, publishedUrl }) {
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) {
    return { status: 404, body: { ok: false, error: "Deal not found" } };
  }
  if (bloggerId && deal.publisherId !== bloggerId) {
    return { status: 403, body: { ok: false, error: "Not your offer" } };
  }
  if (deal.status !== "blogger_accepted") {
    return { status: 409, body: { ok: false, error: "Offer is not in an accepted state" } };
  }
  if (!publishedUrl || !/^https?:\/\//i.test(publishedUrl)) {
    return { status: 400, body: { ok: false, error: "Enter the URL of the published post" } };
  }

  const now = new Date();
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.deal.updateMany({
        where: { id: dealId, status: "blogger_accepted" },
        data: {
          status: "blogger_published",
          publishedUrl: publishedUrl,
          publishedAt: now,
          statusHistory: appendHistory(deal, [{ status: "blogger_published", at: now.toISOString(), actor: "blogger" }]),
        },
      });
      if (claimed.count === 0) {
        throw new DealStateConflictError();
      }

      return tx.deal.findUnique({
        where: { id: dealId },
        include: { advertiser: true, bloggerChannel: true },
      });
    });

    await notifyBloggerPublished(updated);
    return { status: 200, body: { ok: true, deal: publicBloggerDeal(updated) } };
  } catch (err) {
    if (err instanceof DealStateConflictError) {
      return { status: 409, body: { ok: false, error: "Offer state changed concurrently — refresh and retry" } };
    }
    throw err;
  }
}

// blogger_published -> completed, either the advertiser confirming manually
// (advertiserId provided) or the 48h auto-confirm cron (actor passed,
// advertiserId omitted — mirrors lib/deals.js's approveCreative pattern for
// system callers). payoutEligibleAt uses the same dispute-window buffer as
// the slot vertical; once set, the existing releaseCompletedPayouts cron
// picks this deal up with no changes needed on its side.
async function confirmPublished({ dealId, advertiserId, actor }) {
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) {
    return { status: 404, body: { ok: false, error: "Deal not found" } };
  }
  if (advertiserId && deal.advertiserId !== advertiserId) {
    return { status: 403, body: { ok: false, error: "Not your offer" } };
  }
  if (deal.status !== "blogger_published") {
    return { status: 409, body: { ok: false, error: "Offer has not been published yet" } };
  }

  const payoutBufferDays = Number(process.env.PAYOUT_BUFFER_DAYS || 4);
  const now = new Date();
  const payoutEligibleAt = new Date(now.getTime() + payoutBufferDays * 24 * 60 * 60 * 1000);

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.deal.updateMany({
        where: { id: dealId, status: "blogger_published" },
        data: {
          status: "completed",
          endsAt: now,
          payoutEligibleAt: payoutEligibleAt,
          statusHistory: appendHistory(deal, [
            { status: "completed", at: now.toISOString(), actor: actor || "advertiser" },
          ]),
        },
      });
      if (claimed.count === 0) {
        throw new DealStateConflictError();
      }

      return tx.deal.findUnique({ where: { id: dealId } });
    });

    return { status: 200, body: { ok: true, deal: publicBloggerDeal(updated) } };
  } catch (err) {
    if (err instanceof DealStateConflictError) {
      return { status: 409, body: { ok: false, error: "Offer state changed concurrently — refresh and retry" } };
    }
    throw err;
  }
}

module.exports = {
  createBloggerOffer: createBloggerOffer,
  acceptOffer: acceptOffer,
  declineOffer: declineOffer,
  markPublished: markPublished,
  confirmPublished: confirmPublished,
  publicBloggerDeal: publicBloggerDeal,
};
