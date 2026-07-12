const prisma = require("./prisma");
const { generateUniqueSlug } = require("./slug");

// The kind of thing a Slot-sourced Listing gets tagged as. Slot itself
// doesn't distinguish banner vs. popup placements today — `format` is an
// IAB size string or "custom" — so this only has one real branch for now.
// Kept as its own function (not inlined into createListingForSlot) so a
// future slot-level "display style" field only needs a change here.
function mapSlotToListingType(slot) {
  if (slot.format === "popup") {
    return "website_popup";
  }
  // future formats: sticky, native, sponsored_card
  return "website_banner";
}

// sourceType/sourceId — canonical reference, no FK by design (polymorphic:
// future sourceType values won't all point at the same table, so a typed
// FK column per source doesn't scale here the way Deal.slotId/
// Deal.bloggerChannelId does). Referential integrity for sourceId is
// therefore enforced here in application code, not by the database: the
// Slot is re-fetched immediately before writing the Listing, and
// @@unique([sourceType, sourceId]) on Listing (DB-level) stops a second one
// ever being created for the same source.
async function createListingForSlot(slotId) {
  const slot = await prisma.slot.findUnique({ where: { id: slotId } });
  if (!slot) {
    return null;
  }

  const existing = await prisma.listing.findUnique({
    where: { sourceType_sourceId: { sourceType: "slot", sourceId: slot.id } },
  });
  if (existing) {
    return existing;
  }

  const slug = await generateUniqueSlug(slot.label, async function (candidate) {
    const taken = await prisma.listing.findUnique({ where: { slug: candidate } });
    return !!taken;
  });

  return prisma.listing.create({
    data: {
      slug: slug,
      listingType: mapSlotToListingType(slot),
      sourceType: "slot",
      sourceId: slot.id,
      title: slot.label,
      priceCents: slot.priceCents,
      currency: slot.currency,
      // Created active directly — no draft/publish step in Stage 1 (see
      // lib/slots.js's finalizeSlot, the only live caller).
      status: "active",
    },
  });
}

function publicListing(listing) {
  return {
    slug: listing.slug,
    title: listing.title,
    listingType: listing.listingType,
    description: listing.description,
    coverImageUrl: listing.coverImageUrl,
    priceCents: listing.priceCents,
    currency: listing.currency,
    // Opaque UUID, not itself sensitive (no different from what
    // /api/slots/available already hands an authenticated advertiser as
    // slot_id) — exposed so the public page's "Book this slot" button can
    // link straight to /slots?slot={sourceId} without a second lookup.
    sourceId: listing.sourceId,
  };
}

// Public, unauthenticated lookup for GET /listings/:slug and
// GET /api/listings/:slug/public. A draft/paused/archived listing 404s the
// same as a nonexistent one — Stage 1 has no draft state in practice (see
// createListingForSlot), but the check stays in case a future pause/archive
// feature (mentioned in the plan, not built here) sets one of those.
async function getPublicListing(slug) {
  const listing = await prisma.listing.findUnique({ where: { slug: slug } });
  if (!listing || listing.status !== "active") {
    return null;
  }

  if (listing.sourceType !== "slot") {
    // No non-slot source exists yet — nothing to resolve site info from.
    return { listing: publicListing(listing), site: null, slot: null };
  }

  const slot = await prisma.slot.findUnique({ where: { id: listing.sourceId }, include: { site: true } });
  if (!slot) {
    return null;
  }

  return {
    listing: publicListing(listing),
    site: { domain: slot.site.domain, slug: slot.site.slug, category: slot.site.category },
    slot: {
      width: slot.width,
      height: slot.height,
      durationDays: slot.durationDays,
      format: slot.format,
      viewportType: slot.viewportType,
    },
  };
}

// Every place a Slot is hard-deleted must also remove its Listing —
// sourceId is a plain string with no FK (see createListingForSlot's comment
// above), so the database will never cascade this on its own. Returns the
// Prisma delete-many call itself (not awaited) so an array-form
// $transaction([...]) can include it directly alongside sibling deletes;
// sequential callers can just `await` the same call. `client` lets callers
// already inside an interactive $transaction(async (tx) => ...) pass `tx`
// so this runs in the same atomic unit instead of a separate one.
function deleteListingsForSlotIds(slotIds, client) {
  const db = client || prisma;
  return db.listing.deleteMany({ where: { sourceType: "slot", sourceId: { in: slotIds } } });
}

module.exports = {
  mapSlotToListingType: mapSlotToListingType,
  createListingForSlot: createListingForSlot,
  getPublicListing: getPublicListing,
  deleteListingsForSlotIds: deleteListingsForSlotIds,
};
