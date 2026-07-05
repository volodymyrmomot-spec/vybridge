const prisma = require("./prisma");
const stripe = require("./stripe-client");
const { appendHistory } = require("./deal-history");
const { notifyPendingApproval, notifyBloggerNewOffer } = require("./deal-emails");

function readRawBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    req.on("data", function (chunk) {
      chunks.push(chunk);
    });
    req.on("end", function () {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

// created -> paid_escrow -> (pending_approval | pending_blogger_approval),
// collapsed into one update since the creative/brief is already attached at
// deal-creation time (advertisers upload it before paying), so there's
// nothing left to wait on. Which of the two next statuses applies is
// determined by which of slotId/bloggerChannelId is set on the deal (see
// schema.prisma) — a deal is always exactly one or the other.
async function handlePaymentIntentSucceeded(tx, event) {
  const paymentIntent = event.data.object;
  const deal = await tx.deal.findUnique({ where: { stripePaymentIntentId: paymentIntent.id } });
  if (!deal || deal.status !== "created") {
    return null;
  }

  const now = new Date();
  const isBloggerDeal = !!deal.bloggerChannelId;
  const nextStatus = isBloggerDeal ? "pending_blogger_approval" : "pending_approval";

  const updated = await tx.deal.update({
    where: { id: deal.id },
    data: {
      status: nextStatus,
      pendingApprovalAt: now,
      stripeChargeId: typeof paymentIntent.latest_charge === "string" ? paymentIntent.latest_charge : null,
      statusHistory: appendHistory(deal, [
        { status: "paid_escrow", at: now.toISOString(), actor: "system" },
        { status: nextStatus, at: now.toISOString(), actor: "system" },
      ]),
    },
    include: isBloggerDeal
      ? { publisher: true, bloggerChannel: true }
      : { publisher: true, slot: true },
  });

  await tx.user.update({
    where: { id: deal.advertiserId },
    data: { lifetimeAdvertiserSpendCents: { increment: deal.totalChargedCents } },
  });

  return { isBloggerDeal: isBloggerDeal, deal: updated };
}

// No money ever moved for a failed/canceled attempt (capture only happens on
// success) — free the slot back up instead of inventing a new terminal deal
// status for a booking that never actually completed. A blogger deal has no
// slot to free (a blogger can hold several offers at once), so there's
// nothing to do there beyond leaving the deal in `created`.
async function handlePaymentIntentDidNotSucceed(tx, event) {
  const paymentIntent = event.data.object;
  const deal = await tx.deal.findUnique({ where: { stripePaymentIntentId: paymentIntent.id } });
  if (!deal || deal.status !== "created" || !deal.slotId) {
    return;
  }

  await tx.slot.updateMany({
    where: { id: deal.slotId, status: "booked" },
    data: { status: "active" },
  });
}

// Freezes the deal so the payout cron won't transfer to the publisher while
// a chargeback is open. Resolution (back to completed, or to refunded) is a
// manual support action, not automated here.
async function handleChargeDisputeCreated(tx, event) {
  const dispute = event.data.object;
  const deal = await tx.deal.findFirst({ where: { stripeChargeId: dispute.charge } });
  if (!deal) {
    return;
  }
  if (["payout_released", "refunded", "rejected", "disputed"].includes(deal.status)) {
    return;
  }

  await tx.deal.update({
    where: { id: deal.id },
    data: {
      status: "disputed",
      statusHistory: appendHistory(deal, [
        { status: "disputed", at: new Date().toISOString(), actor: "stripe" },
      ]),
    },
  });
}

// Mirrors the connected account's onboarding state into stripe_accounts.
// This is the ONLY place payouts_enabled ever flips to true — the return_url
// page just tells the publisher to check back, it never trusts its own
// read of Stripe's state for anything that unblocks money movement.
async function handleAccountUpdated(tx, event) {
  const account = event.data.object;
  const stripeAccount = await tx.stripeAccount.findUnique({ where: { stripeAccountId: account.id } });
  if (!stripeAccount) {
    return;
  }

  const onboardingStatus = account.details_submitted && account.payouts_enabled ? "complete" : "pending";

  await tx.stripeAccount.update({
    where: { id: stripeAccount.id },
    data: {
      payoutsEnabled: !!account.payouts_enabled,
      onboardingStatus: onboardingStatus,
    },
  });
}

async function handleStripeWebhookRequest(req, res, sendJson) {
  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    sendJson(res, 400, { ok: false, error: "Could not read request body" });
    return;
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("[stripe-webhook] Signature verification failed:", err.message);
    sendJson(res, 400, { ok: false, error: "Invalid signature" });
    return;
  }

  // handlePaymentIntentSucceeded returns the updated deal (with the
  // relations whichever email needs) when it actually performed the
  // transition, so the notification only fires once per real event — not
  // on Stripe's occasional redelivery of an already-processed event.
  let sideEffect = null;
  try {
    await prisma.$transaction(async function (tx) {
      const alreadyProcessed = await tx.stripeEvent.findUnique({ where: { id: event.id } });
      if (alreadyProcessed) {
        return;
      }

      if (event.type === "payment_intent.succeeded") {
        sideEffect = await handlePaymentIntentSucceeded(tx, event);
      } else if (event.type === "payment_intent.payment_failed" || event.type === "payment_intent.canceled") {
        await handlePaymentIntentDidNotSucceed(tx, event);
      } else if (event.type === "charge.dispute.created") {
        await handleChargeDisputeCreated(tx, event);
      } else if (event.type === "account.updated") {
        await handleAccountUpdated(tx, event);
      }

      await tx.stripeEvent.create({ data: { id: event.id, type: event.type } });
    });
  } catch (err) {
    console.error("[stripe-webhook] Failed to process event " + event.id + ":", err);
    sendJson(res, 500, { ok: false, error: "Webhook processing failed" });
    return;
  }

  // Sent after the transaction commits, never inside it — an email provider
  // call has no business holding a DB transaction open.
  if (sideEffect) {
    if (sideEffect.isBloggerDeal) {
      await notifyBloggerNewOffer(sideEffect.deal);
    } else {
      await notifyPendingApproval(sideEffect.deal);
    }
  }

  sendJson(res, 200, { ok: true, received: true });
}

module.exports = {
  handleStripeWebhookRequest: handleStripeWebhookRequest,
};
