const prisma = require("./prisma");
const stripe = require("./stripe-client");
const { appendHistory } = require("./deal-history");
const { approveCreative } = require("./deals");

// pending_approval -> live for anything a publisher hasn't reviewed within
// AUTO_APPROVE_HOURS. Reuses approveCreative so the atomic
// starts_at/ends_at/payout_eligible_at write and the concurrency guard are
// identical to a manual approve — this is just a different caller.
async function runAutoApprove() {
  const hours = Number(process.env.AUTO_APPROVE_HOURS || 48);
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  const due = await prisma.deal.findMany({
    where: { status: "pending_approval", pendingApprovalAt: { lte: cutoff } },
    select: { id: true },
  });

  let approved = 0;
  for (const { id } of due) {
    const result = await approveCreative({ dealId: id, actor: "system-auto-approve" });
    if (result.status === 200) {
      approved++;
    } else {
      console.warn("[cron] auto-approve skipped deal " + id + ": " + result.body.error);
    }
  }
  return approved;
}

// live -> completed once the placement window has elapsed. No money moves
// here — the payout cron only acts once a deal is BOTH completed and past
// its payout buffer (checked separately in releaseCompletedPayouts).
async function advanceLiveToCompleted() {
  const now = new Date();
  const due = await prisma.deal.findMany({
    where: { status: "live", endsAt: { lte: now } },
  });

  let completed = 0;
  for (const deal of due) {
    const claimed = await prisma.deal.updateMany({
      where: { id: deal.id, status: "live" },
      data: {
        status: "completed",
        statusHistory: appendHistory(deal, [{ status: "completed", at: now.toISOString(), actor: "system" }]),
      },
    });
    if (claimed.count === 1) {
      completed++;
    }
  }
  return completed;
}

// completed -> payout_released: only deals that are BOTH status=completed
// AND past payout_eligible_at (ends_at + PAYOUT_BUFFER_DAYS) are eligible —
// this is the dispute-window buffer, so a chargeback filed shortly after a
// placement ends still has a chance to flip the deal to `disputed` (via the
// Stripe webhook) before any money leaves the platform balance.
async function releaseCompletedPayouts() {
  const now = new Date();
  const due = await prisma.deal.findMany({
    where: { status: "completed", payoutEligibleAt: { lt: now } },
    include: { publisher: { include: { stripeAccount: true } } },
  });

  let released = 0;
  for (const deal of due) {
    const account = deal.publisher.stripeAccount;
    if (!account || !account.payoutsEnabled) {
      console.warn("[cron] payout skipped for deal " + deal.id + ": publisher has no active Stripe payouts");
      continue;
    }
    if (!deal.stripeChargeId) {
      console.error("[cron] payout skipped for deal " + deal.id + ": missing stripeChargeId");
      continue;
    }

    let transfer;
    try {
      transfer = await stripe.transfers.create(
        {
          amount: deal.slotPriceCents, // full slot price — the fee was already added on top of what the advertiser paid, never deducted from the publisher's share
          currency: deal.currency,
          destination: account.stripeAccountId,
          source_transaction: deal.stripeChargeId,
          metadata: { vybridgeDealId: deal.id },
        },
        { idempotencyKey: "deal-payout-" + deal.id }
      );
    } catch (err) {
      console.error("[cron] transfer failed for deal " + deal.id + ":", err.message);
      continue;
    }

    const claimed = await prisma.deal.updateMany({
      where: { id: deal.id, status: "completed" },
      data: {
        status: "payout_released",
        stripeTransferId: transfer.id,
        statusHistory: appendHistory(deal, [{ status: "payout_released", at: now.toISOString(), actor: "system" }]),
      },
    });
    if (claimed.count === 1) {
      released++;
    }
  }
  return released;
}

async function runCronCycle() {
  const autoApproved = await runAutoApprove();
  const completed = await advanceLiveToCompleted();
  const released = await releaseCompletedPayouts();

  if (autoApproved || completed || released) {
    console.log(
      "[cron] auto_approved=" + autoApproved + " completed=" + completed + " payouts_released=" + released
    );
  }

  return { autoApproved: autoApproved, completed: completed, released: released };
}

module.exports = {
  runAutoApprove: runAutoApprove,
  advanceLiveToCompleted: advanceLiveToCompleted,
  releaseCompletedPayouts: releaseCompletedPayouts,
  runCronCycle: runCronCycle,
};
