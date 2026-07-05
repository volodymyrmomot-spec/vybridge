const RESEND_API_URL = "https://api.resend.com/emails";
const FROM_EMAIL = "Vybridge <noreply@vybridge.com>";

// Never touched by an incoming request (webhook handlers and the payout
// cron run outside any HTTP request context), so email links need their own
// base URL rather than reading req.headers.host the way connect-http.js does.
const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:3000";

// Fire-and-forget by design: notification emails are never allowed to affect
// the deal state machine. Every failure path here (missing key, network
// error, non-2xx from Resend) is caught and logged, never thrown, so a
// broken email integration can't block an approval, a refund, or a payout.
async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[email] RESEND_API_KEY is not set — skipping email to " + to + " (" + subject + ")");
    return { ok: false };
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({ from: FROM_EMAIL, to: to, subject: subject, html: html }),
    });

    if (!res.ok) {
      const body = await res.text().catch(function () {
        return "";
      });
      console.error("[email] Resend API error " + res.status + " sending to " + to + ": " + body);
      return { ok: false };
    }

    return { ok: true };
  } catch (err) {
    console.error("[email] Failed to send email to " + to + ":", err.message);
    return { ok: false };
  }
}

// Shared shell for every notification email: logo, a paragraph of body
// HTML, and one CTA button linking back into the app.
function layout({ bodyHtml, ctaText, ctaUrl }) {
  return (
    '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f3f0fb;' +
    'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">' +
    '<tr><td align="center">' +
    '<table role="presentation" width="480" cellpadding="0" cellspacing="0" ' +
    'style="background:#ffffff;border-radius:12px;overflow:hidden;">' +
    '<tr><td style="padding:28px 32px 0;">' +
    '<span style="font-size:20px;font-weight:800;color:#6d28d9;letter-spacing:-0.02em;">vybridge</span>' +
    "</td></tr>" +
    '<tr><td style="padding:24px 32px 8px;color:#0f172a;font-size:15px;line-height:1.6;">' +
    bodyHtml +
    "</td></tr>" +
    '<tr><td style="padding:8px 32px 32px;">' +
    '<a href="' +
    ctaUrl +
    '" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#4f46e5);' +
    'color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;">' +
    ctaText +
    "</a>" +
    "</td></tr>" +
    '<tr><td style="padding:0 32px 24px;color:#94a3b8;font-size:12px;">' +
    "© " +
    new Date().getFullYear() +
    " Vybridge" +
    "</td></tr>" +
    "</table></td></tr></table></body></html>"
  );
}

module.exports = {
  sendEmail: sendEmail,
  layout: layout,
  APP_BASE_URL: APP_BASE_URL,
};
