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
const { handleListingsRequest } = require("./lib/listings-http");
const { handlePublicPagesRequest } = require("./lib/public-pages-http");
const { handleProfileRequest } = require("./lib/profile-http");
const { handleBloggerDealsRequest } = require("./lib/blogger-deals-http");
const { handleBloggersRequest } = require("./lib/bloggers-http");
const { handleAdminRequest } = require("./lib/admin-http");
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
  "/admin": "/admin/index.html",
  "/terms": "/terms/index.html",
  "/privacy": "/privacy/index.html",
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

// Serves the pretty /404 or /error page for a real browser navigation.
// Never lets a missing/unreadable error-page file itself go unhandled —
// falls back to a bare text response rather than hanging the request.
function serveErrorPage(res, statusCode) {
  const dir = statusCode === 404 ? "404" : "error";
  const filePath = path.join(ROOT, dir, "index.html");

  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(statusCode === 404 ? "Not found" : "Internal server error");
      return;
    }
    res.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
    res.end(data);
  });
}

function isApiPath(pathname) {
  return pathname.startsWith("/api/");
}

function serveStatic(req, res, filePath, requestPath) {
  fs.stat(filePath, function (err, stats) {
    if (err || !stats.isFile()) {
      if (isApiPath(requestPath)) {
        return sendJson(res, 404, { ok: false, error: "Not found" });
      }
      return serveErrorPage(res, 404);
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(res);
  });
}

async function handleRequest(req, res) {
  const url = new URL(req.url, "http://" + req.headers.host);

  if (url.pathname === "/health") {
    return sendJson(res, 200, { ok: true, service: "vybridge" });
  }

  // TEMPORARY — triggers the real capturePreview() pipeline (Alpine
  // chromium, actual Cloudinary upload) for one specific diagnostic slot
  // only, so the coordinate-mismatch investigation can inspect real
  // preview data. Hardcoded to a single slot id, not a general trigger.
  // Remove once the investigation is done.
  if (url.pathname === "/api/_internal/diag-capture" && req.method === "POST") {
    const DIAG_SLOT_ID = "fedad32f-21c7-4a1a-a444-b6adc6250620";
    try {
      const { capturePreview } = require("./lib/slot-preview");
      await capturePreview(DIAG_SLOT_ID);
      const prisma = require("./lib/prisma");
      const slot = await prisma.slot.findUnique({ where: { id: DIAG_SLOT_ID } });
      return sendJson(res, 200, {
        ok: true,
        previewStatus: slot.previewStatus,
        previewImageUrl: slot.previewImageUrl,
      });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message });
    }
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
    const handled = await handleListingsRequest(req, res, url, readBody, sendJson);
    if (handled) {
      return;
    }
  } catch (err) {
    console.error("[server] Listings error:", err);
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

  try {
    const handled = await handleAdminRequest(req, res, url, readBody, sendJson);
    if (handled) {
      return;
    }
  } catch (err) {
    console.error("[server] Admin error:", err);
    return sendJson(res, 500, { ok: false, error: "Internal server error" });
  }

  try {
    const handled = await handlePublicPagesRequest(req, res, url);
    if (handled) {
      return;
    }
  } catch (err) {
    console.error("[server] Public pages error:", err);
    return sendJson(res, 500, { ok: false, error: "Internal server error" });
  }

  const filePath = resolveStaticPath(url.pathname);
  if (!filePath) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  serveStatic(req, res, filePath, url.pathname);
}

// Every route above already catches its own handler's errors and returns a
// JSON 500 (those are all /api/* routes by construction). This is the
// backstop for anything that isn't wrapped that way — a bug in static
// serving, a malformed request URL, or a future route added without its
// own try/catch — so a request can never hang with no response at all.
const server = http.createServer(async function (req, res) {
  try {
    await handleRequest(req, res);
  } catch (err) {
    console.error("[server] Unhandled error:", err);
    if (res.headersSent) {
      res.end();
      return;
    }

    let pathname = "/";
    try {
      pathname = new URL(req.url, "http://" + req.headers.host).pathname;
    } catch (parseErr) {
      // Malformed URL — fall through with the "/" default so this still
      // resolves to the HTML error page rather than throwing again.
    }

    if (isApiPath(pathname)) {
      sendJson(res, 500, { ok: false, error: "Internal server error" });
    } else {
      serveErrorPage(res, 500);
    }
  }
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
