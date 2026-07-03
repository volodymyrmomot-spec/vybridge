const { getUserFromSession, getSessionIdFromRequest } = require("./sessions");
const { createPickerToken, submitSelector } = require("./picker");

const TOKEN_ROUTE = /^\/api\/slots\/([^/]+)\/picker-token$/;
const SELECTOR_ROUTE = /^\/api\/slots\/([^/]+)\/selector$/;

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
