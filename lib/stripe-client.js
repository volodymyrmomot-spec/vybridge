const Stripe = require("stripe");

// Lazily constructed so that simply requiring this module (which happens at
// server startup, via lib/deals.js and lib/stripe-webhook.js) never crashes
// the whole app just because STRIPE_SECRET_KEY isn't configured yet. The
// error only surfaces when a route actually tries to call Stripe.
let cachedClient = null;

function getClient() {
  if (cachedClient) {
    return cachedClient;
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set — cannot make Stripe API calls");
  }

  // No explicit apiVersion — falls back to the version pinned inside the
  // installed SDK, which is the version it was actually built/tested against.
  cachedClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  return cachedClient;
}

module.exports = new Proxy(
  {},
  {
    get: function (_target, prop) {
      return getClient()[prop];
    },
  }
);
