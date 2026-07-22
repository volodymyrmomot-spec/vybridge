// Regression test for the Picker session lifecycle: creates and finalizes
// N slots back-to-back on the same connected site, in one continuous run,
// verifying every prior slot survives each subsequent session — exactly
// the "slot #1, #2, #3 ... unlimited" flow a publisher goes through
// clicking "+ New slot" repeatedly without ever reinstalling the script,
// reconnecting the site, or refreshing anything themselves.
//
// Usage:
//   node --env-file=.env scripts/test-picker-lifecycle.js <site-domain> [count]
//
// Creates and deletes its own slots only (tracked by id, cleaned up via the
// real deleteSlot() in a finally block) — safe to run against a real
// database, including one shared with production, same as this project's
// existing prisma/seed.js.

const { createPickerSession } = require("../lib/picker");
const { finalizeSlot, deleteSlot } = require("../lib/slots");
const prisma = require("../lib/prisma");

const ANCHOR = {
  anchorSelector: "section:nth-of-type(2) > div:nth-of-type(1)",
  relativeX: 0.7063333320617676,
  relativeY: 0.3363122793670589,
  relativeWidth: 0.16666666666666666,
  relativeHeight: 0.04159706687869729,
};

async function run() {
  const domain = process.argv[2];
  const count = Number(process.argv[3]) || 10;
  if (!domain) {
    console.error("Usage: node scripts/test-picker-lifecycle.js <site-domain> [count]");
    process.exitCode = 1;
    return;
  }

  const site = await prisma.site.findFirst({ where: { domain: domain } });
  if (!site) {
    console.error("No site found for domain: " + domain);
    process.exitCode = 1;
    return;
  }

  const createdIds = [];
  let failures = 0;

  try {
    for (let i = 1; i <= count; i++) {
      const session = await createPickerSession({
        publisherId: site.publisherId,
        pageUrl: "https://" + domain + "/",
        viewportType: "desktop",
      });
      if (!session.body.ok) {
        console.error("[FAIL] createPickerSession #" + i + ":", JSON.stringify(session.body));
        failures++;
        continue;
      }

      const result = await finalizeSlot({
        publisherId: site.publisherId,
        slotId: session.body.slotId,
        body: {
          label: "LIFECYCLE TEST " + i,
          format: "",
          posX: 960,
          posY: 1450,
          width: 200,
          height: 80,
          priceEuros: 50,
          durationDays: 30,
          viewportType: "desktop",
          anchorSelector: ANCHOR.anchorSelector,
          relativeX: ANCHOR.relativeX,
          relativeY: ANCHOR.relativeY,
          relativeWidth: ANCHOR.relativeWidth,
          relativeHeight: ANCHOR.relativeHeight,
        },
      });

      if (!result.body.ok) {
        console.error("[FAIL] finalizeSlot #" + i + ":", JSON.stringify(result.body));
        failures++;
        continue;
      }

      createdIds.push(result.body.slot.id);

      // The critical assertion: every slot finalized so far must still
      // exist, right now, after this session — a regression that wipes or
      // orphans earlier slots would show up here immediately, not just at
      // the end.
      const survivors = await prisma.slot.count({ where: { id: { in: createdIds } } });
      const ok = survivors === createdIds.length;
      console.log(
        (ok ? "[PASS]" : "[FAIL]") +
          " slot #" +
          i +
          " finalized (" +
          result.body.slot.id +
          "), " +
          survivors +
          "/" +
          createdIds.length +
          " prior slots intact"
      );
      if (!ok) {
        failures++;
      }
    }

    console.log("");
    console.log(
      failures === 0
        ? "ALL " + count + " picker-session lifecycles passed."
        : failures + " of " + count + " lifecycles FAILED."
    );
  } finally {
    for (const id of createdIds) {
      await deleteSlot({ publisherId: site.publisherId, slotId: id });
    }
    console.log("Cleaned up " + createdIds.length + " test slot(s).");
    await prisma.$disconnect();
  }

  process.exitCode = failures === 0 ? 0 : 1;
}

run().catch(function (err) {
  console.error("Regression test crashed:", err);
  process.exitCode = 1;
});
