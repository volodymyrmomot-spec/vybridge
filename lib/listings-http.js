const { getPublicListing } = require("./listings");

const PUBLIC_LISTING_ROUTE = /^\/api\/listings\/([^/]+)\/public$/;

// Public, unauthenticated. No other /api/listings/* routes exist in Stage
// 1 — no publish/pause endpoint (Listings are created active directly, see
// lib/slots.js's finalizeSlot) and no create/edit endpoint (no editor UI
// exists yet).
async function handleListingsRequest(req, res, url, readBody, sendJson) {
  const match = url.pathname.match(PUBLIC_LISTING_ROUTE);
  if (!match || req.method !== "GET") {
    return false;
  }

  const slug = decodeURIComponent(match[1]);
  const result = await getPublicListing(slug);
  if (!result) {
    sendJson(res, 404, { ok: false, error: "Listing not found" });
    return true;
  }

  sendJson(res, 200, { ok: true, listing: result.listing, site: result.site, slot: result.slot });
  return true;
}

module.exports = {
  handleListingsRequest: handleListingsRequest,
};
