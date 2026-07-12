const { getUserFromSession, getSessionIdFromRequest } = require("./sessions");
const prisma = require("./prisma");
const { detectCms } = require("./cms-detect");
const { updateSiteInfo, getPublicSite } = require("./sites");

const VERIFY_ROUTE = /^\/api\/sites\/([^/]+)\/verify$/;
const VERIFY_WINDOW_MS = 24 * 60 * 60 * 1000;
const DETECT_CMS_ROUTE = /^\/api\/sites\/([^/]+)\/detect-cms$/;
const PUBLIC_SITE_ROUTE = /^\/api\/sites\/([^/]+)\/public$/;
const SITE_ROUTE = /^\/api\/sites\/([^/]+)$/;

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
  const siteMatch = !verifyMatch && !detectCmsMatch && url.pathname.match(SITE_ROUTE);
  const match = verifyMatch || detectCmsMatch || siteMatch;

  if (!match) {
    return false;
  }
  if (req.method !== "GET" && !(siteMatch && req.method === "PUT")) {
    return false;
  }

  const user = await getUserFromSession(getSessionIdFromRequest(req));
  if (!user) {
    sendJson(res, 401, { ok: false, error: "Not authenticated" });
    return true;
  }

  const siteKey = decodeURIComponent(match[1]);

  // Editing audience info — the only route here that writes anything.
  if (siteMatch) {
    const body = await readJsonBody(req, readBody);
    const result = await updateSiteInfo({ publisherId: user.id, siteKey: siteKey, body: body });
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
