const { recordClickAndGetDestination } = require("./clicks");

const CLICK_ROUTE = /^\/api\/clicks\/([^/]+)$/;

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return String(forwarded).split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

// GET, not POST — this is a link the visitor's browser navigates to
// directly (opened in a new tab by w.js), so it needs to be a normal
// navigable request that can carry an HTTP redirect. A POST response can't
// do that without extra client-side plumbing (fetch() would just download
// the advertiser's page into JS instead of navigating the tab there), so
// this deviates from the original "POST /api/clicks/:deal_id" — same
// effect (records the click, sends the visitor on), simpler and matches
// how every ad click-tracking redirect on the web actually works.
async function handleClicksRequest(req, res, url, sendJson) {
  const match = url.pathname.match(CLICK_ROUTE);
  if (!match || req.method !== "GET") {
    return false;
  }

  const dealId = decodeURIComponent(match[1]);
  const destination = await recordClickAndGetDestination({
    dealId: dealId,
    ip: getClientIp(req),
    userAgent: req.headers["user-agent"] || null,
  });

  if (!destination) {
    sendJson(res, 404, { ok: false, error: "Unknown ad" });
    return true;
  }

  res.writeHead(302, { Location: destination });
  res.end();
  return true;
}

module.exports = {
  handleClicksRequest: handleClicksRequest,
};
