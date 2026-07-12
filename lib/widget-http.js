const { getWidgetSlots } = require("./widget");

const WIDGET_ROUTE = /^\/api\/widget\/([^/]+)$/;

function getBaseUrl(req) {
  const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
  return protocol + "://" + req.headers.host;
}

async function handleWidgetRequest(req, res, url) {
  const match = url.pathname.match(WIDGET_ROUTE);
  if (!match) {
    return false;
  }

  // Fetched via JS from the publisher's own domain — needs CORS. Public,
  // read-only, no credentials involved, so a wide-open origin is fine.
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.writeHead(204);
    res.end();
    return true;
  }

  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
    return true;
  }

  const siteKey = decodeURIComponent(match[1]);
  const slots = await getWidgetSlots({ siteKey: siteKey, baseUrl: getBaseUrl(req) });

  // Fetched exactly once per page load (see w.js's startAdServing) — freshness
  // matters more than shaving one cheap query, since a publisher deleting a
  // slot expects it gone on the very next reload, not up to a minute later
  // from a stale browser/CDN cache entry a "public, max-age" would allow.
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(slots));
  return true;
}

module.exports = {
  handleWidgetRequest: handleWidgetRequest,
};
