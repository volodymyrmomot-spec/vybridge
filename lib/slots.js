const crypto = require("crypto");
const prisma = require("./prisma");
const { PLATFORM_CURRENCY } = require("./currency");

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

function validateCreateSlot(body) {
  const errors = {};
  const label = body && body.label ? String(body.label).trim() : "";
  const formatValue = body && body.format ? String(body.format).trim() : "";
  const priceEuros = body && body.priceEuros !== undefined ? Number(body.priceEuros) : NaN;
  const durationDays = body && body.durationDays !== undefined ? Number(body.durationDays) : NaN;

  if (!label) {
    errors.label = "Label is required";
  }

  const format = findFormat(formatValue);
  if (!format) {
    errors.format = "Choose a valid ad size";
  }

  if (!Number.isFinite(priceEuros) || priceEuros <= 0) {
    errors.priceEuros = "Enter a price greater than 0";
  }

  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > MAX_DURATION_DAYS) {
    errors.durationDays = "Duration must be a whole number of days, up to " + MAX_DURATION_DAYS;
  }

  return { errors: errors, label: label, format: format, priceEuros: priceEuros, durationDays: durationDays };
}

// Slots publishers create here start as `draft`, not `active` — an
// advertiser could otherwise book a slot for a publisher who has no way to
// ever receive the payout. Only flips to `active` once payouts_enabled is
// true (see lib/connect.js / the account.updated webhook); the dashboard
// tells the publisher why.
//
// domSelector is generated rather than picked, since there's no visual
// placement picker yet — the publisher is expected to add
// `<div id="{domSelector}"></div>` at the desired spot on their page
// themselves for now.
async function createSlot({ publisherId, body }) {
  const publisher = await prisma.user.findUnique({ where: { id: publisherId } });
  if (!publisher || publisher.role !== "publisher") {
    return { status: 403, body: { ok: false, error: "Only publisher accounts can create slots" } };
  }

  const site = await prisma.site.findFirst({ where: { publisherId: publisherId }, orderBy: { createdAt: "asc" } });
  if (!site) {
    return { status: 409, body: { ok: false, error: "No site on file for this account" } };
  }

  const validated = validateCreateSlot(body);
  if (Object.keys(validated.errors).length) {
    return { status: 400, body: { ok: false, errors: validated.errors } };
  }

  const stripeAccount = await prisma.stripeAccount.findUnique({ where: { userId: publisherId } });
  const status = stripeAccount && stripeAccount.payoutsEnabled ? "active" : "draft";

  const slotId = crypto.randomUUID();
  const priceCents = Math.round(validated.priceEuros * 100);

  const slot = await prisma.slot.create({
    data: {
      id: slotId,
      siteId: site.id,
      publisherId: publisherId,
      label: validated.label,
      domSelector: "#vybridge-slot-" + slotId,
      format: validated.format.value,
      width: validated.format.width,
      height: validated.format.height,
      priceCents: priceCents,
      currency: PLATFORM_CURRENCY,
      durationDays: validated.durationDays,
      status: status,
    },
  });

  return { status: 201, body: { ok: true, slot: publicSlot(slot) } };
}

module.exports = {
  AD_FORMATS: AD_FORMATS,
  createSlot: createSlot,
  publicSlot: publicSlot,
};
