const prisma = require("./prisma");
const { PLATFORM_CURRENCY } = require("./currency");
const { uploadSiteCover, coverImageVariant, deleteImage } = require("./storage");

// Best-effort cleanup for the Cloudinary asset a cover replace/remove just
// orphaned — never allowed to fail the request that triggered it (the DB
// write it follows has already succeeded either way, so the user-visible
// outcome is correct regardless of whether this cleanup succeeds). A failed
// delete here just means one stray asset sits in Cloudinary until someone
// notices the log line, not a broken cover or a stuck request.
function cleanupOldCoverImage(publicId) {
  if (!publicId) {
    return;
  }
  deleteImage(publicId).catch(function (err) {
    console.error("[sites] Failed to delete old cover image " + publicId + ":", err.message);
  });
}

// Mirrors lib/listings.js's mapSlotToListingType() — those are the only two
// listingType values a sourceType:"slot" Listing can have today. Extend this
// alongside that function if a new slot-sourced format is ever added.
const FORMAT_LABELS = {
  website_banner: "Banner",
  website_popup: "Popup",
};

const SITE_CATEGORIES = [
  "technology",
  "lifestyle",
  "automotive",
  "fashion",
  "food",
  "travel",
  "sports",
  "business",
  "entertainment",
  "education",
  "health",
  "news",
  "other",
];

const MONTHLY_VISITORS_OPTIONS = ["under_1k", "1k_10k", "10k_50k", "50k_200k", "200k_plus"];

const AUDIENCE_LANGUAGES = ["english", "slovak", "ukrainian", "russian", "other"];

const MAX_DESCRIPTION_LENGTH = 300;
const MAX_COUNTRY_LENGTH = 100;

// Prisma enum value names can't start with a digit (see schema.prisma), so
// MonthlyVisitors' Prisma-side names (range_1k_10k, ...) differ from the
// "1k_10k"-style values this API actually reads/writes. This is the only
// place that difference is allowed to exist — everywhere else in the app
// (this module's own public API, lib/slots.js, the frontend) only ever sees
// the plain "1k_10k" form.
const MONTHLY_VISITORS_TO_PRISMA = {
  under_1k: "under_1k",
  "1k_10k": "range_1k_10k",
  "10k_50k": "range_10k_50k",
  "50k_200k": "range_50k_200k",
  "200k_plus": "range_200k_plus",
};

const MONTHLY_VISITORS_FROM_PRISMA = {
  under_1k: "under_1k",
  range_1k_10k: "1k_10k",
  range_10k_50k: "10k_50k",
  range_50k_200k: "50k_200k",
  range_200k_plus: "200k_plus",
};

function monthlyVisitorsFromPrisma(value) {
  return value ? MONTHLY_VISITORS_FROM_PRISMA[value] || null : null;
}

// Dashboard-facing shape — backs both PUT /api/sites/:siteKey's response and
// GET /api/dashboard's site object (lib/dashboard.js). The only place
// coverSource is ever exposed: the publisher needs to see where their
// current cover came from, but the public endpoints below (getPublicSite,
// getPublicSites) deliberately never return it — Marketplace-facing code
// only ever sees coverImageUrl, never why it has that value.
function publicSiteInfo(site) {
  return {
    domain: site.domain,
    siteKey: site.siteKey,
    category: site.category,
    monthlyVisitors: monthlyVisitorsFromPrisma(site.monthlyVisitors),
    audienceCountry: site.audienceCountry,
    audienceLanguage: site.audienceLanguage,
    siteDescription: site.siteDescription,
    coverImageUrl: site.coverImageUrl,
    coverSource: site.coverSource,
  };
}

// Every field is optional — a blank string in the form means "clear this
// field", not "leave it as an empty string", so it's normalized to null
// rather than stored as-is.
function validateSiteInfo(body) {
  const errors = {};
  const data = body && typeof body === "object" ? body : {};

  function optionalEnum(value, allowed, fieldName, errorMessage) {
    const trimmed = value ? String(value).trim() : "";
    if (!trimmed) {
      return null;
    }
    if (!allowed.includes(trimmed)) {
      errors[fieldName] = errorMessage;
      return null;
    }
    return trimmed;
  }

  const category = optionalEnum(data.category, SITE_CATEGORIES, "category", "Choose a valid category");
  const monthlyVisitors = optionalEnum(
    data.monthlyVisitors,
    MONTHLY_VISITORS_OPTIONS,
    "monthlyVisitors",
    "Choose a valid traffic range"
  );
  const audienceLanguage = optionalEnum(
    data.audienceLanguage,
    AUDIENCE_LANGUAGES,
    "audienceLanguage",
    "Choose a valid language"
  );

  const audienceCountry = data.audienceCountry ? String(data.audienceCountry).trim() : "";
  if (audienceCountry.length > MAX_COUNTRY_LENGTH) {
    errors.audienceCountry = "Audience country must be under " + MAX_COUNTRY_LENGTH + " characters";
  }

  const siteDescription = data.siteDescription ? String(data.siteDescription).trim() : "";
  if (siteDescription.length > MAX_DESCRIPTION_LENGTH) {
    errors.siteDescription = "Description must be under " + MAX_DESCRIPTION_LENGTH + " characters";
  }

  return {
    errors: errors,
    category: category,
    monthlyVisitors: monthlyVisitors,
    audienceCountry: audienceCountry || null,
    audienceLanguage: audienceLanguage,
    siteDescription: siteDescription || null,
  };
}

// Public, unauthenticated — for GET /sites/:slug and GET
// /api/sites/:slug/public. Deliberately excludes siteKey/publisherId/id/
// status: none of those are needed by a visitor and siteKey in particular
// is the credential embedded in the publisher's own w.js script tag, not
// something to hand out on a public directory page. `listings` is only
// ever the site's `active` Listings — a draft/paused/archived one (not
// reachable in Stage 1's flow, but the check stays defensive) never shows.
async function getPublicSite(slug) {
  const site = await prisma.site.findUnique({ where: { slug: slug } });
  if (!site || site.status !== "active") {
    return null;
  }

  const slots = await prisma.slot.findMany({ where: { siteId: site.id }, select: { id: true } });
  const slotIds = slots.map(function (slot) {
    return slot.id;
  });

  const listings = slotIds.length
    ? await prisma.listing.findMany({
        where: { sourceType: "slot", sourceId: { in: slotIds }, status: "active" },
        orderBy: { createdAt: "desc" },
      })
    : [];

  return {
    domain: site.domain,
    slug: site.slug,
    category: site.category,
    monthlyVisitors: monthlyVisitorsFromPrisma(site.monthlyVisitors),
    audienceCountry: site.audienceCountry,
    audienceLanguage: site.audienceLanguage,
    siteDescription: site.siteDescription,
    // "medium" — this is the detail page's larger hero image, not a grid
    // thumbnail. coverSource is never included here (see publicSiteInfo).
    coverImageUrl: coverImageVariant(site.coverImageUrl, "medium"),
    listings: listings.map(function (listing) {
      return {
        slug: listing.slug,
        title: listing.title,
        listingType: listing.listingType,
        priceCents: listing.priceCents,
        currency: listing.currency,
      };
    }),
  };
}

// Public, unauthenticated — for GET /sites (the "Marketplace" catalog, still
// slot-sourced only in Stage 1) and the homepage's Featured Placements
// teaser. Two-hop aggregation (Listing.sourceId -> Slot.siteId -> Site)
// because there's no direct Site/Listing relation, same as getPublicSite()'s
// per-site version. Only sites with >=1 active Listing are returned — a
// site with zero is simply absent, never padded with fake data.
async function getPublicSites() {
  const activeListings = await prisma.listing.findMany({
    where: { sourceType: "slot", status: "active" },
    select: { sourceId: true, priceCents: true, currency: true, listingType: true },
  });
  if (!activeListings.length) {
    return [];
  }

  const slotIds = activeListings.map(function (listing) {
    return listing.sourceId;
  });
  const slots = await prisma.slot.findMany({ where: { id: { in: slotIds } }, select: { id: true, siteId: true } });
  const slotIdToSiteId = new Map(
    slots.map(function (slot) {
      return [slot.id, slot.siteId];
    })
  );

  const bySite = new Map();
  activeListings.forEach(function (listing) {
    const siteId = slotIdToSiteId.get(listing.sourceId);
    if (!siteId) {
      return;
    }
    if (!bySite.has(siteId)) {
      bySite.set(siteId, { activeListingCount: 0, minPriceCents: null, formats: new Set() });
    }
    const agg = bySite.get(siteId);
    agg.activeListingCount += 1;
    if (agg.minPriceCents === null || listing.priceCents < agg.minPriceCents) {
      agg.minPriceCents = listing.priceCents;
    }
    agg.formats.add(listing.listingType);
  });

  const sites = await prisma.site.findMany({
    where: { id: { in: Array.from(bySite.keys()) }, status: "active" },
    orderBy: { createdAt: "desc" },
  });

  return sites.map(function (site) {
    const agg = bySite.get(site.id);
    return {
      domain: site.domain,
      slug: site.slug,
      category: site.category,
      audienceCountry: site.audienceCountry,
      audienceLanguage: site.audienceLanguage,
      // "thumbnail" — a catalog card never needs to load the full-size
      // original.
      coverImageUrl: coverImageVariant(site.coverImageUrl, "thumbnail"),
      activeListingCount: agg.activeListingCount,
      minPriceCents: agg.minPriceCents,
      currency: PLATFORM_CURRENCY,
      formats: Array.from(agg.formats).map(function (type) {
        return FORMAT_LABELS[type] || type;
      }),
    };
  });
}

// Slugs only, for GET /sitemap.xml — same active-only aggregation as
// getPublicSites() but without the per-site rollup, since the sitemap just
// needs every reachable public URL, not their display data.
async function getPublicSitemapSlugs() {
  const activeListings = await prisma.listing.findMany({
    where: { sourceType: "slot", status: "active" },
    select: { slug: true, sourceId: true },
  });

  const slotIds = activeListings.map(function (listing) {
    return listing.sourceId;
  });
  const slots = slotIds.length
    ? await prisma.slot.findMany({ where: { id: { in: slotIds } }, select: { id: true, siteId: true } })
    : [];
  const slotIdToSiteId = new Map(
    slots.map(function (slot) {
      return [slot.id, slot.siteId];
    })
  );

  const siteIds = new Set();
  activeListings.forEach(function (listing) {
    const siteId = slotIdToSiteId.get(listing.sourceId);
    if (siteId) {
      siteIds.add(siteId);
    }
  });

  const sites = siteIds.size
    ? await prisma.site.findMany({ where: { id: { in: Array.from(siteIds) }, status: "active" }, select: { slug: true } })
    : [];

  return {
    siteSlugs: sites.map(function (site) {
      return site.slug;
    }),
    listingSlugs: activeListings.map(function (listing) {
      return listing.slug;
    }),
  };
}

async function updateSiteInfo({ publisherId, siteKey, body }) {
  const site = await prisma.site.findUnique({ where: { siteKey: siteKey } });
  if (!site) {
    return { status: 404, body: { ok: false, error: "Site not found" } };
  }
  if (site.publisherId !== publisherId) {
    return { status: 403, body: { ok: false, error: "Not your site" } };
  }

  const validated = validateSiteInfo(body);
  if (Object.keys(validated.errors).length) {
    return { status: 400, body: { ok: false, errors: validated.errors } };
  }

  const updated = await prisma.site.update({
    where: { id: site.id },
    data: {
      category: validated.category,
      monthlyVisitors: validated.monthlyVisitors ? MONTHLY_VISITORS_TO_PRISMA[validated.monthlyVisitors] : null,
      audienceCountry: validated.audienceCountry,
      audienceLanguage: validated.audienceLanguage,
      siteDescription: validated.siteDescription,
    },
  });

  return { status: 200, body: { ok: true, site: publicSiteInfo(updated) } };
}

// Manual cover upload — one of several eventual coverSource values (see
// prisma/schema.prisma's CoverSource enum). A future automatic/AI source
// would follow this exact same shape: upload the image, write
// coverImageUrl + coverSource, and nothing else in the app needs to change.
async function uploadSiteCoverImage({ publisherId, siteKey, file }) {
  const site = await prisma.site.findUnique({ where: { siteKey: siteKey } });
  if (!site) {
    return { status: 404, body: { ok: false, error: "Site not found" } };
  }
  if (site.publisherId !== publisherId) {
    return { status: 403, body: { ok: false, error: "Not your site" } };
  }

  const uploaded = await uploadSiteCover({ buffer: file.buffer, mimeType: file.mimeType });

  const updated = await prisma.site.update({
    where: { id: site.id },
    data: { coverImageUrl: uploaded.secureUrl, coverImagePublicId: uploaded.publicId, coverSource: "manual" },
  });

  // Only after the new cover is live in the DB — if anything above failed,
  // the previous cover (and its Cloudinary asset) is left untouched rather
  // than briefly leaving the site with no cover at all.
  cleanupOldCoverImage(site.coverImagePublicId);

  return { status: 200, body: { ok: true, site: publicSiteInfo(updated) } };
}

async function removeSiteCoverImage({ publisherId, siteKey }) {
  const site = await prisma.site.findUnique({ where: { siteKey: siteKey } });
  if (!site) {
    return { status: 404, body: { ok: false, error: "Site not found" } };
  }
  if (site.publisherId !== publisherId) {
    return { status: 403, body: { ok: false, error: "Not your site" } };
  }

  const updated = await prisma.site.update({
    where: { id: site.id },
    data: { coverImageUrl: null, coverImagePublicId: null, coverSource: "placeholder" },
  });

  cleanupOldCoverImage(site.coverImagePublicId);

  return { status: 200, body: { ok: true, site: publicSiteInfo(updated) } };
}

module.exports = {
  SITE_CATEGORIES: SITE_CATEGORIES,
  MONTHLY_VISITORS_OPTIONS: MONTHLY_VISITORS_OPTIONS,
  AUDIENCE_LANGUAGES: AUDIENCE_LANGUAGES,
  publicSiteInfo: publicSiteInfo,
  getPublicSite: getPublicSite,
  getPublicSites: getPublicSites,
  getPublicSitemapSlugs: getPublicSitemapSlugs,
  updateSiteInfo: updateSiteInfo,
  uploadSiteCoverImage: uploadSiteCoverImage,
  removeSiteCoverImage: removeSiteCoverImage,
  monthlyVisitorsFromPrisma: monthlyVisitorsFromPrisma,
};
