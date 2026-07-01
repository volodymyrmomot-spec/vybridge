const { getUserFromSession, getSessionIdFromRequest } = require("./sessions");
const { createDeal, approveCreative, rejectCreative } = require("./deals");

const REVIEW_ROUTE = /^\/api\/deals\/([^/]+)\/(approve|reject)$/;

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

async function handleDealsRequest(req, res, url, readBody, sendJson) {
  if (url.pathname === "/api/deals" && req.method === "POST") {
    const user = await getUserFromSession(getSessionIdFromRequest(req));
    if (!user) {
      sendJson(res, 401, { ok: false, error: "Not authenticated" });
      return true;
    }

    const body = await readJsonBody(req, readBody);
    const result = await createDeal({
      advertiserId: user.id,
      slotId: body.slotId,
      creative: body.creative,
    });
    sendJson(res, result.status, result.body);
    return true;
  }

  const reviewMatch = url.pathname.match(REVIEW_ROUTE);
  if (reviewMatch && req.method === "POST") {
    const user = await getUserFromSession(getSessionIdFromRequest(req));
    if (!user) {
      sendJson(res, 401, { ok: false, error: "Not authenticated" });
      return true;
    }

    const dealId = decodeURIComponent(reviewMatch[1]);
    const action = reviewMatch[2];

    if (action === "approve") {
      const result = await approveCreative({ dealId: dealId, publisherId: user.id });
      sendJson(res, result.status, result.body);
      return true;
    }

    const body = await readJsonBody(req, readBody);
    const result = await rejectCreative({ dealId: dealId, publisherId: user.id, reason: body.reason });
    sendJson(res, result.status, result.body);
    return true;
  }

  return false;
}

module.exports = {
  handleDealsRequest: handleDealsRequest,
};
