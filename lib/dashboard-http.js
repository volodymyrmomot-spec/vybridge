const { getUserFromSession, getSessionIdFromRequest } = require("./sessions");
const { getDashboardData } = require("./dashboard");

async function handleDashboardRequest(req, res, url, sendJson) {
  if (url.pathname !== "/api/dashboard" || req.method !== "GET") {
    return false;
  }

  const user = await getUserFromSession(getSessionIdFromRequest(req));
  if (!user) {
    sendJson(res, 401, { ok: false, error: "Not authenticated" });
    return true;
  }

  const data = await getDashboardData(user);
  sendJson(res, 200, { ok: true, dashboard: data });
  return true;
}

module.exports = {
  handleDashboardRequest: handleDashboardRequest,
};
