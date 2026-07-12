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

  var allSites = [];

  var filterCategoryEl = document.getElementById("filterCategory");
  var filterCountryEl = document.getElementById("filterCountry");
  var filterLanguageEl = document.getElementById("filterLanguage");
  var filterFormatEl = document.getElementById("filterFormat");
  var filtersBarEl = document.getElementById("marketplaceFilters");
  var filtersClearEl = document.getElementById("filtersClear");
  var noMatchClearEl = document.getElementById("noMatchClear");
  var resultsCountEl = document.getElementById("resultsCount");

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

  // The cover is always the gradient/monogram placeholder today (Site.
  // coverImageUrl is never set — no upload UI exists yet), but it's built
  // as a real <img> so a future coverImageUrl just drops into the same
  // frame — no markup/CSS changes needed when real screenshots arrive.
  function siteCardCover(site) {
    var cover = el("div", "site-card__cover");

    var chrome = el("div", "site-card__cover-chrome");
    chrome.appendChild(el("span", "site-card__dot"));
    chrome.appendChild(el("span", "site-card__dot"));
    chrome.appendChild(el("span", "site-card__dot"));
    chrome.appendChild(el("span", "site-card__cover-url", site.domain));
    cover.appendChild(chrome);

    if (site.coverImageUrl) {
      var img = document.createElement("img");
      img.className = "site-card__cover-image";
      img.src = site.coverImageUrl;
      img.alt = "";
      img.loading = "lazy";
      cover.appendChild(img);
    } else {
      var placeholder = el("div", "site-card__cover-placeholder");
      placeholder.appendChild(el("span", "site-card__monogram", site.domain.charAt(0).toUpperCase()));
      cover.appendChild(placeholder);
    }

    return cover;
  }

  function metaRow(label, value) {
    var row = el("div", "site-card__meta-row");
    row.appendChild(el("dt", null, label));
    row.appendChild(el("dd", null, value));
    return row;
  }

  function siteCard(site) {
    var card = el("a", "site-card");
    card.href = "/sites/" + encodeURIComponent(site.slug);

    card.appendChild(siteCardCover(site));

    var body = el("div", "site-card__body");

    var head = el("div", "site-card__head");
    head.appendChild(el("h3", "site-card__domain", site.domain));
    if (site.category) {
      head.appendChild(el("span", "site-card__category", CATEGORY_LABELS[site.category] || site.category));
    }
    body.appendChild(head);

    var meta = el("dl", "site-card__meta");
    if (site.audienceCountry) {
      meta.appendChild(metaRow("Country", site.audienceCountry));
    }
    if (site.audienceLanguage) {
      meta.appendChild(metaRow("Language", AUDIENCE_LANGUAGE_LABELS[site.audienceLanguage] || site.audienceLanguage));
    }
    if (meta.childNodes.length) {
      body.appendChild(meta);
    }

    if (site.formats && site.formats.length) {
      var badges = el("div", "site-card__formats");
      site.formats.forEach(function (format) {
        badges.appendChild(el("span", "site-card__badge", format));
      });
      body.appendChild(badges);
    }

    if (site.viewports && site.viewports.length) {
      var viewportBadges = el("div", "site-card__formats");
      site.viewports.forEach(function (viewport) {
        viewportBadges.appendChild(
          el("span", "site-card__badge site-card__badge--viewport", viewport === "mobile" ? "Mobile" : "Desktop")
        );
      });
      body.appendChild(viewportBadges);
    }

    var footer = el("div", "site-card__footer");

    var stats = el("div", "site-card__stats");
    var placementsStat = el("div", "site-card__stat");
    placementsStat.appendChild(el("span", "site-card__stat-value", String(site.activeListingCount)));
    placementsStat.appendChild(
      el("span", "site-card__stat-label", site.activeListingCount === 1 ? "active placement" : "active placements")
    );
    stats.appendChild(placementsStat);

    var priceStat = el("div", "site-card__stat");
    priceStat.appendChild(el("span", "site-card__stat-value", money(site.minPriceCents, site.currency)));
    priceStat.appendChild(el("span", "site-card__stat-label", "starting price"));
    stats.appendChild(priceStat);

    footer.appendChild(stats);
    footer.appendChild(el("span", "btn btn--purple site-card__cta", "View Site"));
    body.appendChild(footer);

    card.appendChild(body);
    return card;
  }

  function uniqueSorted(values) {
    var seen = {};
    var out = [];
    values.forEach(function (value) {
      if (value && !seen[value]) {
        seen[value] = true;
        out.push(value);
      }
    });
    out.sort(function (a, b) {
      return a.localeCompare(b);
    });
    return out;
  }

  function populateSelect(selectEl, values, labelFor) {
    values.forEach(function (value) {
      var option = document.createElement("option");
      option.value = value;
      option.textContent = labelFor ? labelFor(value) : value;
      selectEl.appendChild(option);
    });
  }

  function populateFilters(sites) {
    var categories = uniqueSorted(
      sites.map(function (site) {
        return site.category;
      })
    );
    var countries = uniqueSorted(
      sites.map(function (site) {
        return site.audienceCountry;
      })
    );
    var languages = uniqueSorted(
      sites.map(function (site) {
        return site.audienceLanguage;
      })
    );
    var formats = uniqueSorted(
      sites.reduce(function (acc, site) {
        return acc.concat(site.formats || []);
      }, [])
    );

    populateSelect(filterCategoryEl, categories, function (value) {
      return CATEGORY_LABELS[value] || value;
    });
    populateSelect(filterCountryEl, countries);
    populateSelect(filterLanguageEl, languages, function (value) {
      return AUDIENCE_LANGUAGE_LABELS[value] || value;
    });
    populateSelect(filterFormatEl, formats);
  }

  function activeFilters() {
    return {
      category: filterCategoryEl.value,
      country: filterCountryEl.value,
      language: filterLanguageEl.value,
      format: filterFormatEl.value,
    };
  }

  function hasActiveFilters(filters) {
    return !!(filters.category || filters.country || filters.language || filters.format);
  }

  function applyFilters(sites, filters) {
    return sites.filter(function (site) {
      if (filters.category && site.category !== filters.category) {
        return false;
      }
      if (filters.country && site.audienceCountry !== filters.country) {
        return false;
      }
      if (filters.language && site.audienceLanguage !== filters.language) {
        return false;
      }
      if (filters.format && (!site.formats || site.formats.indexOf(filters.format) === -1)) {
        return false;
      }
      return true;
    });
  }

  function renderFiltered() {
    var filters = activeFilters();
    var filtered = applyFilters(allSites, filters);
    var grid = document.getElementById("sitesGrid");
    var noMatch = document.getElementById("sitesNoMatch");

    filtersClearEl.hidden = !hasActiveFilters(filters);

    grid.innerHTML = "";
    if (!filtered.length) {
      noMatch.hidden = false;
      resultsCountEl.hidden = true;
      return;
    }
    noMatch.hidden = true;

    filtered.forEach(function (site) {
      grid.appendChild(siteCard(site));
    });

    resultsCountEl.hidden = false;
    resultsCountEl.textContent =
      filtered.length === allSites.length
        ? allSites.length === 1
          ? "1 site"
          : allSites.length + " sites"
        : "Showing " + filtered.length + " of " + allSites.length + " sites";
  }

  function clearFilters() {
    filterCategoryEl.value = "";
    filterCountryEl.value = "";
    filterLanguageEl.value = "";
    filterFormatEl.value = "";
    renderFiltered();
  }

  function render(sites) {
    allSites = sites;
    document.getElementById("catalogLoading").hidden = true;

    if (!sites.length) {
      document.getElementById("sitesEmpty").hidden = false;
      return;
    }

    populateFilters(sites);
    filtersBarEl.hidden = false;

    [filterCategoryEl, filterLanguageEl, filterCountryEl, filterFormatEl].forEach(function (selectEl) {
      selectEl.addEventListener("change", renderFiltered);
    });
    filtersClearEl.addEventListener("click", clearFilters);
    noMatchClearEl.addEventListener("click", clearFilters);

    renderFiltered();
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
