const prisma = require("./prisma");

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// Looks up where a click on this deal's ad should land, records it (subject
// to the per-IP rate limit), and always returns the destination — a
// rate-limited repeat click still lands the visitor on the advertiser's
// page, it just isn't double-counted in stats. Returns null if there's
// nothing valid to send the visitor to (unknown deal, or the deal was never
// approved), so the caller can 404 instead of redirecting into a void.
async function recordClickAndGetDestination({ dealId, ip, userAgent }) {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      creatives: {
        where: { status: "approved" },
        orderBy: { submittedAt: "desc" },
        take: 1,
      },
    },
  });

  const creative = deal && deal.creatives[0];
  if (!deal || !creative) {
    return null;
  }

  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const recent = await prisma.click.findFirst({
    where: { dealId: dealId, ip: ip, createdAt: { gte: since } },
  });

  if (!recent) {
    await prisma.click.create({
      data: {
        dealId: dealId,
        creativeId: creative.id,
        ip: ip,
        userAgent: userAgent || null,
      },
    });
  }

  return creative.clickUrl;
}

module.exports = {
  recordClickAndGetDestination: recordClickAndGetDestination,
};
