const { getUserFromSession, getSessionIdFromRequest } = require("./sessions");
const { createSlot } = require("./slots");

async function readJsonBody(req, readBody) {
  const raw = await readBody(req);
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

async function handleSlotsRequest(req, res, url, readBody, sendJson) {
  if (url.pathname === "/api/slots" && req.method === "POST") {
    const user = await getUserFromSession(getSessionIdFromRequest(req));
    if (!user) {
      sendJson(res, 401, { ok: false, error: "Not authenticated" });
      return true;
    }

    const body = await readJsonBody(req, readBody);
    const result = await createSlot({ publisherId: user.id, body: body });
    sendJson(res, result.status, result.body);
    return true;
  }

  return false;
}

module.exports = {
  handleSlotsRequest: handleSlotsRequest,
};
