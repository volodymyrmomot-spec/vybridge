const prisma = require("./prisma");

const BPS_DENOMINATOR = 10000;

// Resolves the advertiser's current commission rate from their lifetime
// spend (highest tier whose threshold they've already crossed). Callers
// snapshot the returned bps onto the deal, so editing fee_tiers later never
// changes the economics of a deal that was already created.
async function resolveFeeBps(lifetimeAdvertiserSpendCents) {
  const tier = await prisma.feeTier.findFirst({
    where: { minLifetimeSpendCents: { lte: lifetimeAdvertiserSpendCents } },
    orderBy: { minLifetimeSpendCents: "desc" },
  });

  if (!tier) {
    throw new Error("No fee tier configured — run `npm run seed`");
  }

  return tier.feeBps;
}

// Commission is charged on top of the slot price (advertiser pays
// slotPriceCents + fee; publisher is transferred the full slotPriceCents).
function calculatePlatformFeeCents(slotPriceCents, feeBps) {
  return Math.round((slotPriceCents * feeBps) / BPS_DENOMINATOR);
}

module.exports = {
  resolveFeeBps: resolveFeeBps,
  calculatePlatformFeeCents: calculatePlatformFeeCents,
};
