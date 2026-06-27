const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { handleCampaignRequest } = require("./lib/campaign-requests");

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
  "/create-campaign": "/create-campaign/index.html",
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

  if (url.pathname === "/api/campaign-requests" && req.method === "POST") {
    try {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const result = handleCampaignRequest(body);
      return sendJson(res, result.status, result.body);
    } catch (err) {
      console.error("[server] Campaign request error:", err);
      return sendJson(res, 500, { ok: false, error: "Internal server error" });
    }
  }

  if (url.pathname === "/api/campaign-requests" && req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
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
