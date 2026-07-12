const fs = require("fs");
const path = require("path");
const { getPublicSite, getPublicSites, getPublicSitemapSlugs } = require("./sites");
const { getPublicListing } = require("./listings");

const SITE_PAGE_ROUTE = /^\/sites\/([^/]+)$/;
const LISTING_PAGE_ROUTE = /^\/listings\/([^/]+)$/;
const PLACEMENT_REDIRECT_ROUTE = /^\/placements\/([^/]+)$/;
const MARKETPLACE_ROUTE = "/sites";
const SITEMAP_ROUTE = "/sitemap.xml";
const MARKETPLACE_TITLE = "Marketplace | Vybridge";
const MARKETPLACE_DESCRIPTION = "Discover advertising opportunities across websites, creators and digital media.";

const ROOT = path.join(__dirname, "..");

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// JSON.stringify alone isn't safe to drop inside a <script> tag as-is — a
// title/description containing the literal text "</script>" would close
// the tag early. Escaping "<" as its JS unicode escape (invisible to the
// JSON parser, invisible to a browser's HTML tokenizer inside a script
// element) is the standard mitigation.
function safeJsonLd(obj) {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

// Same convention as lib/widget-http.js's getBaseUrl — derived from the
// request rather than hardcoded, so canonical/og:url are correct in both
// local dev and production without an env var to keep in sync.
function getBaseUrl(req) {
  const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
  return protocol + "://" + req.headers.host;
}

function ogImageUrl(baseUrl, coverImageUrl) {
  return coverImageUrl || baseUrl + "/assets/listing-placeholder.png";
}

function metaTags(pairs) {
  return pairs
    .map(function (pair) {
      return '<meta ' + pair[0] + '="' + pair[1] + '" content="' + escapeHtml(pair[2]) + '">';
    })
    .join("\n  ");
}

function buildSiteHead(site, baseUrl) {
  const url = baseUrl + "/sites/" + encodeURIComponent(site.slug);
  const title = site.domain + " on Vybridge";
  const description =
    site.siteDescription || "Ad placements on " + site.domain + " — Vybridge advertising marketplace.";
  const image = ogImageUrl(baseUrl, site.coverImageUrl);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site.domain,
    url: url,
  };

  return (
    '<link rel="canonical" href="' + escapeHtml(url) + '">\n  ' +
    metaTags([
      ["property", "og:title", title],
      ["property", "og:description", description],
      ["property", "og:image", image],
      ["property", "og:url", url],
      ["property", "og:type", "website"],
      ["name", "twitter:card", "summary_large_image"],
      ["name", "twitter:title", title],
      ["name", "twitter:description", description],
      ["name", "twitter:image", image],
    ]) +
    '\n  <script type="application/ld+json">' + safeJsonLd(jsonLd) + "</" + "script>"
  );
}

// "Marketplace" is still only websites in Stage 1 (getPublicSites() only
// aggregates sourceType:"slot" Listings) — see the note in lib/sites.js.
// The ItemList here is what lets a crawler enumerate every site on the
// catalog without executing catalog.js's client-side fetch.
function buildCatalogHead(sites, baseUrl) {
  const url = baseUrl + MARKETPLACE_ROUTE;
  const image = baseUrl + "/assets/listing-placeholder.png";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: sites.map(function (site, index) {
      return {
        "@type": "ListItem",
        position: index + 1,
        url: baseUrl + "/sites/" + encodeURIComponent(site.slug),
        name: site.domain,
      };
    }),
  };

  return (
    '<link rel="canonical" href="' + escapeHtml(url) + '">\n  ' +
    metaTags([
      ["property", "og:title", MARKETPLACE_TITLE],
      ["property", "og:description", MARKETPLACE_DESCRIPTION],
      ["property", "og:image", image],
      ["property", "og:url", url],
      ["property", "og:type", "website"],
      ["name", "twitter:card", "summary_large_image"],
      ["name", "twitter:title", MARKETPLACE_TITLE],
      ["name", "twitter:description", MARKETPLACE_DESCRIPTION],
      ["name", "twitter:image", image],
    ]) +
    '\n  <script type="application/ld+json">' + safeJsonLd(jsonLd) + "</" + "script>"
  );
}

function buildListingHead(result, baseUrl) {
  const listing = result.listing;
  const site = result.site;
  const url = baseUrl + "/listings/" + encodeURIComponent(listing.slug);
  const title = listing.title + (site ? " — " + site.domain : "") + " | Vybridge";
  const description =
    listing.description || "Ad placement" + (site ? " on " + site.domain : "") + " — Vybridge advertising marketplace.";
  const image = ogImageUrl(baseUrl, listing.coverImageUrl);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: listing.title,
    description: description,
    image: image,
    offers: {
      "@type": "Offer",
      price: (listing.priceCents / 100).toFixed(2),
      priceCurrency: (listing.currency || "eur").toUpperCase(),
      availability: "https://schema.org/InStock",
      url: url,
    },
  };

  return (
    '<link rel="canonical" href="' + escapeHtml(url) + '">\n  ' +
    metaTags([
      ["property", "og:title", title],
      ["property", "og:description", description],
      ["property", "og:image", image],
      ["property", "og:url", url],
      ["property", "og:type", "product"],
      ["name", "twitter:card", "summary_large_image"],
      ["name", "twitter:title", title],
      ["name", "twitter:description", description],
      ["name", "twitter:image", image],
    ]) +
    '\n  <script type="application/ld+json">' + safeJsonLd(jsonLd) + "</" + "script>"
  );
}

function buildSiteBreadcrumbs(site) {
  return (
    '<a href="/">Home</a> → <a href="' + MARKETPLACE_ROUTE + '">Marketplace</a> → <span>' +
    escapeHtml(site.domain) +
    "</span>"
  );
}

function buildListingBreadcrumbs(result) {
  var parts = ['<a href="/">Home</a>', "→", '<a href="' + MARKETPLACE_ROUTE + '">Marketplace</a>'];
  if (result.site) {
    parts.push("→");
    parts.push(
      '<a href="/sites/' + encodeURIComponent(result.site.slug) + '">' + escapeHtml(result.site.domain) + "</a>"
    );
  }
  parts.push("→");
  parts.push("<span>" + escapeHtml(result.listing.title) + "</span>");
  return parts.join(" ");
}

// Simple string-token substitution — no templating engine, matches this
// project's from-scratch, no-build-step convention. Every value passed in
// must already be HTML-safe (either escaped, or built entirely from
// escaped pieces, as buildSiteHead/buildListingHead/breadcrumbs are).
function serveTemplate(res, templatePath, replacements) {
  fs.readFile(templatePath, "utf8", function (err, html) {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Internal server error");
      return;
    }
    let output = html;
    Object.keys(replacements).forEach(function (token) {
      output = output.split(token).join(replacements[token]);
    });
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(output);
  });
}

// Dynamic HTML-shell routes for the public site/listing pages — these
// aren't real files, so REWRITES in server.js (exact-string only) can't
// serve them; matched here instead, ahead of the static-file fallback.
// A 404 (unknown slug) returns false rather than serving one directly, so
// the request falls through to the existing generic 404 page.
//
// <title>/<meta description>/canonical/OG/Twitter Card/JSON-LD and the
// breadcrumb trail are all rendered into the HTML response here, server-
// side, before it's sent — that's the part crawlers that don't execute JS
// (Facebook/Twitter/LinkedIn's OG scrapers) actually see. The rest of the
// page's visible content is still filled in client-side by sites.js/
// listings.js off the same public JSON API.
async function handlePublicPagesRequest(req, res, url) {
  if (req.method !== "GET") {
    return false;
  }

  const placementMatch = url.pathname.match(PLACEMENT_REDIRECT_ROUTE);
  if (placementMatch) {
    res.writeHead(301, { Location: "/listings/" + placementMatch[1] });
    res.end();
    return true;
  }

  const baseUrl = getBaseUrl(req);

  if (url.pathname === SITEMAP_ROUTE) {
    const slugs = await getPublicSitemapSlugs();
    const urls = [baseUrl + "/", baseUrl + MARKETPLACE_ROUTE]
      .concat(
        slugs.siteSlugs.map(function (slug) {
          return baseUrl + "/sites/" + encodeURIComponent(slug);
        })
      )
      .concat(
        slugs.listingSlugs.map(function (slug) {
          return baseUrl + "/listings/" + encodeURIComponent(slug);
        })
      );
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls
        .map(function (u) {
          return "  <url><loc>" + escapeHtml(u) + "</loc></url>";
        })
        .join("\n") +
      "\n</urlset>\n";
    res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" });
    res.end(xml);
    return true;
  }

  // Exact-match, checked ahead of SITE_PAGE_ROUTE below — that regex
  // requires a slug segment after /sites/, so it never matches this bare
  // path anyway, but the ordering keeps the two routes visually separate.
  if (url.pathname === MARKETPLACE_ROUTE) {
    const sites = await getPublicSites();
    serveTemplate(res, path.join(ROOT, "sites", "catalog.html"), {
      __VYBRIDGE_TITLE__: escapeHtml(MARKETPLACE_TITLE),
      __VYBRIDGE_DESCRIPTION__: escapeHtml(MARKETPLACE_DESCRIPTION),
      __VYBRIDGE_HEAD_EXTRA__: buildCatalogHead(sites, baseUrl),
    });
    return true;
  }

  const siteMatch = url.pathname.match(SITE_PAGE_ROUTE);
  if (siteMatch) {
    const slug = decodeURIComponent(siteMatch[1]);
    const site = await getPublicSite(slug);
    if (!site) {
      return false;
    }
    serveTemplate(res, path.join(ROOT, "sites", "index.html"), {
      __VYBRIDGE_TITLE__: escapeHtml(site.domain + " on Vybridge"),
      __VYBRIDGE_DESCRIPTION__: escapeHtml(
        site.siteDescription || "Ad placements on " + site.domain + " — Vybridge advertising marketplace."
      ),
      __VYBRIDGE_HEAD_EXTRA__: buildSiteHead(site, baseUrl),
      __VYBRIDGE_BREADCRUMBS__: buildSiteBreadcrumbs(site),
    });
    return true;
  }

  const listingMatch = url.pathname.match(LISTING_PAGE_ROUTE);
  if (listingMatch) {
    const slug = decodeURIComponent(listingMatch[1]);
    const result = await getPublicListing(slug);
    if (!result) {
      return false;
    }
    const descSuffix = result.site ? " on " + result.site.domain : "";
    serveTemplate(res, path.join(ROOT, "listings", "index.html"), {
      __VYBRIDGE_TITLE__: escapeHtml(
        result.listing.title + (result.site ? " — " + result.site.domain : "") + " | Vybridge"
      ),
      __VYBRIDGE_DESCRIPTION__: escapeHtml(
        result.listing.description || "Ad placement" + descSuffix + " — Vybridge advertising marketplace."
      ),
      __VYBRIDGE_HEAD_EXTRA__: buildListingHead(result, baseUrl),
      __VYBRIDGE_BREADCRUMBS__: buildListingBreadcrumbs(result),
    });
    return true;
  }

  return false;
}

module.exports = {
  handlePublicPagesRequest: handlePublicPagesRequest,
};
