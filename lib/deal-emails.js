const { sendEmail, layout, APP_BASE_URL } = require("./email");
const { formatMoney } = require("./currency");

// Every function here is a leaf: it renders one template and calls
// sendEmail (which never throws). Wrapped in its own try/catch anyway so a
// bug in template building (e.g. a missing relation the caller forgot to
// include()) can never propagate into the deal state machine that called it.

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(date) {
  return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// publisher, deal enters pending_approval
async function notifyPendingApproval(deal) {
  try {
    const label = escapeHtml(deal.slot.label);
    const price = formatMoney(deal.slotPriceCents, deal.currency);

    await sendEmail({
      to: deal.publisher.email,
      subject: "New ad request for " + deal.slot.label,
      html: layout({
        bodyHtml:
          "<p>New ad request for your slot <strong>" + label + "</strong> — " + price + ".</p>" +
          "<p>Login to approve or reject.</p>",
        ctaText: "Review request",
        ctaUrl: APP_BASE_URL + "/dashboard",
      }),
    });
  } catch (err) {
    console.error("[email] notifyPendingApproval failed for deal " + deal.id + ":", err.message);
  }
}

// advertiser, publisher manually approved
async function notifyApproved(deal) {
  try {
    const domain = escapeHtml(deal.slot.site.domain);
    const endsAt = formatDate(deal.endsAt);

    await sendEmail({
      to: deal.advertiser.email,
      subject: "Your ad is now live",
      html: layout({
        bodyHtml:
          "<p>Your ad was approved and is now live on <strong>" + domain + "</strong>.</p>" +
          "<p>It runs until " + endsAt + ".</p>",
        ctaText: "View dashboard",
        ctaUrl: APP_BASE_URL + "/dashboard",
      }),
    });
  } catch (err) {
    console.error("[email] notifyApproved failed for deal " + deal.id + ":", err.message);
  }
}

// advertiser, publisher never responded within AUTO_APPROVE_HOURS
async function notifyAutoApproved(deal) {
  try {
    await sendEmail({
      to: deal.advertiser.email,
      subject: "Your ad is now live",
      html: layout({
        bodyHtml:
          "<p>Your ad was automatically approved and is now live.</p>" +
          "<p>Publisher didn't respond within 48 hours.</p>",
        ctaText: "View dashboard",
        ctaUrl: APP_BASE_URL + "/dashboard",
      }),
    });
  } catch (err) {
    console.error("[email] notifyAutoApproved failed for deal " + deal.id + ":", err.message);
  }
}

// advertiser, publisher rejected the creative (full refund already issued)
async function notifyRejected(deal) {
  try {
    const price = formatMoney(deal.totalChargedCents, deal.currency);

    await sendEmail({
      to: deal.advertiser.email,
      subject: "Your ad request was declined",
      html: layout({
        bodyHtml:
          "<p>Your ad request was declined.</p>" +
          "<p>Your payment of " + price + " has been refunded.</p>",
        ctaText: "Browse other slots",
        ctaUrl: APP_BASE_URL + "/slots",
      }),
    });
  } catch (err) {
    console.error("[email] notifyRejected failed for deal " + deal.id + ":", err.message);
  }
}

// publisher, payout transfer succeeded
async function notifyPayoutReleased(deal) {
  try {
    const label = escapeHtml(deal.slot.label);
    const price = formatMoney(deal.slotPriceCents, deal.currency);

    await sendEmail({
      to: deal.publisher.email,
      subject: "You've been paid " + price,
      html: layout({
        bodyHtml:
          "<p>You've been paid " + price + " for your ad slot <strong>" + label + "</strong>.</p>" +
          "<p>Check your Stripe account.</p>",
        ctaText: "View dashboard",
        ctaUrl: APP_BASE_URL + "/dashboard",
      }),
    });
  } catch (err) {
    console.error("[email] notifyPayoutReleased failed for deal " + deal.id + ":", err.message);
  }
}

module.exports = {
  notifyPendingApproval: notifyPendingApproval,
  notifyApproved: notifyApproved,
  notifyAutoApproved: notifyAutoApproved,
  notifyRejected: notifyRejected,
  notifyPayoutReleased: notifyPayoutReleased,
};
