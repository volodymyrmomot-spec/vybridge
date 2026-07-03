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

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=60",
  });
  res.end(JSON.stringify(slots));
  return true;
}

module.exports = {
  handleWidgetRequest: handleWidgetRequest,
};
