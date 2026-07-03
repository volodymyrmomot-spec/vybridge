const prisma = require("./prisma");

// Public, unauthenticated: returns only what's needed to render currently
// live ads for a site. A slot appears only if it has a `live` deal with an
// approved creative — anything else (draft, booked-but-not-approved,
// completed, etc.) is invisible to the widget by construction, no separate
// filtering logic to keep in sync.
async function getWidgetSlots({ siteKey, baseUrl }) {
  const site = await prisma.site.findUnique({ where: { siteKey: siteKey } });
  if (!site || site.status !== "active") {
    return [];
  }

  const slots = await prisma.slot.findMany({
    where: { siteId: site.id },
    include: {
      deals: {
        where: { status: "live" },
        take: 1,
        include: {
          creatives: {
            where: { status: "approved" },
            orderBy: { submittedAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  const result = [];
  for (const slot of slots) {
    const deal = slot.deals[0];
    const creativeItem = deal && deal.creatives[0];
    if (!deal || !creativeItem) {
      continue;
    }
    result.push({
      slot_id: slot.id,
      dom_selector: slot.domSelector,
      width: slot.width,
      height: slot.height,
      creative_url: creativeItem.fileUrl,
      click_tracking_url: baseUrl + "/api/clicks/" + deal.id,
    });
  }

  return result;
}

module.exports = {
  getWidgetSlots: getWidgetSlots,
};
