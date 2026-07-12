// One-off migration: creates a Listing (status: active) for every already-
// finalized Slot (format !== "pending") that doesn't have one yet. Safe to
// re-run — createListingForSlot itself no-ops if a Listing already exists
// for that source.
//
// Usage: node --env-file=.env scripts/backfill-listings.js
const { PrismaClient } = require("@prisma/client");
const { createListingForSlot } = require("../lib/listings");

const prisma = new PrismaClient();

async function main() {
  const slots = await prisma.slot.findMany({
    where: { format: { not: "pending" } },
  });
  console.log("Found " + slots.length + " finalized slot(s) to check.");

  let created = 0;
  let skipped = 0;

  for (const slot of slots) {
    const listing = await createListingForSlot(slot.id);
    if (!listing) {
      console.error("[skip] Slot " + slot.id + ": could not create a listing (slot vanished mid-run?)");
      skipped++;
      continue;
    }
    console.log("[ok] Slot " + slot.id + " (" + slot.label + ") -> Listing " + listing.slug + " (" + listing.status + ")");
    created++;
  }

  console.log("Done. Processed " + created + " listing(s), skipped " + skipped + ", total slots checked " + slots.length + ".");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
