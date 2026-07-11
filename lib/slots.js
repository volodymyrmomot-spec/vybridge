const prisma = require("./prisma");
const { PLATFORM_CURRENCY } = require("./currency");
const { resolveFeeBps, calculatePlatformFeeCents } = require("./fees");
const { monthlyVisitorsFromPrisma } = require("./sites");

// Standard IAB-style banner sizes — the only shapes a publisher can pick
// from for now. Keeps the form to one dropdown instead of two freeform
// width/height fields, and guarantees width/height always match the format
// string.
const AD_FORMATS = [
  { value: "728x90", label: "Leaderboard (728×90)", width: 728, height: 90 },
  { value: "300x250", label: "Medium Rectangle (300×250)", width: 300, height: 250 },
  { value: "320x50", label: "Mobile Banner (320×50)", width: 320, height: 50 },
  { value: "336x280", label: "Large Rectangle (336×280)", width: 336, height: 280 },
  { value: "160x600", label: "Wide Skyscraper (160×600)", width: 160, height: 600 },
  { value: "300x600", label: "Half Page (300×600)", width: 300, height: 600 },
  { value: "970x250", label: "Billboard (970×250)", width: 970, height: 250 },
];

const MAX_DURATION_DAYS = 365;

// Sentinel format for a slot created mid-picker-flow (URL submitted, spot
// not picked/confirmed yet) — never a real, bookable slot. Filtered out of
// the publisher's own slot list and never eligible for the widget or
// catalog, so an abandoned picker session just leaves an invisible row
// rather than a confusing half-created listing.
const PENDING_FORMAT = "pending";

// Sentinel for a picked spot that doesn't match any standard IAB size — the
// slot's real width/height (from the picked element) are used as-is instead
// of a fixed format's dimensions.
const CUSTOM_FORMAT = "custom";

function findFormat(value) {
  return AD_FORMATS.find(function (f) {
    return f.value === value;
  }) || null;
}

function publicSlot(slot) {
  return {
    id: slot.id,
    label: slot.label,
    format: slot.format,
    width: slot.width,
    height: slot.height,
    priceCents: slot.priceCents,
    currency: slot.currency,
    durationDays: slot.durationDays,
    status: slot.status,
    domSelector: slot.domSelector,
    createdAt: slot.createdAt,
  };
}

function validateFinalizeSlot(body) {
  const errors = {};
  const label = body && body.label ? String(body.label).trim() : "";
  const formatValue = body && body.format ? String(body.format).trim() : "";
  const domSelector = body && body.domSelector ? String(body.domSelector).trim() : "";
  const priceEuros = body && body.priceEuros !== undefined ? Number(body.priceEuros) : NaN;
  const durationDays = body && body.durationDays !== undefined ? Number(body.durationDays) : NaN;

  if (!label) {
    errors.label = "Label is required";
  }

  if (!domSelector) {
    errors.format = "Pick a placement on your page first";
  }

  let width = null;
  let height = null;
  if (formatValue === CUSTOM_FORMAT) {
    width = Math.round(Number(body && body.width));
    height = Math.round(Number(body && body.height));
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      errors.format = "Invalid custom size";
    }
  } else {
    const format = findFormat(formatValue);
    if (!format) {
      errors.format = errors.format || "Choose a valid ad size";
    } else {
      width = format.width;
      height = format.height;
    }
  }

  if (!Number.isFinite(priceEuros) || priceEuros <= 0) {
    errors.priceEuros = "Enter a price greater than 0";
  }

  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > MAX_DURATION_DAYS) {
    errors.durationDays = "Duration must be a whole number of days, up to " + MAX_DURATION_DAYS;
  }

  return {
    errors: errors,
    label: label,
    formatValue: formatValue,
    domSelector: domSelector,
    width: width,
    height: height,
    priceEuros: priceEuros,
    durationDays: durationDays,
  };
}

// Turns a draft slot (created by createPickerSession the moment a publisher
// submits a page URL, format still the "pending" sentinel) into a real,
// bookable one, once the visual picker on their own page has reported back
// a selector/size and the publisher has confirmed label/price/duration.
//
// Slots start as `draft`, not `active` — an advertiser could otherwise book
// a slot for a publisher who has no way to ever receive the payout. Only
// flips to `active` once payouts_enabled is true (see lib/connect.js / the
// account.updated webhook); the dashboard tells the publisher why.
async function finalizeSlot({ publisherId, slotId, body }) {
  const slot = await prisma.slot.findUnique({ where: { id: slotId } });
  if (!slot || slot.publisherId !== publisherId) {
    return { status: 404, body: { ok: false, error: "Slot not found" } };
  }

  const validated = validateFinalizeSlot(body);
  if (Object.keys(validated.errors).length) {
    return { status: 400, body: { ok: false, errors: validated.errors } };
  }

  const stripeAccount = await prisma.stripeAccount.findUnique({ where: { userId: publisherId } });
  const status = stripeAccount && stripeAccount.payoutsEnabled ? "active" : "draft";

  const updated = await prisma.slot.update({
    where: { id: slotId },
    data: {
      label: validated.label,
      domSelector: validated.domSelector.slice(0, 500),
      format: validated.formatValue,
      width: validated.width,
      height: validated.height,
      priceCents: Math.round(validated.priceEuros * 100),
      currency: PLATFORM_CURRENCY,
      durationDays: validated.durationDays,
      status: status,
    },
  });

  return { status: 200, body: { ok: true, slot: publicSlot(updated) } };
}

// Statuses that mean a deal is currently in flight for a slot — everything
// else (created, approved, disputed, completed, payout_released, rejected,
// refunded) is either not yet real money or already settled, so a slot
// stuck in one of those doesn't block deletion.
const ACTIVE_DEAL_STATUSES = ["live", "paid_escrow", "pending_approval"];

// Hard-deletes a slot. deals_slot_id_fkey and picker_tokens_slot_id_fkey are
// both ON DELETE RESTRICT, so any deal ever booked against this slot — even
// a long-finished one — would otherwise block the delete outright; once
// we've confirmed nothing is actively in flight, historical deals are kept
// (their own price/duration/status snapshot is untouched) but unlinked from
// the slot being removed, same as picker tokens.
async function deleteSlot({ publisherId, slotId }) {
  const slot = await prisma.slot.findUnique({ where: { id: slotId } });
  if (!slot || slot.publisherId !== publisherId) {
    return { status: 404, body: { ok: false, error: "Slot not found" } };
  }

  const activeDealCount = await prisma.deal.count({
    where: { slotId: slotId, status: { in: ACTIVE_DEAL_STATUSES } },
  });
  if (activeDealCount > 0) {
    return {
      status: 409,
      body: { ok: false, error: "This slot has active deals. Wait for them to complete before deleting." },
    };
  }

  await prisma.$transaction([
    prisma.pickerToken.deleteMany({ where: { slotId: slotId } }),
    prisma.deal.updateMany({ where: { slotId: slotId }, data: { slotId: null } }),
    prisma.slot.delete({ where: { id: slotId } }),
  ]);

  return { status: 200, body: { ok: true } };
}

// Catalog for advertisers: active slots with no deal currently occupying
// them. `status: 'active'` alone already implies this (booking a slot flips
// it to `booked`), but the explicit deal-status check is a second,
// independent guard against the same race a concurrent booking could
// otherwise expose between "read slot as active" and "write deal".
//
// Includes the requesting advertiser's actual fee tier so the catalog can
// show a real total, not a guess — createDeal resolves the same tier the
// same way at booking time, so what's shown here is what gets charged
// (barring the advertiser crossing a volume threshold in between).
async function getAvailableSlots({ advertiserLifetimeSpendCents }) {
  const [slots, feeBps] = await Promise.all([
    prisma.slot.findMany({
      where: {
        status: "active",
        deals: { none: { status: { in: ["live", "pending_approval"] } } },
      },
      include: { site: true },
      orderBy: { createdAt: "desc" },
    }),
    resolveFeeBps(advertiserLifetimeSpendCents),
  ]);

  return slots.map(function (slot) {
    const platformFeeCents = calculatePlatformFeeCents(slot.priceCents, feeBps);
    return {
      slot_id: slot.id,
      site_domain: slot.site.domain,
      label: slot.label,
      format: slot.format,
      price_cents: slot.priceCents,
      duration_days: slot.durationDays,
      currency: slot.currency,
      platform_fee_bps: feeBps,
      platform_fee_cents: platformFeeCents,
      total_cents: slot.priceCents + platformFeeCents,
      category: slot.site.category,
      monthly_visitors: monthlyVisitorsFromPrisma(slot.site.monthlyVisitors),
      audience_country: slot.site.audienceCountry,
      audience_language: slot.site.audienceLanguage,
    };
  });
}

module.exports = {
  AD_FORMATS: AD_FORMATS,
  PENDING_FORMAT: PENDING_FORMAT,
  CUSTOM_FORMAT: CUSTOM_FORMAT,
  finalizeSlot: finalizeSlot,
  deleteSlot: deleteSlot,
  publicSlot: publicSlot,
  getAvailableSlots: getAvailableSlots,
};
