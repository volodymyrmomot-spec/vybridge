// Single source of truth for the platform's settlement currency. The
// platform's Stripe account settles in EUR (see: SK-registered account,
// default_currency=eur) — a USD-denominated PaymentIntent gets its balance
// transaction converted to EUR by Stripe, and a Transfer's currency must
// match that converted settlement currency, not the original charge
// currency. Hardcoded here and used directly in every Stripe money call
// (never derived from a Slot/Deal row) so a stray non-EUR value on a
// database row can never reintroduce that mismatch.
const PLATFORM_CURRENCY = "eur";

module.exports = {
  PLATFORM_CURRENCY: PLATFORM_CURRENCY,
};
