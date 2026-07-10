const prisma = require("./prisma");
const { PENDING_FORMAT } = require("./slots");

// Public, unauthenticated: returns what's needed to render both currently
// live ads and, for a booked-nowhere slot, a house "advertise here"
// placeholder. A slot with a `live` deal and approved creative renders the
// real ad; an `active` slot with no deal at all renders the placeholder
// instead of nothing, so an empty slot still invites advertisers rather
// than just sitting blank. Anything else (draft/pending, booked, paused) is
// invisible to the widget either way.
async function getWidgetSlots({ siteKey, baseUrl }) {
  const site = await prisma.site.findUnique({ where: { siteKey: siteKey } });
  if (!site || site.status !== "active") {
    return [];
  }

  const slots = await prisma.slot.findMany({
    where: { siteId: site.id, format: { not: PENDING_FORMAT } },
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
    if (deal && creativeItem) {
      result.push({
        kind: "ad",
        slot_id: slot.id,
        dom_selector: slot.domSelector,
        width: slot.width,
        height: slot.height,
        creative_url: creativeItem.fileUrl,
        click_tracking_url: baseUrl + "/api/clicks/" + deal.id,
      });
      continue;
    }
    if (!deal && slot.status === "active") {
      result.push({
        kind: "placeholder",
        slot_id: slot.id,
        dom_selector: slot.domSelector,
        width: slot.width,
        height: slot.height,
        advertise_url: baseUrl + "/slots",
      });
    }
  }

  return result;
}

module.exports = {
  getWidgetSlots: getWidgetSlots,
};
