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

  // Screenshot + CSS highlight overlay for a listing card's cover, or the
  // plain gradient placeholder (untouched, no markup added) whenever no
  // ready preview exists yet. The card is a fixed 16:9 window, so the
  // (potentially much taller, full-page) screenshot is shown at its real
  // aspect ratio and shifted vertically to keep the ad area centered in
  // that window — computed once the image actually loads, since only then
  // is its true natural height known.
  function renderListingCover(listing) {
    var cover = el("div", "listing-card__cover");
    var hasPreview =
      listing.previewStatus === "ready" &&
      listing.previewImageUrl &&
      listing.posX !== null &&
      listing.posX !== undefined &&
      listing.pickerViewportWidth;
    if (!hasPreview) {
      return cover;
    }

    var img = document.createElement("img");
    img.className = "listing-card__cover-img";
    img.alt = "";
    var overlay = el("div", "listing-card__cover-highlight");
    overlay.hidden = true;

    img.addEventListener("load", function () {
      var cardWidth = cover.clientWidth;
      var cardHeight = cover.clientHeight;
      var scale = cardWidth / img.naturalWidth;
      var centerY = (listing.posY + listing.posHeight / 2) * scale;
      var maxShift = Math.max(0, img.naturalHeight * scale - cardHeight);
      var shift = Math.min(Math.max(centerY - cardHeight / 2, 0), maxShift);

      img.style.top = -shift + "px";
      overlay.style.left = listing.posX * scale + "px";
      overlay.style.top = listing.posY * scale - shift + "px";
      overlay.style.width = listing.posWidth * scale + "px";
      overlay.style.height = listing.posHeight * scale + "px";
      overlay.hidden = false;
    });
    img.src = listing.previewImageUrl;

    cover.appendChild(img);
    cover.appendChild(overlay);
    return cover;
  }

  // pageUrl is only ever missing for a slot created before Phase 1 added
  // that field — the button just doesn't render for those rather than
  // linking somewhere broken.
  function buildPlacementPreviewUrl(pageUrl, slotId) {
    if (!pageUrl || !slotId) {
      return null;
    }
    try {
      var url = new URL(pageUrl);
      url.searchParams.set("slotPreview", slotId);
      return url.toString();
    } catch (err) {
      return null;
    }
  }

  function renderBreadcrumbs(site) {
    var nav = document.getElementById("breadcrumbs");
    nav.innerHTML = "";
    nav.appendChild(el("a", null, "Home")).setAttribute("href", "/");
    nav.appendChild(document.createTextNode(" → "));
    nav.appendChild(el("a", null, "Marketplace")).setAttribute("href", "/sites");
    nav.appendChild(document.createTextNode(" → "));
    nav.appendChild(el("span", null, site.domain));
  }

  function renderSite(site) {
    document.getElementById("siteDomain").textContent = site.domain;
    document.title = site.domain + " on Vybridge";

    var cover = document.getElementById("siteCover");
    cover.innerHTML = "";
    if (site.coverImageUrl) {
      var coverImg = document.createElement("img");
      coverImg.className = "site-cover__image";
      coverImg.src = site.coverImageUrl;
      coverImg.alt = "";
      cover.appendChild(coverImg);
    } else {
      cover.textContent = site.domain.charAt(0).toUpperCase();
    }

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
        // A wrapper, not the card <a> itself, carries the box styling now —
        // the "View placement" link below has to be a sibling of the card
        // link, never nested inside it (two interactive <a>s inside one
        // another is invalid HTML and makes clicks ambiguous).
        var wrap = el("div", "listing-card-wrap");

        var card = el("a", "listing-card");
        card.href = "/listings/" + encodeURIComponent(listing.slug);
        card.appendChild(renderListingCover(listing));
        card.appendChild(el("div", "listing-card__title", listing.title));
        card.appendChild(el("div", "listing-card__type", LISTING_TYPE_LABELS[listing.listingType] || listing.listingType));
        card.appendChild(el("div", "listing-card__price", money(listing.priceCents, listing.currency)));
        wrap.appendChild(card);

        var previewUrl = buildPlacementPreviewUrl(listing.pageUrl, listing.sourceId);
        if (previewUrl) {
          var viewBtn = el("a", "listing-card__view-btn", "🌐 View placement on website");
          viewBtn.href = previewUrl;
          viewBtn.target = "_blank";
          viewBtn.rel = "noopener";
          wrap.appendChild(viewBtn);
        }

        grid.appendChild(wrap);
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
