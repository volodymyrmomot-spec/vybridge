const { getUserFromSession, getSessionIdFromRequest } = require("./sessions");
const { getAvailableSlots } = require("./slots");
const prisma = require("./prisma");

async function handleSlotsRequest(req, res, url, readBody, sendJson) {
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
