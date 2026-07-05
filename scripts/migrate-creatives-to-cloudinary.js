// One-off migration: moves any Creative row still storing its image as a
// data: URL in Postgres over to Cloudinary, and rewrites file_url to the
// resulting secure_url. Safe to re-run — it only ever selects rows still
// starting with "data:", so already-migrated rows are never touched twice.
//
// Usage: node --env-file=.env scripts/migrate-creatives-to-cloudinary.js
const { PrismaClient } = require("@prisma/client");
const { uploadCreative } = require("../lib/storage");

const prisma = new PrismaClient();

function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) {
    return null;
  }
  return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
}

async function main() {
  const creatives = await prisma.creative.findMany({
    where: { fileUrl: { startsWith: "data:" } },
  });

  console.log("Found " + creatives.length + " creative(s) still stored as data: URLs.");

  let migrated = 0;
  let failed = 0;

  for (const creative of creatives) {
    const parsed = parseDataUrl(creative.fileUrl);
    if (!parsed) {
      console.error("[skip] Creative " + creative.id + ": could not parse its data: URL");
      failed++;
      continue;
    }

    try {
      const uploaded = await uploadCreative({ buffer: parsed.buffer, mimeType: parsed.mimeType });
      await prisma.creative.update({
        where: { id: creative.id },
        // Width/height are refreshed from what Cloudinary actually measured
        // rather than left at whatever the old client-side reader recorded.
        data: { fileUrl: uploaded.secureUrl, width: uploaded.width, height: uploaded.height },
      });
      console.log("[ok] Creative " + creative.id + " -> " + uploaded.secureUrl);
      migrated++;
    } catch (err) {
      console.error("[fail] Creative " + creative.id + ":", err.message);
      failed++;
    }
  }

  console.log("Done. Migrated " + migrated + ", failed " + failed + ", total " + creatives.length + ".");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
