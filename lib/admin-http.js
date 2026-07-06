const crypto = require("crypto");
const {
  buildAdminSessionCookie,
  buildClearAdminSessionCookie,
  isAdminAuthenticated,
} = require("./admin-session");
const { getOverview, getUsers, deleteUser, getDeals, getSites } = require("./admin");

const USER_ID_ROUTE = /^\/api\/admin\/users\/([^/]+)$/;

function sendJsonWithCookie(res, statusCode, payload, cookie) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Set-Cookie": cookie });
  res.end(JSON.stringify(payload));
}

// Constant-time compare against a password of possibly-different length —
// a plain === would leak the correct length via timing, which matters here
// since ADMIN_PASSWORD is a single long-lived shared secret, not a
// per-user hash with its own salt to absorb that.
function safeCompare(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
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

async function handleAdminRequest(req, res, url, readBody, sendJson) {
  if (url.pathname === "/api/admin/auth" && req.method === "GET") {
    sendJson(res, 200, { ok: true, authenticated: isAdminAuthenticated(req) });
    return true;
  }

  if (url.pathname === "/api/admin/auth" && req.method === "POST") {
    const configuredPassword = process.env.ADMIN_PASSWORD;
    if (!configuredPassword || !process.env.ADMIN_SESSION_SECRET) {
      sendJson(res, 500, { ok: false, error: "Admin panel is not configured" });
      return true;
    }

    const body = await readJsonBody(req, readBody);
    const password = body && body.password ? String(body.password) : "";
    if (!password || !safeCompare(password, configuredPassword)) {
      sendJson(res, 401, { ok: false, error: "Incorrect password" });
      return true;
    }

    sendJsonWithCookie(res, 200, { ok: true }, buildAdminSessionCookie());
    return true;
  }

  if (url.pathname === "/api/admin/auth" && req.method === "DELETE") {
    sendJsonWithCookie(res, 200, { ok: true }, buildClearAdminSessionCookie());
    return true;
  }

  // Every route below requires an admin session — checked once here rather
  // than repeated in each block.
  if (url.pathname.startsWith("/api/admin/")) {
    if (!isAdminAuthenticated(req)) {
      sendJson(res, 401, { ok: false, error: "Not authenticated" });
      return true;
    }

    if (url.pathname === "/api/admin/overview" && req.method === "GET") {
      const overview = await getOverview();
      sendJson(res, 200, { ok: true, overview: overview });
      return true;
    }

    if (url.pathname === "/api/admin/users" && req.method === "GET") {
      const result = await getUsers({ search: url.searchParams.get("search"), page: url.searchParams.get("page") });
      sendJson(res, 200, Object.assign({ ok: true }, result));
      return true;
    }

    const userIdMatch = url.pathname.match(USER_ID_ROUTE);
    if (userIdMatch && req.method === "DELETE") {
      const result = await deleteUser(decodeURIComponent(userIdMatch[1]));
      sendJson(res, result.status, result.body);
      return true;
    }

    if (url.pathname === "/api/admin/deals" && req.method === "GET") {
      const result = await getDeals({ status: url.searchParams.get("status"), page: url.searchParams.get("page") });
      sendJson(res, 200, Object.assign({ ok: true }, result));
      return true;
    }

    if (url.pathname === "/api/admin/sites" && req.method === "GET") {
      const result = await getSites({ page: url.searchParams.get("page") });
      sendJson(res, 200, Object.assign({ ok: true }, result));
      return true;
    }
  }

  return false;
}

module.exports = {
  handleAdminRequest: handleAdminRequest,
};
