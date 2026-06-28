const { createUser, authenticateUser } = require("./users");
const {
  createSession,
  deleteSession,
  getUserFromSession,
  getSessionIdFromRequest,
  buildSessionCookie,
  buildClearSessionCookie,
} = require("./sessions");

function sendJsonWithCookie(res, statusCode, payload, cookie) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (cookie) {
    headers["Set-Cookie"] = cookie;
  }
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(payload));
}

async function handleAuthRequest(req, res, url, readBody, sendJson) {
  if (url.pathname === "/api/auth/register" && req.method === "POST") {
    const body = await readJsonBody(req, readBody);
    const result = createUser(body);
    if (!result.body.ok) {
      sendJson(res, result.status, result.body);
      return true;
    }

    const session = createSession(result.body.user.id);
    sendJsonWithCookie(res, result.status, result.body, buildSessionCookie(session.id));
    return true;
  }

  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    const body = await readJsonBody(req, readBody);
    const result = authenticateUser(body);
    if (!result.body.ok) {
      sendJson(res, result.status, result.body);
      return true;
    }

    const session = createSession(result.body.user.id);
    sendJsonWithCookie(res, result.status, result.body, buildSessionCookie(session.id));
    return true;
  }

  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    const sessionId = getSessionIdFromRequest(req);
    if (sessionId) {
      deleteSession(sessionId);
    }
    sendJsonWithCookie(res, 200, { ok: true }, buildClearSessionCookie());
    return true;
  }

  if (url.pathname === "/api/auth/me" && req.method === "GET") {
    const user = getUserFromSession(getSessionIdFromRequest(req));
    if (!user) {
      sendJson(res, 401, { ok: false, error: "Not authenticated" });
      return true;
    }
    sendJson(res, 200, { ok: true, user: user });
    return true;
  }

  return false;
}

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

module.exports = {
  handleAuthRequest: handleAuthRequest,
};
