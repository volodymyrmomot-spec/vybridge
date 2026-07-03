const crypto = require("crypto");
const prisma = require("./prisma");

const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

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
  createPickerToken: createPickerToken,
  submitSelector: submitSelector,
};
