(function () {
  "use strict";

  var CATEGORY_LABELS = {
    technology: "Technology",
    lifestyle: "Lifestyle",
    automotive: "Automotive",
    fashion: "Fashion",
    food: "Food",
    travel: "Travel",
    sports: "Sports",
    business: "Business",
    entertainment: "Entertainment",
    education: "Education",
    health: "Health",
    news: "News",
    other: "Other",
  };

  var MONTHLY_VISITORS_LABELS = {
    under_1k: "Under 1,000",
    "1k_10k": "1,000 – 10,000",
    "10k_50k": "10,000 – 50,000",
    "50k_200k": "50,000 – 200,000",
    "200k_plus": "200,000+",
  };

  var AUDIENCE_LANGUAGE_LABELS = {
    english: "English",
    slovak: "Slovak",
    ukrainian: "Ukrainian",
    russian: "Russian",
    other: "Other",
  };

  var LISTING_TYPE_LABELS = {
    website_banner: "Website banner",
    website_popup: "Website popup",
    instagram_post: "Instagram post",
    tiktok_video: "TikTok video",
    youtube_integration: "YouTube integration",
    podcast_ad: "Podcast ad",
    newsletter_ad: "Newsletter ad",
  };

  function money(cents, currency) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency || "eur").toUpperCase(),
    }).format(cents / 100);
  }

  function getSlugFromPath() {
    var parts = window.location.pathname.split("/").filter(Boolean);
    return parts[1] || "";
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined && text !== null) {
      node.textContent = text;
    }
    return node;
  }

  function renderBreadcrumbs(site) {
    var nav = document.getElementById("breadcrumbs");
    nav.innerHTML = "";
    nav.appendChild(el("a", null, "Home")).setAttribute("href", "/");
    nav.appendChild(document.createTextNode(" → "));
    nav.appendChild(el("span", null, "Sites"));
    nav.appendChild(document.createTextNode(" → "));
    nav.appendChild(el("span", null, site.domain));
  }

  function renderSite(site) {
    document.getElementById("siteDomain").textContent = site.domain;
    document.title = site.domain + " on Vybridge";

    var cover = document.getElementById("siteCover");
    cover.textContent = site.domain.charAt(0).toUpperCase();

    var meta = document.getElementById("siteMeta");
    meta.innerHTML = "";
    function addRow(label, value) {
      if (!value) {
        return;
      }
      meta.appendChild(el("dt", null, label));
      meta.appendChild(el("dd", null, value));
    }
    addRow("Category", site.category ? CATEGORY_LABELS[site.category] : null);
    addRow("Monthly visitors", site.monthlyVisitors ? MONTHLY_VISITORS_LABELS[site.monthlyVisitors] : null);
    addRow("Audience country", site.audienceCountry);
    addRow("Audience language", site.audienceLanguage ? AUDIENCE_LANGUAGE_LABELS[site.audienceLanguage] : null);

    var descEl = document.getElementById("siteDescription");
    if (site.siteDescription) {
      descEl.textContent = site.siteDescription;
      descEl.hidden = false;
    }

    var grid = document.getElementById("listingsGrid");
    var empty = document.getElementById("listingsEmpty");
    grid.innerHTML = "";
    if (!site.listings.length) {
      empty.hidden = false;
    } else {
      site.listings.forEach(function (listing) {
        var card = el("a", "listing-card");
        card.href = "/listings/" + encodeURIComponent(listing.slug);
        card.appendChild(el("div", "listing-card__cover"));
        card.appendChild(el("div", "listing-card__title", listing.title));
        card.appendChild(el("div", "listing-card__type", LISTING_TYPE_LABELS[listing.listingType] || listing.listingType));
        card.appendChild(el("div", "listing-card__price", money(listing.priceCents, listing.currency)));
        grid.appendChild(card);
      });
    }

    renderBreadcrumbs(site);

    document.getElementById("siteLoading").hidden = true;
    document.getElementById("siteBody").hidden = false;
  }

  function showNotFound() {
    document.getElementById("siteLoading").hidden = true;
    document.getElementById("siteNotFound").hidden = false;
  }

  var slug = getSlugFromPath();
  if (!slug) {
    showNotFound();
    return;
  }

  fetch("/api/sites/" + encodeURIComponent(slug) + "/public")
    .then(function (res) {
      return res.json().then(function (data) {
        return { ok: res.ok, body: data };
      });
    })
    .then(function (result) {
      if (!result.ok || !result.body.ok) {
        showNotFound();
        return;
      }
      renderSite(result.body.site);
    })
    .catch(function () {
      showNotFound();
    });
})();
