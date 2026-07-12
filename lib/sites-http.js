const { getUserFromSession, getSessionIdFromRequest } = require("./sessions");
const prisma = require("./prisma");
const { detectCms } = require("./cms-detect");
const { updateSiteInfo, getPublicSite, getPublicSites, uploadSiteCoverImage, removeSiteCoverImage } = require("./sites");
const { parseMultipart, ALLOWED_CREATIVE_MIME_TYPES } = require("./multipart");

const VERIFY_ROUTE = /^\/api\/sites\/([^/]+)\/verify$/;
const VERIFY_WINDOW_MS = 24 * 60 * 60 * 1000;
const DETECT_CMS_ROUTE = /^\/api\/sites\/([^/]+)\/detect-cms$/;
const COVER_ROUTE = /^\/api\/sites\/([^/]+)\/cover$/;
const PUBLIC_SITE_ROUTE = /^\/api\/sites\/([^/]+)\/public$/;
const SITE_ROUTE = /^\/api\/sites\/([^/]+)$/;
const PUBLIC_SITES_LIST_ROUTE = "/api/sites/public";

async function readJsonBody(req, readBody) {
  const raw = await readBody(req);
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

async function handleSitesRequest(req, res, url, readBody, sendJson) {
  // Marketplace catalog — checked before PUBLIC_SITE_ROUTE since that regex
  // requires two path segments after /api/sites/ ("/:slug/public") and this
  // is a single exact one ("/public"), so there's no ambiguity between them.
  if (url.pathname === PUBLIC_SITES_LIST_ROUTE && req.method === "GET") {
    const sites = await getPublicSites();
    sendJson(res, 200, { ok: true, sites: sites });
    return true;
  }

  // Public, unauthenticated — checked first and returns on its own, since
  // every other route below this point requires a session.
  const publicSiteMatch = url.pathname.match(PUBLIC_SITE_ROUTE);
  if (publicSiteMatch && req.method === "GET") {
    const slug = decodeURIComponent(publicSiteMatch[1]);
    const site = await getPublicSite(slug);
    if (!site) {
      sendJson(res, 404, { ok: false, error: "Site not found" });
      return true;
    }
    sendJson(res, 200, { ok: true, site: site });
    return true;
  }

  const verifyMatch = url.pathname.match(VERIFY_ROUTE);
  const detectCmsMatch = url.pathname.match(DETECT_CMS_ROUTE);
  const coverMatch = url.pathname.match(COVER_ROUTE);
  const siteMatch = !verifyMatch && !detectCmsMatch && !coverMatch && url.pathname.match(SITE_ROUTE);
  const match = verifyMatch || detectCmsMatch || coverMatch || siteMatch;

  if (!match) {
    return false;
  }
  const coverMethodOk = coverMatch && (req.method === "POST" || req.method === "DELETE");
  if (req.method !== "GET" && !(siteMatch && req.method === "PUT") && !coverMethodOk) {
    return false;
  }

  const user = await getUserFromSession(getSessionIdFromRequest(req));
  if (!user) {
    sendJson(res, 401, { ok: false, error: "Not authenticated" });
    return true;
  }

  const siteKey = decodeURIComponent(match[1]);

  // Editing audience info — the only JSON-body route here that writes
  // anything.
  if (siteMatch) {
    const body = await readJsonBody(req, readBody);
    const result = await updateSiteInfo({ publisherId: user.id, siteKey: siteKey, body: body });
    sendJson(res, result.status, result.body);
    return true;
  }

  // Marketplace cover — manual upload today (see prisma/schema.prisma's
  // CoverSource enum for the other sources this same shape will support
  // later). Ownership is checked inside uploadSiteCoverImage/
  // removeSiteCoverImage, same as updateSiteInfo above, so there's no
  // separate lookup needed here.
  if (coverMatch) {
    if (req.method === "DELETE") {
      const result = await removeSiteCoverImage({ publisherId: user.id, siteKey: siteKey });
      sendJson(res, result.status, result.body);
      return true;
    }

    const contentType = req.headers["content-type"] || "";
    if (!contentType.startsWith("multipart/form-data")) {
      sendJson(res, 400, { ok: false, error: "Expected multipart/form-data with a cover image" });
      return true;
    }

    let parsed;
    try {
      parsed = await parseMultipart(req);
    } catch (err) {
      sendJson(res, 400, { ok: false, error: "Could not read the uploaded file" });
      return true;
    }

    if (parsed.fileTooLarge) {
      sendJson(res, 400, { ok: false, error: "Image must be under 2MB" });
      return true;
    }
    if (!parsed.file) {
      sendJson(res, 400, { ok: false, error: "Upload a cover image" });
      return true;
    }
    if (!ALLOWED_CREATIVE_MIME_TYPES.includes(parsed.file.mimeType)) {
      sendJson(res, 400, { ok: false, error: "Image must be JPG, PNG, GIF, or WebP" });
      return true;
    }

    const result = await uploadSiteCoverImage({ publisherId: user.id, siteKey: siteKey, file: parsed.file });
    sendJson(res, result.status, result.body);
    return true;
  }

  const site = await prisma.site.findUnique({ where: { siteKey: siteKey } });
  if (!site || site.publisherId !== user.id) {
    sendJson(res, 404, { ok: false, error: "Site not found" });
    return true;
  }

  // Powers the "Code detected ✓" indicator on the install guide — true once
  // a GET /w.js request from this site's domain has been recorded (see
  // lib/script-track.js) in the last 24h.
  if (verifyMatch) {
    const verified = !!(site.lastScriptLoadAt && site.lastScriptLoadAt.getTime() > Date.now() - VERIFY_WINDOW_MS);
    sendJson(res, 200, { ok: true, verified: verified });
    return true;
  }

  // Powers auto-selecting the right install-guide tab — fetches the
  // publisher's own site and looks for CMS-specific markers in the HTML.
  const cms = await detectCms(site.domain);
  sendJson(res, 200, { ok: true, cms: cms });
  return true;
}

module.exports = {
  handleSitesRequest: handleSitesRequest,
};
