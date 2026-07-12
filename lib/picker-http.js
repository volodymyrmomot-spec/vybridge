const { getUserFromSession, getSessionIdFromRequest } = require("./sessions");
const { createPickerSession, createPickerToken, submitSelector, getExistingPickerOverlays } = require("./picker");
const { finalizeSlot } = require("./slots");

const SESSION_ROUTE = "/api/slots/picker-session";
const OVERLAYS_ROUTE = "/api/slots/picker-overlays";
const TOKEN_ROUTE = /^\/api\/slots\/([^/]+)\/picker-token$/;
const SELECTOR_ROUTE = /^\/api\/slots\/([^/]+)\/selector$/;
const FINALIZE_ROUTE = /^\/api\/slots\/([^/]+)\/finalize$/;

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

// The selector endpoint is called from w.js running on the publisher's own
// domain — a different origin than this app, with no session cookie
// available. The one-time token is the entire auth model, so a wide-open
// CORS policy on just this one route is the right tradeoff: no credentials
// ever cross the boundary, and a stolen/guessed token is already a single
// slot, single use, 10-minute window.
function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function handlePickerRequest(req, res, url, readBody, sendJson) {
  if (url.pathname === SESSION_ROUTE && req.method === "POST") {
    const user = await getUserFromSession(getSessionIdFromRequest(req));
    if (!user) {
      sendJson(res, 401, { ok: false, error: "Not authenticated" });
      return true;
    }

    const body = await readJsonBody(req, readBody);
    const result = await createPickerSession({
      publisherId: user.id,
      pageUrl: body.pageUrl,
      viewportType: body.viewportType,
    });
    sendJson(res, result.status, result.body);
    return true;
  }

  if (url.pathname === OVERLAYS_ROUTE && req.method === "GET") {
    const user = await getUserFromSession(getSessionIdFromRequest(req));
    if (!user) {
      sendJson(res, 401, { ok: false, error: "Not authenticated" });
      return true;
    }

    const viewportType = url.searchParams.get("viewportType");
    if (viewportType !== "desktop" && viewportType !== "mobile") {
      sendJson(res, 400, { ok: false, error: "viewportType must be 'desktop' or 'mobile'" });
      return true;
    }

    const overlays = await getExistingPickerOverlays({ publisherId: user.id, viewportType: viewportType });
    sendJson(res, 200, { ok: true, overlays: overlays });
    return true;
  }

  const finalizeMatch = url.pathname.match(FINALIZE_ROUTE);
  if (finalizeMatch && req.method === "PUT") {
    const user = await getUserFromSession(getSessionIdFromRequest(req));
    if (!user) {
      sendJson(res, 401, { ok: false, error: "Not authenticated" });
      return true;
    }

    const slotId = decodeURIComponent(finalizeMatch[1]);
    const body = await readJsonBody(req, readBody);
    const result = await finalizeSlot({ publisherId: user.id, slotId: slotId, body: body });
    sendJson(res, result.status, result.body);
    return true;
  }

  const tokenMatch = url.pathname.match(TOKEN_ROUTE);
  if (tokenMatch && req.method === "POST") {
    const user = await getUserFromSession(getSessionIdFromRequest(req));
    if (!user) {
      sendJson(res, 401, { ok: false, error: "Not authenticated" });
      return true;
    }

    const slotId = decodeURIComponent(tokenMatch[1]);
    const result = await createPickerToken({ publisherId: user.id, slotId: slotId });
    sendJson(res, result.status, result.body);
    return true;
  }

  const selectorMatch = url.pathname.match(SELECTOR_ROUTE);
  if (selectorMatch && req.method === "OPTIONS") {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return true;
  }

  if (selectorMatch && req.method === "POST") {
    setCorsHeaders(res);
    const slotId = decodeURIComponent(selectorMatch[1]);
    const body = await readJsonBody(req, readBody);
    const result = await submitSelector({ slotId: slotId, token: body.token, selector: body.selector });
    sendJson(res, result.status, result.body);
    return true;
  }

  return false;
}

module.exports = {
  handlePickerRequest: handlePickerRequest,
};
