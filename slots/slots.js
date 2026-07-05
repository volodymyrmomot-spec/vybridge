(function () {
  "use strict";

  var MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB — matches lib/multipart.js's server-side limit
  var ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

  var grid = document.getElementById("slotsGrid");
  var loadingEl = document.getElementById("catalogLoading");
  var emptyEl = document.getElementById("slotsEmpty");
  var filteredEmptyEl = document.getElementById("slotsFilteredEmpty");
  var filtersEl = document.getElementById("catalogFilters");
  var categoryFilter = document.getElementById("filterCategory");
  var trafficFilter = document.getElementById("filterTraffic");
  var countryFilter = document.getElementById("filterCountry");
  var allSlots = [];
  var backdrop = document.getElementById("bookingBackdrop");
  var closeBtn = document.getElementById("modalCloseBtn");
  var form = document.getElementById("bookingForm");
  var slotInfoEl = document.getElementById("modalSlotInfo");
  var summaryEl = document.getElementById("bookingSummary");
  var fileInput = document.getElementById("creativeFile");
  var clickUrlInput = document.getElementById("creativeClickUrl");
  var payBtn = document.getElementById("payBtn");
  var cardElementWrap = document.getElementById("cardElement");

  var stripe = null;
  var cardElement = null;
  var currentSlot = null;
  var currentCreativeFile = null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function money(cents) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" }).format(cents / 100);
  }

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

  var CATEGORY_ICONS = {
    technology: "💻",
    lifestyle: "🧘",
    automotive: "🚗",
    fashion: "👗",
    food: "🍔",
    travel: "✈️",
    sports: "⚽",
    business: "💼",
    entertainment: "🎬",
    education: "🎓",
    health: "❤️",
    news: "📰",
    other: "📦",
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

  function goToLogin() {
    window.location.href = window.VybridgeI18n ? VybridgeI18n.authPath("/login") : "/login";
  }

  // ---------- Bootstrapping ----------

  function init() {
    fetch("/api/dashboard", { credentials: "same-origin" })
      .then(function (res) {
        if (res.status === 401) {
          goToLogin();
          return null;
        }
        return res.json();
      })
      .then(function (result) {
        if (!result) {
          return;
        }
        if (!result.ok || result.dashboard.role !== "advertiser") {
          window.location.href = "/dashboard";
          return;
        }
        loadCatalog();
      })
      .catch(function () {
        loadingEl.textContent = "Could not check your account. Please refresh.";
      });

    fetch("/api/config")
      .then(function (res) {
        return res.json();
      })
      .then(function (result) {
        if (!result.ok || !result.stripePublishableKey || !window.Stripe) {
          return;
        }
        stripe = window.Stripe(result.stripePublishableKey);
        var elements = stripe.elements();
        cardElement = elements.create("card");
        cardElement.mount("#cardElement");
        cardElement.on("focus", function () {
          cardElementWrap.classList.add("booking-card-element--focus");
        });
        cardElement.on("blur", function () {
          cardElementWrap.classList.remove("booking-card-element--focus");
        });
      })
      .catch(function () {});
  }

  // ---------- Catalog ----------

  function loadCatalog() {
    fetch("/api/slots/available", { credentials: "same-origin" })
      .then(function (res) {
        return res.json();
      })
      .then(function (result) {
        loadingEl.hidden = true;
        if (!result.ok) {
          loadingEl.hidden = false;
          loadingEl.textContent = "Could not load slots. Please refresh.";
          return;
        }
        allSlots = result.slots;
        setupFilters(allSlots);
        applyFiltersAndRender();
      })
      .catch(function () {
        loadingEl.textContent = "Could not load slots. Please refresh.";
      });
  }

  // The country filter's options are built from whatever audience countries
  // actually appear in the catalog right now, rather than a fixed list —
  // there's no enum for this field (see lib/sites.js), so a static dropdown
  // would either miss values or show countries no slot actually has.
  function setupFilters(slots) {
    if (!slots.length) {
      filtersEl.hidden = true;
      return;
    }
    filtersEl.hidden = false;

    var countries = [];
    slots.forEach(function (slot) {
      if (slot.audience_country && countries.indexOf(slot.audience_country) === -1) {
        countries.push(slot.audience_country);
      }
    });
    countries.sort();

    Array.prototype.slice.call(countryFilter.querySelectorAll("option")).forEach(function (opt, index) {
      if (index > 0) {
        opt.remove();
      }
    });
    countries.forEach(function (country) {
      var opt = document.createElement("option");
      opt.value = country;
      opt.textContent = country;
      countryFilter.appendChild(opt);
    });
  }

  [categoryFilter, trafficFilter, countryFilter].forEach(function (select) {
    select.addEventListener("change", applyFiltersAndRender);
  });

  function applyFiltersAndRender() {
    var category = categoryFilter.value;
    var traffic = trafficFilter.value;
    var country = countryFilter.value;

    var filtered = allSlots.filter(function (slot) {
      if (category && slot.category !== category) {
        return false;
      }
      if (traffic && slot.monthly_visitors !== traffic) {
        return false;
      }
      if (country && slot.audience_country !== country) {
        return false;
      }
      return true;
    });

    renderCatalog(filtered);
  }

  function audienceRow(label, value) {
    var row = el("div", "slot-card__audience-row");
    row.appendChild(el("span", "slot-card__audience-label", label));
    var valueEl = el("span", "slot-card__audience-value", value || "No info provided");
    if (!value) {
      valueEl.classList.add("slot-card__audience-value--empty");
    }
    row.appendChild(valueEl);
    return row;
  }

  function buildSlotCard(slot) {
    var card = el("article", "slot-card");
    card.appendChild(el("div", "slot-card__domain", slot.site_domain));
    card.appendChild(el("div", "slot-card__meta", slot.format + " · " + slot.duration_days + " days"));

    var categoryLabel = slot.category ? CATEGORY_ICONS[slot.category] + " " + CATEGORY_LABELS[slot.category] : null;
    var visitorsLabel = slot.monthly_visitors ? MONTHLY_VISITORS_LABELS[slot.monthly_visitors] : null;
    var languageLabel = slot.audience_language ? AUDIENCE_LANGUAGE_LABELS[slot.audience_language] : null;

    var audienceWrap = el("div", "slot-card__audience");
    audienceWrap.appendChild(audienceRow("Category", categoryLabel));
    audienceWrap.appendChild(audienceRow("Monthly visitors", visitorsLabel));
    audienceWrap.appendChild(audienceRow("Audience", slot.audience_country));
    audienceWrap.appendChild(audienceRow("Language", languageLabel));
    card.appendChild(audienceWrap);

    card.appendChild(el("div", "slot-card__price", money(slot.price_cents)));

    var bookBtn = el("button", "btn btn--purple", "Book this slot");
    bookBtn.type = "button";
    bookBtn.addEventListener("click", function () {
      openModal(slot);
    });
    card.appendChild(bookBtn);

    return card;
  }

  function renderCatalog(slots) {
    grid.innerHTML = "";

    if (!allSlots.length) {
      grid.hidden = true;
      emptyEl.hidden = false;
      filteredEmptyEl.hidden = true;
      return;
    }
    emptyEl.hidden = true;

    if (!slots.length) {
      grid.hidden = true;
      filteredEmptyEl.hidden = false;
      return;
    }
    filteredEmptyEl.hidden = true;

    grid.hidden = false;
    slots.forEach(function (slot) {
      grid.appendChild(buildSlotCard(slot));
    });
  }

  // ---------- Booking modal ----------

  function openModal(slot) {
    currentSlot = slot;
    currentCreativeFile = null;
    form.reset();
    clearFormErrors();

    slotInfoEl.textContent = slot.site_domain + " — " + slot.format + " — " + slot.duration_days + " days";
    renderSummary(slot);
    backdrop.hidden = false;
  }

  function closeModal() {
    backdrop.hidden = true;
    currentSlot = null;
  }

  closeBtn.addEventListener("click", closeModal);
  backdrop.addEventListener("click", function (event) {
    if (event.target === backdrop) {
      closeModal();
    }
  });

  function renderSummary(slot) {
    summaryEl.innerHTML = "";
    summaryEl.appendChild(el("dt", null, "Slot price"));
    summaryEl.appendChild(el("dd", null, money(slot.price_cents)));
    summaryEl.appendChild(el("dt", null, "Platform fee (" + slot.platform_fee_bps / 100 + "%)"));
    summaryEl.appendChild(el("dd", null, money(slot.platform_fee_cents)));
    summaryEl.appendChild(el("dt", null, "Total"));
    summaryEl.appendChild(el("dd", "booking-summary__total", money(slot.total_cents)));
  }

  // ---------- Creative upload (file is sent as-is; the server uploads it to
  // Cloudinary and reports back the real width/height) ----------

  fileInput.addEventListener("change", function () {
    clearFieldError("creativeFile");
    currentCreativeFile = null;

    var file = fileInput.files[0];
    if (!file) {
      return;
    }

    if (ALLOWED_MIME_TYPES.indexOf(file.type) === -1) {
      setFieldError("creativeFile", "Image must be JPG, PNG, GIF, or WebP");
      fileInput.value = "";
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setFieldError("creativeFile", "Image must be under 2MB");
      fileInput.value = "";
      return;
    }

    currentCreativeFile = file;
  });

  // ---------- Form errors ----------

  function clearFormErrors() {
    form.querySelectorAll(".form-field__error").forEach(function (node) {
      node.hidden = true;
      node.textContent = "";
    });
    form.querySelectorAll(".form-field__input").forEach(function (node) {
      node.classList.remove("form-field__input--error");
    });
    var msg = document.getElementById("bookingFormMessage");
    msg.hidden = true;
    msg.textContent = "";
  }

  function setFieldError(fieldId, message) {
    var input = document.getElementById(fieldId);
    if (input) {
      input.classList.add("form-field__input--error");
    }
    var errorEl = document.getElementById(fieldId + "Error");
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }
  }

  function clearFieldError(fieldId) {
    var input = document.getElementById(fieldId);
    if (input) {
      input.classList.remove("form-field__input--error");
    }
    var errorEl = document.getElementById(fieldId + "Error");
    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = "";
    }
  }

  function setFormMessage(message) {
    var msg = document.getElementById("bookingFormMessage");
    msg.textContent = message;
    msg.hidden = false;
  }

  // ---------- Submit: create the deal, then confirm payment ----------

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearFormErrors();

    var clickUrl = clickUrlInput.value.trim();
    var valid = true;

    if (!currentCreativeFile) {
      setFieldError("creativeFile", "Upload a creative image");
      valid = false;
    }
    if (!clickUrl || !/^https?:\/\//i.test(clickUrl)) {
      setFieldError("creativeClickUrl", "Enter a URL starting with http:// or https://");
      valid = false;
    }
    if (!stripe || !cardElement) {
      setFormMessage("Payments aren't available right now — please try again shortly.");
      valid = false;
    }
    if (!valid) {
      return;
    }

    payBtn.disabled = true;

    var formData = new FormData();
    formData.append("slotId", currentSlot.slot_id);
    formData.append("clickUrl", clickUrl);
    formData.append("creative", currentCreativeFile);

    // No Content-Type header here — the browser sets
    // multipart/form-data with the correct boundary itself.
    fetch("/api/deals", {
      method: "POST",
      credentials: "same-origin",
      body: formData,
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, body: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          payBtn.disabled = false;
          setFormMessage(result.body.error || "Could not create this booking. Please try again.");
          return null;
        }
        return confirmPayment(result.body.clientSecret);
      })
      .catch(function () {
        payBtn.disabled = false;
        setFormMessage("Network error. Please try again.");
      });
  });

  function confirmPayment(clientSecret) {
    return stripe
      .confirmCardPayment(clientSecret, { payment_method: { card: cardElement } })
      .then(function (result) {
        if (result.error) {
          payBtn.disabled = false;
          var cardErrorEl = document.getElementById("cardError");
          cardErrorEl.textContent = result.error.message;
          cardErrorEl.hidden = false;
          return;
        }
        if (result.paymentIntent && result.paymentIntent.status === "succeeded") {
          window.location.href = "/dashboard?message=pending_approval";
          return;
        }
        payBtn.disabled = false;
        setFormMessage("Payment did not complete. Please try again.");
      });
  }

  init();
})();
