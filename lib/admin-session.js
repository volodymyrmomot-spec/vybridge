const crypto = require("crypto");

const COOKIE_NAME = "vybridge_admin_session";
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// Deliberately stateless — no session table/file at all (unlike
// lib/sessions.js's regular user sessions). The cookie value itself is
// "<expiryTimestamp>.<hmac>", so verifying it is just recomputing the HMAC
// and comparing, with no server-side storage to manage or leak. This is
// the entire point of ADMIN_SESSION_SECRET: it's what makes a forged
// cookie infeasible without needing anywhere to revoke a real one.

function sign(payload) {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET is not set");
  }
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) {
    return cookies;
  }
  cookieHeader.split(";").forEach(function (part) {
    const index = part.indexOf("=");
    if (index === -1) {
      return;
    }
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

function buildAdminSessionCookie() {
  const expiresAt = Date.now() + SESSION_MAX_AGE_MS;
  const payload = String(expiresAt);
  const value = payload + "." + sign(payload);
  const maxAge = Math.floor(SESSION_MAX_AGE_MS / 1000);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return (
    COOKIE_NAME + "=" + encodeURIComponent(value) +
    "; Path=/" +
    "; HttpOnly" +
    "; SameSite=Lax" +
    "; Max-Age=" + maxAge +
    secure
  );
}

function buildClearAdminSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return COOKIE_NAME + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" + secure;
}

// Never throws on a malformed/forged cookie — every failure path (missing
// secret, missing cookie, bad shape, bad signature, expired) just means
// "not an admin", same as any other invalid session.
function isAdminAuthenticated(req) {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const value = cookies[COOKIE_NAME];
    if (!value) {
      return false;
    }

    const dotIndex = value.indexOf(".");
    if (dotIndex === -1) {
      return false;
    }
    const payload = value.slice(0, dotIndex);
    const signature = value.slice(dotIndex + 1);

    const expected = sign(payload);
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(signature);
    if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
      return false;
    }

    const expiresAt = Number(payload);
    return Number.isFinite(expiresAt) && expiresAt > Date.now();
  } catch (err) {
    return false;
  }
}

module.exports = {
  COOKIE_NAME: COOKIE_NAME,
  buildAdminSessionCookie: buildAdminSessionCookie,
  buildClearAdminSessionCookie: buildClearAdminSessionCookie,
  isAdminAuthenticated: isAdminAuthenticated,
};
