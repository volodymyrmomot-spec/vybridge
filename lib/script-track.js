const prisma = require("./prisma");

// The publisher's page requests /w.js with a normal cross-origin GET, so the
// browser's default referrer policy sends the page's origin (not the full
// path) in the Referer header — exactly enough to identify which domain
// installed the script.
function extractRefererHostname(req) {
  const referer = req.headers.referer || req.headers.referrer;
  if (!referer) {
    return null;
  }
  try {
    return new URL(referer).hostname.replace(/^www\./i, "").toLowerCase();
  } catch (err) {
    return null;
  }
}

// Fire-and-forget from server.js: recording an install ping must never
// affect w.js actually being served, so every failure path here is caught
// and logged, never thrown.
async function recordScriptLoad(req) {
  const hostname = extractRefererHostname(req);
  if (!hostname) {
    return;
  }

  try {
    // Sites are registered from a URL the publisher typed in themselves, so
    // match with or without a "www." prefix rather than requiring an exact
    // string match against whatever they happened to enter.
    await prisma.site.updateMany({
      where: { OR: [{ domain: hostname }, { domain: "www." + hostname }] },
      data: { lastScriptLoadAt: new Date() },
    });
  } catch (err) {
    console.error("[script-track] Failed to record load for " + hostname + ":", err.message);
  }
}

module.exports = {
  recordScriptLoad: recordScriptLoad,
};
