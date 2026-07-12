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

  var AUDIENCE_LANGUAGE_LABELS = {
    english: "English",
    slovak: "Slovak",
    ukrainian: "Ukrainian",
    russian: "Russian",
    other: "Other",
  };

  function money(cents, currency) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency || "eur").toUpperCase(),
    }).format(cents / 100);
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

  function siteCard(site) {
    var card = el("a", "site-card");
    card.href = "/sites/" + encodeURIComponent(site.slug);

    var cover = el("div", "site-card__cover");
    if (site.coverImageUrl) {
      cover.style.backgroundImage = 'url("' + site.coverImageUrl.replace(/["\\]/g, "\\$&") + '")';
    }
    card.appendChild(cover);

    card.appendChild(el("div", "site-card__domain", site.domain));

    var metaBits = [];
    if (site.category) {
      metaBits.push(CATEGORY_LABELS[site.category] || site.category);
    }
    if (site.audienceCountry) {
      metaBits.push(site.audienceCountry);
    }
    if (site.audienceLanguage) {
      metaBits.push(AUDIENCE_LANGUAGE_LABELS[site.audienceLanguage] || site.audienceLanguage);
    }
    if (metaBits.length) {
      card.appendChild(el("div", "site-card__meta", metaBits.join(" · ")));
    }

    if (site.formats && site.formats.length) {
      var badges = el("div", "site-card__formats");
      site.formats.forEach(function (format) {
        badges.appendChild(el("span", "site-card__badge", format));
      });
      card.appendChild(badges);
    }

    var count = site.activeListingCount === 1 ? "1 active placement" : site.activeListingCount + " active placements";
    card.appendChild(el("div", "site-card__count", count));

    card.appendChild(el("div", "site-card__price", "From " + money(site.minPriceCents, site.currency)));

    card.appendChild(el("span", "btn btn--purple btn--sm site-card__cta", "View Site"));

    return card;
  }

  function render(sites) {
    var grid = document.getElementById("sitesGrid");
    var empty = document.getElementById("sitesEmpty");
    document.getElementById("catalogLoading").hidden = true;

    if (!sites.length) {
      empty.hidden = false;
      return;
    }

    grid.innerHTML = "";
    sites.forEach(function (site) {
      grid.appendChild(siteCard(site));
    });
  }

  fetch("/api/sites/public")
    .then(function (res) {
      return res.json().then(function (data) {
        return { ok: res.ok, body: data };
      });
    })
    .then(function (result) {
      if (!result.ok || !result.body.ok) {
        render([]);
        return;
      }
      render(result.body.sites);
    })
    .catch(function () {
      render([]);
    });
})();
