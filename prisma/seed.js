const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Advertiser lifetime-spend tiers. Looked up by lib/fees.js at deal-creation
// time and snapshotted onto the deal, so editing these never changes the
// economics of deals already created.
const FEE_TIERS = [
  { name: "starter", minLifetimeSpendCents: 0, feeBps: 1200 },
  { name: "growth", minLifetimeSpendCents: 500000, feeBps: 900 },
  { name: "scale", minLifetimeSpendCents: 2000000, feeBps: 700 },
];

async function main() {
  for (const tier of FEE_TIERS) {
    const existing = await prisma.feeTier.findFirst({ where: { name: tier.name } });
    if (existing) {
      await prisma.feeTier.update({ where: { id: existing.id }, data: tier });
    } else {
      await prisma.feeTier.create({ data: tier });
    }
  }
  console.log("Seeded fee tiers:", FEE_TIERS.map((t) => t.name).join(", "));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
