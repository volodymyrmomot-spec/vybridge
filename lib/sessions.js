const crypto = require("crypto");
const { readArray, writeArray } = require("./storage");
const { findUserById, publicUser } = require("./users");

const FILE = "sessions.json";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = "vybridge_session";

function readSessions() {
  return readArray(FILE);
}

function writeSessions(sessions) {
  writeArray(FILE, sessions);
}

function cleanupSessions(sessions) {
  const now = Date.now();
  return sessions.filter(function (session) {
    return new Date(session.expiresAt).getTime() > now;
  });
}

function createSession(userId) {
  const sessions = cleanupSessions(readSessions());
  const session = {
    id: crypto.randomUUID(),
    userId: userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString(),
  };

  sessions.push(session);
  writeSessions(sessions);
  return session;
}

function deleteSession(sessionId) {
  const sessions = readSessions().filter(function (session) {
    return session.id !== sessionId;
  });
  writeSessions(sessions);
}

function getSession(sessionId) {
  if (!sessionId) {
    return null;
  }

  const sessions = cleanupSessions(readSessions());
  const session = sessions.find(function (item) {
    return item.id === sessionId;
  });

  if (!session) {
    return null;
  }

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    deleteSession(session.id);
    return null;
  }

  return session;
}

async function getUserFromSession(sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    return null;
  }

  const user = await findUserById(session.userId);
  return user ? publicUser(user) : null;
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

function getSessionIdFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[COOKIE_NAME] || null;
}

function buildSessionCookie(sessionId) {
  const maxAge = Math.floor(SESSION_MAX_AGE_MS / 1000);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return (
    COOKIE_NAME + "=" + encodeURIComponent(sessionId) +
    "; Path=/" +
    "; HttpOnly" +
    "; SameSite=Lax" +
    "; Max-Age=" + maxAge +
    secure
  );
}

function buildClearSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return COOKIE_NAME + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" + secure;
}

module.exports = {
  COOKIE_NAME: COOKIE_NAME,
  createSession: createSession,
  deleteSession: deleteSession,
  getUserFromSession: getUserFromSession,
  getSessionIdFromRequest: getSessionIdFromRequest,
  buildSessionCookie: buildSessionCookie,
  buildClearSessionCookie: buildClearSessionCookie,
};
