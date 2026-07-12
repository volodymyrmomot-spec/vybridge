const crypto = require("crypto");
const prisma = require("./prisma");
const { PLATFORM_CURRENCY } = require("./currency");
const { PENDING_FORMAT } = require("./slots");

const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Entry point for the /slots/new visual picker: the publisher has just
// typed in a page URL, before anything about the ad (format/price/duration)
// is known. Creates a placeholder draft slot (format "pending", 0x0) purely
// so a picker token can be minted against it, and embeds that token in the
// publisher's own page URL — w.js picks it up and enters picker mode. The
// draft only becomes a real slot once finalizeSlot runs, after the
// publisher has picked a spot and confirmed the details.
async function createPickerSession({ publisherId, pageUrl }) {
  const site = await prisma.site.findFirst({ where: { publisherId: publisherId }, orderBy: { createdAt: "asc" } });
  if (!site) {
    return { status: 409, body: { ok: false, error: "No site on file for this account" } };
  }

  let parsed;
  try {
    parsed = new URL(String(pageUrl || "").trim());
  } catch (err) {
    return { status: 400, body: { ok: false, error: "Enter a valid URL" } };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { status: 400, body: { ok: false, error: "Enter a valid URL" } };
  }

  const pageHost = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  const siteHost = site.domain
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  if (pageHost !== siteHost) {
    return {
      status: 400,
      body: { ok: false, error: "That URL doesn't match your registered site (" + site.domain + ")" },
    };
  }

  // A previous, never-finished picker session leaves a "pending"-format
  // draft slot behind — clean those up before starting a new one so
  // abandoned attempts never pile up. PickerToken rows referencing them
  // must go first (FK is RESTRICT, not CASCADE).
  const staleDrafts = await prisma.slot.findMany({
    where: { publisherId: publisherId, format: PENDING_FORMAT },
    select: { id: true },
  });
  if (staleDrafts.length) {
    const staleIds = staleDrafts.map(function (s) {
      return s.id;
    });
    await prisma.pickerToken.deleteMany({ where: { slotId: { in: staleIds } } });
    await prisma.slot.deleteMany({ where: { id: { in: staleIds } } });
  }

  const slotId = crypto.randomUUID();
  const slot = await prisma.slot.create({
    data: {
      id: slotId,
      siteId: site.id,
      publisherId: publisherId,
      label: "New ad slot",
      // Placeholder — slug is NOT NULL/unique at the DB level now that
      // Listing public pages exist (see lib/slug.js), but a pending draft
      // slot has no real title yet. slotId is already a fresh UUID, so it's
      // trivially unique with no async check needed. Overwritten with a
      // real, human-readable slug in lib/slots.js's finalizeSlot.
      slug: "pending-" + slotId,
      domSelector: "#vybridge-slot-" + slotId,
      format: PENDING_FORMAT,
      width: 0,
      height: 0,
      priceCents: 0,
      currency: PLATFORM_CURRENCY,
      durationDays: 7,
      status: "draft",
    },
  });

  const token = await prisma.pickerToken.create({
    data: {
      slotId: slot.id,
      publisherId: publisherId,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });

  parsed.searchParams.set("vybridge_pick", token.id);
  parsed.searchParams.set("vybridge_slot", slot.id);

  return { status: 201, body: { ok: true, slotId: slot.id, pickerUrl: parsed.toString() } };
}

// Starts a picker session for one slot: mints a single-use token good for
// 10 minutes and returns the URL to open the publisher's own site with.
async function createPickerToken({ publisherId, slotId }) {
  const slot = await prisma.slot.findUnique({ where: { id: slotId }, include: { site: true } });
  if (!slot || slot.publisherId !== publisherId) {
    return { status: 404, body: { ok: false, error: "Slot not found" } };
  }

  const token = await prisma.pickerToken.create({
    data: {
      slotId: slot.id,
      publisherId: publisherId,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });

  const domain = slot.site.domain.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  const url =
    "https://" +
    domain +
    "/?vybridge_pick=" +
    encodeURIComponent(token.id) +
    "&vybridge_slot=" +
    encodeURIComponent(slot.id);

  return { status: 201, body: { ok: true, url: url, expiresAt: token.expiresAt } };
}

// Called cross-origin from the publisher's own site by w.js in picker mode.
// The token is the only credential — validated, consumed exactly once, and
// tied to the specific slot it was minted for.
async function submitSelector({ slotId, token, selector }) {
  if (!token || !selector || typeof selector !== "string" || !selector.trim()) {
    return { status: 400, body: { ok: false, error: "token and selector are required" } };
  }

  const record = await prisma.pickerToken.findUnique({ where: { id: token } });
  if (!record || record.slotId !== slotId) {
    return { status: 404, body: { ok: false, error: "Invalid picker link" } };
  }
  if (record.usedAt) {
    return { status: 410, body: { ok: false, error: "This picker link was already used" } };
  }
  if (record.expiresAt.getTime() < Date.now()) {
    return { status: 410, body: { ok: false, error: "This picker link has expired" } };
  }

  await prisma.$transaction([
    prisma.slot.update({
      where: { id: slotId },
      data: { domSelector: selector.trim().slice(0, 500) },
    }),
    prisma.pickerToken.update({
      where: { id: token },
      data: { usedAt: new Date() },
    }),
  ]);

  return { status: 200, body: { ok: true } };
}

module.exports = {
  createPickerSession: createPickerSession,
  createPickerToken: createPickerToken,
  submitSelector: submitSelector,
};
