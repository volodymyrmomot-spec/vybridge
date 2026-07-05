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

// publisher or blogger, payout transfer succeeded — deal.slot is set for
// the ad-slot vertical, deal.bloggerChannel for the blogger vertical
// (never both), so the label just picks whichever relation is present.
async function notifyPayoutReleased(deal) {
  try {
    const label = escapeHtml(deal.slot ? deal.slot.label : channelLabel(deal.bloggerChannel));
    const price = formatMoney(deal.slotPriceCents, deal.currency);

    await sendEmail({
      to: deal.publisher.email,
      subject: "You've been paid " + price,
      html: layout({
        bodyHtml:
          "<p>You've been paid " + price + " for <strong>" + label + "</strong>.</p>" +
          "<p>Check your Stripe account.</p>",
        ctaText: "View dashboard",
        ctaUrl: APP_BASE_URL + "/dashboard",
      }),
    });
  } catch (err) {
    console.error("[email] notifyPayoutReleased failed for deal " + deal.id + ":", err.message);
  }
}

function channelLabel(channel) {
  return channel.channelHandle || channel.platform;
}

// blogger, new offer sent to one of their channels
async function notifyBloggerNewOffer(deal) {
  try {
    const label = escapeHtml(channelLabel(deal.bloggerChannel));
    const price = formatMoney(deal.slotPriceCents, deal.currency);

    await sendEmail({
      to: deal.publisher.email,
      subject: "New offer for your " + deal.bloggerChannel.platform + " channel",
      html: layout({
        bodyHtml:
          "<p>New offer for <strong>" + label + "</strong> — " + price + ".</p>" +
          "<p>Login to accept or decline.</p>",
        ctaText: "Review offer",
        ctaUrl: APP_BASE_URL + "/dashboard",
      }),
    });
  } catch (err) {
    console.error("[email] notifyBloggerNewOffer failed for deal " + deal.id + ":", err.message);
  }
}

// advertiser, blogger accepted the offer
async function notifyOfferAccepted(deal) {
  try {
    const label = escapeHtml(channelLabel(deal.bloggerChannel));

    await sendEmail({
      to: deal.advertiser.email,
      subject: "Your offer was accepted",
      html: layout({
        bodyHtml:
          "<p><strong>" + label + "</strong> accepted your offer.</p>" +
          "<p>You'll be notified once the post goes live.</p>",
        ctaText: "View dashboard",
        ctaUrl: APP_BASE_URL + "/dashboard",
      }),
    });
  } catch (err) {
    console.error("[email] notifyOfferAccepted failed for deal " + deal.id + ":", err.message);
  }
}

// advertiser, blogger declined the offer (full refund already issued)
async function notifyOfferDeclined(deal) {
  try {
    const price = formatMoney(deal.totalChargedCents, deal.currency);

    await sendEmail({
      to: deal.advertiser.email,
      subject: "Your offer was declined",
      html: layout({
        bodyHtml:
          "<p>Your offer was declined.</p>" +
          "<p>Your payment of " + price + " has been refunded.</p>",
        ctaText: "Browse other bloggers",
        ctaUrl: APP_BASE_URL + "/bloggers",
      }),
    });
  } catch (err) {
    console.error("[email] notifyOfferDeclined failed for deal " + deal.id + ":", err.message);
  }
}

// advertiser, blogger marked the campaign as published
async function notifyBloggerPublished(deal) {
  try {
    const label = escapeHtml(channelLabel(deal.bloggerChannel));
    const postUrl = escapeHtml(deal.publishedUrl);

    await sendEmail({
      to: deal.advertiser.email,
      subject: "Your post is live",
      html: layout({
        bodyHtml:
          "<p><strong>" + label + "</strong> published your post: <a href=\"" + postUrl + "\">" + postUrl + "</a></p>" +
          "<p>Confirm it looks right, or it will auto-confirm in 48 hours.</p>",
        ctaText: "Review post",
        ctaUrl: APP_BASE_URL + "/dashboard",
      }),
    });
  } catch (err) {
    console.error("[email] notifyBloggerPublished failed for deal " + deal.id + ":", err.message);
  }
}

module.exports = {
  notifyPendingApproval: notifyPendingApproval,
  notifyApproved: notifyApproved,
  notifyAutoApproved: notifyAutoApproved,
  notifyRejected: notifyRejected,
  notifyPayoutReleased: notifyPayoutReleased,
  notifyBloggerNewOffer: notifyBloggerNewOffer,
  notifyOfferAccepted: notifyOfferAccepted,
  notifyOfferDeclined: notifyOfferDeclined,
  notifyBloggerPublished: notifyBloggerPublished,
};
