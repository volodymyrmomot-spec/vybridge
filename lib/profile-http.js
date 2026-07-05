const {
  getUserFromSession,
  getSessionIdFromRequest,
  deleteSessionsForUser,
  buildClearSessionCookie,
} = require("./sessions");
const { updateProfile, deleteAccount } = require("./profile");

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

function sendJsonWithCookie(res, statusCode, payload, cookie) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Set-Cookie": cookie,
  });
  res.end(JSON.stringify(payload));
}

async function handleProfileRequest(req, res, url, readBody, sendJson) {
  if (url.pathname !== "/api/profile") {
    return false;
  }
  if (req.method !== "PUT" && req.method !== "DELETE") {
    return false;
  }

  const user = await getUserFromSession(getSessionIdFromRequest(req));
  if (!user) {
    sendJson(res, 401, { ok: false, error: "Not authenticated" });
    return true;
  }

  const body = await readJsonBody(req, readBody);

  if (req.method === "PUT") {
    const result = await updateProfile({ userId: user.id, body: body });
    sendJson(res, result.status, result.body);
    return true;
  }

  // DELETE — logs the account out of every session (not just this one)
  // once the account itself is actually gone.
  const result = await deleteAccount({ userId: user.id, password: body.password });
  if (!result.body.ok) {
    sendJson(res, result.status, result.body);
    return true;
  }

  deleteSessionsForUser(user.id);
  sendJsonWithCookie(res, result.status, result.body, buildClearSessionCookie());
  return true;
}

module.exports = {
  handleProfileRequest: handleProfileRequest,
};
