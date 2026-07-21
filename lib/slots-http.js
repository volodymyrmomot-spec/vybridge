const { getUserFromSession, getSessionIdFromRequest } = require("./sessions");
const { getAvailableSlots, deleteSlot } = require("./slots");
const { capturePreview } = require("./slot-preview");
const prisma = require("./prisma");

const SLOT_ROUTE = /^\/api\/slots\/([^/]+)$/;
const REGENERATE_PREVIEW_ROUTE = /^\/api\/slots\/([^/]+)\/regenerate-preview$/;

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

  const regenerateMatch = url.pathname.match(REGENERATE_PREVIEW_ROUTE);
  if (regenerateMatch && req.method === "POST") {
    const user = await getUserFromSession(getSessionIdFromRequest(req));
    if (!user) {
      sendJson(res, 401, { ok: false, error: "Not authenticated" });
      return true;
    }

    const slotId = decodeURIComponent(regenerateMatch[1]);
    const slot = await prisma.slot.findUnique({ where: { id: slotId } });
    if (!slot || slot.publisherId !== user.id) {
      sendJson(res, 404, { ok: false, error: "Slot not found" });
      return true;
    }

    await prisma.slot.update({ where: { id: slotId }, data: { previewStatus: "pending" } });
    capturePreview(slotId).catch(function (err) {
      console.error("[slots-http] Preview regeneration threw for slot " + slotId + ":", err.message);
    });

    sendJson(res, 200, { ok: true });
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
