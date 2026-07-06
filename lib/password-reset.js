const crypto = require("crypto");
const prisma = require("./prisma");
const { hashPassword } = require("./password");
const { findUserByEmail } = require("./users");
const { deleteSessionsForUser } = require("./sessions");
const { notifyPasswordReset } = require("./auth-emails");
const { APP_BASE_URL } = require("./email");

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// Always returns the same shape whether or not the email is registered —
// the caller (lib/auth.js) must never branch on this to reveal account
// existence. Only ever one active token per user: any previous unused
// token is invalidated first, so an older reset email can't be replayed
// once a newer one has been requested.
async function requestPasswordReset(email) {
  const user = await findUserByEmail(email);
  if (!user) {
    return { status: 200, body: { ok: true } };
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { userId: user.id, used: false },
      data: { used: true },
    }),
    prisma.passwordResetToken.create({
      data: { userId: user.id, token: token, expiresAt: expiresAt },
    }),
  ]);

  await notifyPasswordReset(user, APP_BASE_URL + "/reset-password?token=" + token);

  return { status: 200, body: { ok: true } };
}

async function resetPassword({ token, password }) {
  if (!password || String(password).length < 8) {
    return { status: 400, body: { ok: false, errors: { password: "Password must be at least 8 characters" } } };
  }

  const resetToken = token ? await prisma.passwordResetToken.findUnique({ where: { token: String(token) } }) : null;
  if (!resetToken || resetToken.used || resetToken.expiresAt.getTime() <= Date.now()) {
    return { status: 400, body: { ok: false, error: "This reset link is invalid or has expired." } };
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash: hashPassword(String(password)) },
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { used: true },
    }),
  ]);

  // Password reset is exactly the situation where any session — including
  // one an attacker holds — must not survive the change.
  deleteSessionsForUser(resetToken.userId);

  return { status: 200, body: { ok: true } };
}

module.exports = {
  requestPasswordReset: requestPasswordReset,
  resetPassword: resetPassword,
};
