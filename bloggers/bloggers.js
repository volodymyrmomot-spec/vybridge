(function () {
  "use strict";

  var MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB — matches lib/multipart.js's server-side limit
  var ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

  var grid = document.getElementById("bloggersGrid");
  var loadingEl = document.getElementById("catalogLoading");
  var emptyEl = document.getElementById("bloggersEmpty");
  var filteredEmptyEl = document.getElementById("bloggersFilteredEmpty");
  var filtersEl = document.getElementById("catalogFilters");
  var platformFilter = document.getElementById("filterPlatform");
  var categoryFilter = document.getElementById("filterCategory");
  var followersFilter = document.getElementById("filterFollowers");
  var allBloggers = [];

  var backdrop = document.getElementById("offerBackdrop");
  var closeBtn = document.getElementById("offerModalCloseBtn");
  var form = document.getElementById("offerForm");
  var bloggerInfoEl = document.getElementById("offerBloggerInfo");
  var channelSelect = document.getElementById("offerChannel");
  var channelFieldWrap = document.getElementById("offerChannelFieldWrap");
  var summaryEl = document.getElementById("offerSummary");
  var fileInput = document.getElementById("offerCreativeFile");
  var fileFieldWrap = document.getElementById("offerFileFieldWrap");
  var briefInput = document.getElementById("offerBriefText");
  var briefFieldWrap = document.getElementById("offerBriefFieldWrap");
  var priceInput = document.getElementById("offerPrice");
  var clickUrlInput = document.getElementById("offerClickUrl");
  var payBtn = document.getElementById("offerPayBtn");
  var cardElementWrap = document.getElementById("offerCardElement");

  var stripe = null;
  var cardElement = null;
  var currentBlogger = null;
  var currentCreativeFile = null;
  var currentContentType = "ready_file";

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

  var PLATFORM_ICONS = { instagram: "📷", tiktok: "🎵", youtube: "▶️" };
  var PLATFORM_LABELS = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" };

  var FOLLOWER_BUCKETS = [
    { value: "under_1k", min: 0, max: 999 },
    { value: "1k_10k", min: 1000, max: 9999 },
    { value: "10k_50k", min: 10000, max: 49999 },
    { value: "50k_200k", min: 50000, max: 199999 },
    { value: "200k_plus", min: 200000, max: Infinity },
  ];

  function followerBucket(count) {
    var match = FOLLOWER_BUCKETS.find(function (bucket) {
      return count >= bucket.min && count <= bucket.max;
    });
    return match ? match.value : null;
  }

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
        cardElement.mount("#offerCardElement");
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
    fetch("/api/bloggers/available", { credentials: "same-origin" })
      .then(function (res) {
        return res.json();
      })
      .then(function (result) {
        loadingEl.hidden = true;
        if (!result.ok) {
          loadingEl.hidden = false;
          loadingEl.textContent = "Could not load bloggers. Please refresh.";
          return;
        }
        allBloggers = result.bloggers;
        setupFilters();
        applyFiltersAndRender();
      })
      .catch(function () {
        loadingEl.textContent = "Could not load bloggers. Please refresh.";
      });
  }

  function setupFilters() {
    filtersEl.hidden = !allBloggers.length;
  }

  [platformFilter, categoryFilter, followersFilter].forEach(function (select) {
    select.addEventListener("change", applyFiltersAndRender);
  });

  function applyFiltersAndRender() {
    var platform = platformFilter.value;
    var category = categoryFilter.value;
    var followers = followersFilter.value;

    var filtered = allBloggers.filter(function (blogger) {
      if (platform && blogger.platforms.indexOf(platform) === -1) {
        return false;
      }
      if (category && blogger.categories.indexOf(category) === -1) {
        return false;
      }
      if (followers && followerBucket(blogger.total_followers) !== followers) {
        return false;
      }
      return true;
    });

    renderCatalog(filtered);
  }

  function buildBloggerCard(blogger) {
    var card = el("article", "blogger-card");

    var header = el("div", "blogger-card__header");
    var avatar = el("div", "blogger-card__avatar", blogger.name.charAt(0).toUpperCase());
    header.appendChild(avatar);
    var nameWrap = el("div", "blogger-card__name-wrap");
    nameWrap.appendChild(el("div", "blogger-card__name", blogger.name));
    var platformsWrap = el("div", "blogger-card__platforms");
    blogger.platforms.forEach(function (platform) {
      platformsWrap.appendChild(el("span", "blogger-card__platform-icon", PLATFORM_ICONS[platform] || platform));
    });
    nameWrap.appendChild(platformsWrap);
    header.appendChild(nameWrap);
    card.appendChild(header);

    if (blogger.categories.length) {
      var categoriesWrap = el("div", "blogger-card__categories");
      blogger.categories.forEach(function (category) {
        categoriesWrap.appendChild(
          el("span", "blogger-card__category-tag", (CATEGORY_ICONS[category] || "") + " " + (CATEGORY_LABELS[category] || category))
        );
      });
      card.appendChild(categoriesWrap);
    }

    card.appendChild(el("div", "blogger-card__meta", blogger.total_followers.toLocaleString() + " total followers"));
    card.appendChild(el("div", "slot-card__price", "From " + money(blogger.min_price_cents)));

    var offerBtn = el("button", "btn btn--purple", "Make an offer");
    offerBtn.type = "button";
    offerBtn.addEventListener("click", function () {
      openModal(blogger);
    });
    card.appendChild(offerBtn);

    return card;
  }

  function renderCatalog(bloggers) {
    grid.innerHTML = "";

    if (!allBloggers.length) {
      grid.hidden = true;
      emptyEl.hidden = false;
      filteredEmptyEl.hidden = true;
      return;
    }
    emptyEl.hidden = true;

    if (!bloggers.length) {
      grid.hidden = true;
      filteredEmptyEl.hidden = false;
      return;
    }
    filteredEmptyEl.hidden = true;

    grid.hidden = false;
    bloggers.forEach(function (blogger) {
      grid.appendChild(buildBloggerCard(blogger));
    });
  }

  // ---------- Offer modal ----------

  function selectedChannel() {
    var channelId = channelSelect.value;
    return currentBlogger.channels.find(function (c) {
      return c.channel_id === channelId;
    });
  }

  function setContentType(type) {
    currentContentType = type;
    document.querySelectorAll(".content-type-toggle__btn").forEach(function (btn) {
      btn.classList.toggle("content-type-toggle__btn--active", btn.dataset.contentType === type);
    });
    fileFieldWrap.hidden = type !== "ready_file";
    briefFieldWrap.hidden = type !== "brief";
  }

  document.querySelectorAll(".content-type-toggle__btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      setContentType(btn.dataset.contentType);
    });
  });

  function updateSummary() {
    var channel = selectedChannel();
    if (!channel) {
      summaryEl.innerHTML = "";
      return;
    }
    var priceEuros = Number(priceInput.value);
    var priceCents = Number.isFinite(priceEuros) ? Math.round(priceEuros * 100) : 0;
    var feeCents = Math.round((priceCents * channel.platform_fee_bps) / 10000);

    summaryEl.innerHTML = "";
    summaryEl.appendChild(el("dt", null, "Offer price"));
    summaryEl.appendChild(el("dd", null, money(priceCents)));
    summaryEl.appendChild(el("dt", null, "Platform fee (" + channel.platform_fee_bps / 100 + "%)"));
    summaryEl.appendChild(el("dd", null, money(feeCents)));
    summaryEl.appendChild(el("dt", null, "Total"));
    summaryEl.appendChild(el("dd", "booking-summary__total", money(priceCents + feeCents)));
  }

  priceInput.addEventListener("input", updateSummary);
  channelSelect.addEventListener("change", function () {
    var channel = selectedChannel();
    if (channel) {
      priceInput.value = (channel.price_per_post_cents / 100).toFixed(2);
    }
    updateSummary();
  });

  function openModal(blogger) {
    currentBlogger = blogger;
    currentCreativeFile = null;
    form.reset();
    clearFormErrors();
    setContentType("ready_file");

    bloggerInfoEl.textContent = blogger.name + " — " + blogger.channels.length + " channel" + (blogger.channels.length === 1 ? "" : "s");

    channelSelect.innerHTML = "";
    blogger.channels.forEach(function (channel) {
      var option = document.createElement("option");
      option.value = channel.channel_id;
      option.textContent =
        (PLATFORM_ICONS[channel.platform] || "") + " " + (PLATFORM_LABELS[channel.platform] || channel.platform) +
        (channel.channel_handle ? " (" + channel.channel_handle + ")" : "") +
        " — " + money(channel.price_per_post_cents);
      channelSelect.appendChild(option);
    });
    // Only worth showing as a choice when there's actually more than one —
    // with a single channel the offer obviously targets that one.
    channelFieldWrap.hidden = blogger.channels.length <= 1;

    priceInput.value = (blogger.channels[0].price_per_post_cents / 100).toFixed(2);
    updateSummary();

    backdrop.hidden = false;
  }

  function closeModal() {
    backdrop.hidden = true;
    currentBlogger = null;
  }

  closeBtn.addEventListener("click", closeModal);
  backdrop.addEventListener("click", function (event) {
    if (event.target === backdrop) {
      closeModal();
    }
  });

  // ---------- Creative upload ----------

  fileInput.addEventListener("change", function () {
    clearFieldError("offerCreativeFile");
    currentCreativeFile = null;

    var file = fileInput.files[0];
    if (!file) {
      return;
    }

    if (ALLOWED_MIME_TYPES.indexOf(file.type) === -1) {
      setFieldError("offerCreativeFile", "Image must be JPG, PNG, GIF, or WebP");
      fileInput.value = "";
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setFieldError("offerCreativeFile", "Image must be under 2MB");
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
    var msg = document.getElementById("offerFormMessage");
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
    var msg = document.getElementById("offerFormMessage");
    msg.textContent = message;
    msg.hidden = false;
  }

  // ---------- Submit: create the offer, then confirm payment ----------

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearFormErrors();

    var clickUrl = clickUrlInput.value.trim();
    var priceEuros = priceInput.value;
    var valid = true;

    if (currentContentType === "ready_file" && !currentCreativeFile) {
      setFieldError("offerCreativeFile", "Upload a creative image");
      valid = false;
    }
    if (currentContentType === "brief" && !briefInput.value.trim()) {
      setFieldError("offerBriefText", "Enter a brief for the blogger");
      valid = false;
    }
    if (!Number.isFinite(Number(priceEuros)) || Number(priceEuros) <= 0) {
      setFieldError("offerPrice", "Enter a price greater than 0");
      valid = false;
    }
    if (!clickUrl || !/^https?:\/\//i.test(clickUrl)) {
      setFieldError("offerClickUrl", "Enter a URL starting with http:// or https://");
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
    formData.append("channelId", channelSelect.value || currentBlogger.channels[0].channel_id);
    formData.append("contentType", currentContentType);
    formData.append("clickUrl", clickUrl);
    formData.append("priceEuros", priceEuros);
    if (currentContentType === "brief") {
      formData.append("briefText", briefInput.value.trim());
    } else {
      formData.append("creative", currentCreativeFile);
    }

    fetch("/api/blogger-offers", {
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
          setFormMessage(result.body.error || "Could not send this offer. Please try again.");
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
          var cardErrorEl = document.getElementById("offerCardError");
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
