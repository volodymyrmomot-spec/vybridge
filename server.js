const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { handleAuthRequest } = require("./lib/auth");
const { handleDealsRequest } = require("./lib/deals-http");
const { handleDashboardRequest } = require("./lib/dashboard-http");
const { handleConnectRequest } = require("./lib/connect-http");
const { handleSlotsRequest } = require("./lib/slots-http");
const { handlePickerRequest } = require("./lib/picker-http");
const { handleWidgetRequest } = require("./lib/widget-http");
const { handleClicksRequest } = require("./lib/clicks-http");
const { handleConfigRequest } = require("./lib/config-http");
const { handleSitesRequest } = require("./lib/sites-http");
const { handleProfileRequest } = require("./lib/profile-http");
const { handleBloggerDealsRequest } = require("./lib/blogger-deals-http");
const { handleBloggersRequest } = require("./lib/bloggers-http");
const { recordScriptLoad } = require("./lib/script-track");
const { handleStripeWebhookRequest } = require("./lib/stripe-webhook");
const { runCronCycle } = require("./lib/payout-cron");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    req.on("data", function (chunk) {
      chunks.push(chunk);
    });
    req.on("end", function () {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

const REWRITES = {
  "/register": "/register/index.html",
  "/login": "/login/index.html",
  "/forgot-password": "/forgot-password/index.html",
  "/reset-password": "/reset-password/index.html",
  "/dashboard": "/dashboard/index.html",
  "/slots": "/slots/index.html",
  "/slots/new": "/slots/new/index.html",
  "/connect/return": "/connect/return/index.html",
  "/profile": "/profile/index.html",
  "/bloggers": "/bloggers/index.html",
};

function resolveStaticPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  let relative = REWRITES[decoded] || decoded;

  if (relative === "/" || relative === "") {
    relative = "/index.html";
  }

  let filePath = path.normalize(path.join(ROOT, relative));

  if (!filePath.startsWith(ROOT)) {
    return null;
  }

  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
    return filePath;
  }

  if (!path.extname(filePath)) {
    const indexPath = path.join(filePath, "index.html");
    if (fs.existsSync(indexPath)) {
      return indexPath;
    }
  }

  return filePath;
}

function serveStatic(req, res, filePath) {
  fs.stat(filePath, function (err, stats) {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async function (req, res) {
  const url = new URL(req.url, "http://" + req.headers.host);

  if (url.pathname === "/health") {
    return sendJson(res, 200, { ok: true, service: "vybridge" });
  }

  // Reads the raw request body itself (needed for Stripe signature
  // verification) — must be handled before any route below touches the
  // request stream via readBody().
  if (url.pathname === "/api/stripe/webhook" && req.method === "POST") {
    try {
      return await handleStripeWebhookRequest(req, res, sendJson);
    } catch (err) {
      console.error("[server] Stripe webhook error:", err);
      return sendJson(res, 500, { ok: false, error: "Internal server error" });
    }
  }

  // Fire-and-forget — recordScriptLoad has its own try/catch, and w.js must
  // always be served below (via the static-file fallback) regardless of
  // whether this write succeeds.
  if (url.pathname === "/w.js" && req.method === "GET") {
    recordScriptLoad(req);
  }

  try {
    const handled = await handleAuthRequest(req, res, url, readBody, sendJson);
    if (handled) {
      return;
    }
  } catch (err) {
    console.error("[server] Auth error:", err);
    return sendJson(res, 500, { ok: false, error: "Internal server error" });
  }

  try {
    const handled = await handleDealsRequest(req, res, url, readBody, sendJson);
    if (handled) {
      return;
    }
  } catch (err) {
    console.error("[server] Deals error:", err);
    return sendJson(res, 500, { ok: false, error: "Internal server error" });
  }

  try {
    const handled = await handleDashboardRequest(req, res, url, sendJson);
    if (handled) {
      return;
    }
  } catch (err) {
    console.error("[server] Dashboard error:", err);
    return sendJson(res, 500, { ok: false, error: "Internal server error" });
  }

  try {
    const handled = await handleConnectRequest(req, res, url, sendJson);
    if (handled) {
      return;
    }
  } catch (err) {
    console.error("[server] Connect error:", err);
    return sendJson(res, 500, { ok: false, error: "Internal server error" });
  }

  try {
    const handled = await handleSlotsRequest(req, res, url, readBody, sendJson);
    if (handled) {
      return;
    }
  } catch (err) {
    console.error("[server] Slots error:", err);
    return sendJson(res, 500, { ok: false, error: "Internal server error" });
  }

  try {
    const handled = await handlePickerRequest(req, res, url, readBody, sendJson);
    if (handled) {
      return;
    }
  } catch (err) {
    console.error("[server] Picker error:", err);
    return sendJson(res, 500, { ok: false, error: "Internal server error" });
  }

  try {
    const handled = await handleWidgetRequest(req, res, url);
    if (handled) {
      return;
    }
  } catch (err) {
    console.error("[server] Widget error:", err);
    return sendJson(res, 500, { ok: false, error: "Internal server error" });
  }

  try {
    const handled = await handleClicksRequest(req, res, url, sendJson);
    if (handled) {
      return;
    }
  } catch (err) {
    console.error("[server] Clicks error:", err);
    return sendJson(res, 500, { ok: false, error: "Internal server error" });
  }

  try {
    const handled = await handleConfigRequest(req, res, url, sendJson);
    if (handled) {
      return;
    }
  } catch (err) {
    console.error("[server] Config error:", err);
    return sendJson(res, 500, { ok: false, error: "Internal server error" });
  }

  try {
    const handled = await handleSitesRequest(req, res, url, readBody, sendJson);
    if (handled) {
      return;
    }
  } catch (err) {
    console.error("[server] Sites error:", err);
    return sendJson(res, 500, { ok: false, error: "Internal server error" });
  }

  try {
    const handled = await handleProfileRequest(req, res, url, readBody, sendJson);
    if (handled) {
      return;
    }
  } catch (err) {
    console.error("[server] Profile error:", err);
    return sendJson(res, 500, { ok: false, error: "Internal server error" });
  }

  try {
    const handled = await handleBloggerDealsRequest(req, res, url, readBody, sendJson);
    if (handled) {
      return;
    }
  } catch (err) {
    console.error("[server] Blogger deals error:", err);
    return sendJson(res, 500, { ok: false, error: "Internal server error" });
  }

  try {
    const handled = await handleBloggersRequest(req, res, url, sendJson);
    if (handled) {
      return;
    }
  } catch (err) {
    console.error("[server] Bloggers error:", err);
    return sendJson(res, 500, { ok: false, error: "Internal server error" });
  }

  const filePath = resolveStaticPath(url.pathname);
  if (!filePath) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  serveStatic(req, res, filePath);
});

server.listen(PORT, "0.0.0.0", function () {
  console.log("Vybridge server listening on port " + PORT);
});

server.on("error", function (err) {
  console.error("[server] Failed to start:", err);
  process.exit(1);
});

// In-process scheduler for auto-approve / completion / payout release.
// Deliberately not a separate worker: this service runs as a single
// instance on Railway, so there's no risk of two schedulers racing. Every
// step the cron takes is idempotent (conditional updateMany + Stripe
// idempotency keys), so even a duplicate tick is harmless — but if this
// service is ever scaled to multiple instances, move this to a dedicated
// Railway cron service instead so it doesn't run N times per tick.
const CRON_INTERVAL_MS = Number(process.env.CRON_INTERVAL_MINUTES || 5) * 60 * 1000;

function tickCron() {
  runCronCycle().catch(function (err) {
    console.error("[cron] cycle failed:", err);
  });
}

setInterval(tickCron, CRON_INTERVAL_MS);
tickCron();
