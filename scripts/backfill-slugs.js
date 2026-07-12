// One-off migration: assigns a slug to every Site and Slot row that doesn't
// have one yet (i.e. every row that existed before slugs were introduced).
// Safe to re-run — only ever selects rows where slug is still null.
//
// Usage: node --env-file=.env scripts/backfill-slugs.js
const { PrismaClient } = require("@prisma/client");
const { generateUniqueSlug } = require("../lib/slug");

const prisma = new PrismaClient();

async function backfillSiteSlugs() {
  const sites = await prisma.site.findMany({ where: { slug: null } });
  console.log("Found " + sites.length + " site(s) without a slug.");

  for (const site of sites) {
    const slug = await generateUniqueSlug(site.domain, async function (candidate) {
      // No @unique on slug yet at this point in the migration sequence (it's
      // added in a follow-up migration once every row has one) — findUnique
      // would reject slug as a where-key, so check via findFirst instead.
      const existing = await prisma.site.findFirst({ where: { slug: candidate } });
      return !!existing;
    });
    await prisma.site.update({ where: { id: site.id }, data: { slug: slug } });
    console.log("[ok] Site " + site.id + " (" + site.domain + ") -> " + slug);
  }

  return sites.length;
}

async function backfillSlotSlugs() {
  const slots = await prisma.slot.findMany({ where: { slug: null }, include: { site: true } });
  console.log("Found " + slots.length + " slot(s) without a slug.");

  for (const slot of slots) {
    const base = slot.label + " " + slot.site.domain;
    const slug = await generateUniqueSlug(base, async function (candidate) {
      const existing = await prisma.slot.findFirst({ where: { slug: candidate } });
      return !!existing;
    });
    await prisma.slot.update({ where: { id: slot.id }, data: { slug: slug } });
    console.log("[ok] Slot " + slot.id + " (" + slot.label + ") -> " + slug);
  }

  return slots.length;
}

async function main() {
  const siteCount = await backfillSiteSlugs();
  const slotCount = await backfillSlotSlugs();
  console.log("Done. Backfilled " + siteCount + " site(s) and " + slotCount + " slot(s).");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
