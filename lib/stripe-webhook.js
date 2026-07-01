const prisma = require("./prisma");
const stripe = require("./stripe-client");
const { appendHistory } = require("./deal-history");

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

// created -> paid_escrow -> pending_approval, collapsed into one update
// since the creative is already attached at deal-creation time (advertisers
// upload it before paying), so there's nothing left to wait on.
async function handlePaymentIntentSucceeded(tx, event) {
  const paymentIntent = event.data.object;
  const deal = await tx.deal.findUnique({ where: { stripePaymentIntentId: paymentIntent.id } });
  if (!deal || deal.status !== "created") {
    return;
  }

  const now = new Date();

  await tx.deal.update({
    where: { id: deal.id },
    data: {
      status: "pending_approval",
      pendingApprovalAt: now,
      stripeChargeId: typeof paymentIntent.latest_charge === "string" ? paymentIntent.latest_charge : null,
      statusHistory: appendHistory(deal, [
        { status: "paid_escrow", at: now.toISOString(), actor: "system" },
        { status: "pending_approval", at: now.toISOString(), actor: "system" },
      ]),
    },
  });

  await tx.user.update({
    where: { id: deal.advertiserId },
    data: { lifetimeAdvertiserSpendCents: { increment: deal.totalChargedCents } },
  });
}

// No money ever moved for a failed/canceled attempt (capture only happens on
// success) — free the slot back up instead of inventing a new terminal deal
// status for a booking that never actually completed.
async function handlePaymentIntentDidNotSucceed(tx, event) {
  const paymentIntent = event.data.object;
  const deal = await tx.deal.findUnique({ where: { stripePaymentIntentId: paymentIntent.id } });
  if (!deal || deal.status !== "created") {
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

  try {
    await prisma.$transaction(async function (tx) {
      const alreadyProcessed = await tx.stripeEvent.findUnique({ where: { id: event.id } });
      if (alreadyProcessed) {
        return;
      }

      if (event.type === "payment_intent.succeeded") {
        await handlePaymentIntentSucceeded(tx, event);
      } else if (event.type === "payment_intent.payment_failed" || event.type === "payment_intent.canceled") {
        await handlePaymentIntentDidNotSucceed(tx, event);
      } else if (event.type === "charge.dispute.created") {
        await handleChargeDisputeCreated(tx, event);
      }

      await tx.stripeEvent.create({ data: { id: event.id, type: event.type } });
    });
  } catch (err) {
    console.error("[stripe-webhook] Failed to process event " + event.id + ":", err);
    sendJson(res, 500, { ok: false, error: "Webhook processing failed" });
    return;
  }

  sendJson(res, 200, { ok: true, received: true });
}

module.exports = {
  handleStripeWebhookRequest: handleStripeWebhookRequest,
};
