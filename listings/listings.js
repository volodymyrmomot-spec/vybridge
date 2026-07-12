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

  function render(data) {
    var listing = data.listing;
    var site = data.site;
    var slot = data.slot;

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
