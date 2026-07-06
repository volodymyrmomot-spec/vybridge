const { sendEmail, layout } = require("./email");

// See lib/deal-emails.js — same leaf-function pattern: calls sendEmail
// (which never throws), but still wrapped in try/catch so a template bug
// can never propagate into the request handler that called it.

// user, requested a password reset — resetUrl already carries the token,
// built by lib/password-reset.js from APP_BASE_URL so it works outside
// any request context.
async function notifyPasswordReset(user, resetUrl) {
  try {
    await sendEmail({
      to: user.email,
      subject: "Reset your Vybridge password",
      html: layout({
        bodyHtml:
          "<p>You requested a password reset. Click the button below to set a new password. This link expires in 1 hour.</p>" +
          "<p>Didn't request this? You can safely ignore this email.</p>",
        ctaText: "Reset password",
        ctaUrl: resetUrl,
      }),
    });
  } catch (err) {
    console.error("[email] notifyPasswordReset failed for user " + user.id + ":", err.message);
  }
}

module.exports = {
  notifyPasswordReset: notifyPasswordReset,
};
