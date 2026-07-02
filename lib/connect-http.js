const { getUserFromSession, getSessionIdFromRequest } = require("./sessions");
const { startOnboarding } = require("./connect");

function getBaseUrl(req) {
  const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
  return protocol + "://" + req.headers.host;
}

async function handleConnectRequest(req, res, url, sendJson) {
  if (url.pathname === "/api/connect/onboard" && req.method === "POST") {
    const user = await getUserFromSession(getSessionIdFromRequest(req));
    if (!user) {
      sendJson(res, 401, { ok: false, error: "Not authenticated" });
      return true;
    }

    const result = await startOnboarding({ userId: user.id, baseUrl: getBaseUrl(req) });
    sendJson(res, result.status, result.body);
    return true;
  }

  return false;
}

module.exports = {
  handleConnectRequest: handleConnectRequest,
};
