// Publishable key only — never the secret key. Served from an env var
// instead of hardcoded into the static page so it can be swapped without
// touching a deployed file.
async function handleConfigRequest(req, res, url, sendJson) {
  if (url.pathname !== "/api/config" || req.method !== "GET") {
    return false;
  }

  sendJson(res, 200, {
    ok: true,
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
  });
  return true;
}

module.exports = {
  handleConfigRequest: handleConfigRequest,
};
