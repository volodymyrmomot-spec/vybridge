const { getUserFromSession, getSessionIdFromRequest } = require("./sessions");
const { getAvailableSlots, deleteSlot } = require("./slots");
const prisma = require("./prisma");

const SLOT_ROUTE = /^\/api\/slots\/([^/]+)$/;

async function handleSlotsRequest(req, res, url, readBody, sendJson) {
  const slotMatch = url.pathname.match(SLOT_ROUTE);
  if (slotMatch && req.method === "DELETE") {
    const user = await getUserFromSession(getSessionIdFromRequest(req));
    if (!user) {
      sendJson(res, 401, { ok: false, error: "Not authenticated" });
      return true;
    }

    const slotId = decodeURIComponent(slotMatch[1]);
    const result = await deleteSlot({ publisherId: user.id, slotId: slotId });
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === "/api/slots/available" && req.method === "GET") {
    const user = await getUserFromSession(getSessionIdFromRequest(req));
    if (!user) {
      sendJson(res, 401, { ok: false, error: "Not authenticated" });
      return true;
    }
    if (user.role !== "advertiser") {
      sendJson(res, 403, { ok: false, error: "Only advertiser accounts can browse slots" });
      return true;
    }

    // publicUser() (what the session gives back) deliberately doesn't
    // include lifetime spend — fetch the real row for that one field
    // rather than widen the shared shape everywhere else uses.
    const fullUser = await prisma.user.findUnique({ where: { id: user.id } });
    const slots = await getAvailableSlots({ advertiserLifetimeSpendCents: fullUser.lifetimeAdvertiserSpendCents });
    sendJson(res, 200, { ok: true, slots: slots });
    return true;
  }

  return false;
}

module.exports = {
  handleSlotsRequest: handleSlotsRequest,
};
