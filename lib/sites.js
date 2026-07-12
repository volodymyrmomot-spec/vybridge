const prisma = require("./prisma");

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

function publicSiteInfo(site) {
  return {
    domain: site.domain,
    siteKey: site.siteKey,
    category: site.category,
    monthlyVisitors: monthlyVisitorsFromPrisma(site.monthlyVisitors),
    audienceCountry: site.audienceCountry,
    audienceLanguage: site.audienceLanguage,
    siteDescription: site.siteDescription,
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
    coverImageUrl: site.coverImageUrl,
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

module.exports = {
  SITE_CATEGORIES: SITE_CATEGORIES,
  MONTHLY_VISITORS_OPTIONS: MONTHLY_VISITORS_OPTIONS,
  AUDIENCE_LANGUAGES: AUDIENCE_LANGUAGES,
  publicSiteInfo: publicSiteInfo,
  getPublicSite: getPublicSite,
  updateSiteInfo: updateSiteInfo,
  monthlyVisitorsFromPrisma: monthlyVisitorsFromPrisma,
};
