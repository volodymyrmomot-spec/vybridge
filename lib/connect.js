const prisma = require("./prisma");
const stripe = require("./stripe-client");

// Starts (or resumes) Standard Connect onboarding for a publisher. Reuses
// the existing Stripe account if one was already created for this user
// instead of creating a second one on every click — Account Links are
// short-lived, but the underlying Account persists across attempts.
async function startOnboarding({ userId, baseUrl }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== "publisher") {
    return { status: 403, body: { ok: false, error: "Only publisher accounts can connect payouts" } };
  }

  let account = await prisma.stripeAccount.findUnique({ where: { userId: userId } });

  if (!account) {
    const stripeAccount = await stripe.accounts.create({
      type: "standard",
      email: user.email,
      metadata: { vybridgeUserId: user.id },
    });

    account = await prisma.stripeAccount.create({
      data: {
        userId: user.id,
        stripeAccountId: stripeAccount.id,
        onboardingStatus: "pending",
      },
    });
  }

  const accountLink = await stripe.accountLinks.create({
    account: account.stripeAccountId,
    refresh_url: baseUrl + "/connect/return?refresh=1",
    return_url: baseUrl + "/connect/return",
    type: "account_onboarding",
  });

  return { status: 200, body: { ok: true, url: accountLink.url } };
}

module.exports = {
  startOnboarding: startOnboarding,
};
