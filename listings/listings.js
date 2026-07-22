(function () {
  "use strict";

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

  function renderBreadcrumbs(site, listing) {
    var nav = document.getElementById("breadcrumbs");
    nav.innerHTML = "";
    nav.appendChild(el("a", null, "Home")).setAttribute("href", "/");
    nav.appendChild(document.createTextNode(" → "));
    nav.appendChild(el("a", null, "Marketplace")).setAttribute("href", "/sites");
    if (site) {
      nav.appendChild(document.createTextNode(" → "));
      var siteCrumb = el("a", null, site.domain);
      siteCrumb.href = "/sites/" + encodeURIComponent(site.slug);
      nav.appendChild(siteCrumb);
    }
    nav.appendChild(document.createTextNode(" → "));
    nav.appendChild(el("span", null, listing.title));
  }

  // pageUrl is only ever missing for a slot created before Phase 1 added
  // that field — the button just stays hidden for those rather than
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

  // previewPosX/Y/Width/Height (resolved server-side at screenshot-capture
  // time — see lib/slot-preview.js's resolveFinalRect()) describe where
  // the ad actually sits within THIS screenshot; posX/Y/Width/Height are
  // the Picker's own capture-time coordinates, which can drift from that.
  // Preferred whenever present; falls back to posX/Y/Width/Height for a
  // preview captured before this field existed.
  function overlayRect(slot) {
    if (slot.previewPosX !== null && slot.previewPosX !== undefined) {
      return { x: slot.previewPosX, y: slot.previewPosY, width: slot.previewPosWidth, height: slot.previewPosHeight };
    }
    return { x: slot.posX, y: slot.posY, width: slot.posWidth, height: slot.posHeight };
  }

  // Large hero preview — the page's main image. Shown at its real (full-
  // page) aspect ratio with no cropping, so the highlight overlay only ever
  // needs a single width-based scale factor, no vertical shift/crop math
  // (contrast with sites.js's fixed-aspect-ratio card cover). Falls back to
  // the existing gradient placeholder (untouched, no markup added) whenever
  // no ready preview exists.
  function renderListingHero(slot) {
    var cover = document.getElementById("listingCover");
    var hasPreview =
      slot &&
      slot.previewStatus === "ready" &&
      slot.previewImageUrl &&
      slot.posX !== null &&
      slot.posX !== undefined &&
      slot.pickerViewportWidth;
    if (!hasPreview) {
      return;
    }

    var rect = overlayRect(slot);
    var img = document.createElement("img");
    img.className = "listing-cover__img";
    img.alt = "";
    var overlay = el("div", "listing-cover__highlight");
    overlay.hidden = true;

    img.addEventListener("load", function () {
      var scale = cover.clientWidth / img.naturalWidth;
      overlay.style.left = rect.x * scale + "px";
      overlay.style.top = rect.y * scale + "px";
      overlay.style.width = rect.width * scale + "px";
      overlay.style.height = rect.height * scale + "px";
      overlay.hidden = false;
    });
    img.src = slot.previewImageUrl;

    cover.appendChild(img);
    cover.appendChild(overlay);
  }

  function render(data) {
    var listing = data.listing;
    var site = data.site;
    var slot = data.slot;

    renderListingHero(slot);

    document.getElementById("listingTitle").textContent = listing.title;
    document.title = listing.title + (site ? " — " + site.domain : "") + " | Vybridge";

    document.getElementById("listingType").textContent = LISTING_TYPE_LABELS[listing.listingType] || listing.listingType;

    var descEl = document.getElementById("listingDescription");
    if (listing.description) {
      descEl.textContent = listing.description;
      descEl.hidden = false;
    }

    var specs = document.getElementById("listingSpecs");
    specs.innerHTML = "";
    function addSpec(label, value) {
      if (!value) {
        return;
      }
      specs.appendChild(el("dt", null, label));
      specs.appendChild(el("dd", null, value));
    }
    if (slot) {
      addSpec("Viewport", slot.viewportType === "mobile" ? "Mobile" : "Desktop");
      addSpec("Size", slot.width + " × " + slot.height + " px");
      addSpec("Format", slot.format);
      addSpec("Duration", slot.durationDays + " days");
    }

    var siteLink = document.getElementById("siteLink");
    if (site) {
      siteLink.href = "/sites/" + encodeURIComponent(site.slug);
      siteLink.textContent = "View " + site.domain + " →";
    } else {
      siteLink.hidden = true;
    }

    document.getElementById("listingPrice").textContent = money(listing.priceCents, listing.currency);

    var bookBtn = document.getElementById("bookBtn");
    bookBtn.href = "/slots?slot=" + encodeURIComponent(listing.sourceId);

    var viewPlacementBtn = document.getElementById("viewPlacementBtn");
    var previewUrl = slot ? buildPlacementPreviewUrl(slot.pageUrl, listing.sourceId) : null;
    if (previewUrl) {
      viewPlacementBtn.href = previewUrl;
      viewPlacementBtn.hidden = false;
    }

    renderBreadcrumbs(site, listing);

    document.getElementById("listingLoading").hidden = true;
    document.getElementById("listingBody").hidden = false;
  }

  function showNotFound() {
    document.getElementById("listingLoading").hidden = true;
    document.getElementById("listingNotFound").hidden = false;
  }

  var slug = getSlugFromPath();
  if (!slug) {
    showNotFound();
    return;
  }

  fetch("/api/listings/" + encodeURIComponent(slug) + "/public")
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
      render(result.body);
    })
    .catch(function () {
      showNotFound();
    });
})();
