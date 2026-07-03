(function () {
  "use strict";

  var MAX_FILE_SIZE = 500 * 1024; // 500KB — creatives are stored as data URLs
  // for now (no file storage service wired up yet), so this cap keeps
  // deal rows from bloating; a real upload pipeline is future work.

  var grid = document.getElementById("slotsGrid");
  var loadingEl = document.getElementById("catalogLoading");
  var emptyEl = document.getElementById("slotsEmpty");
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
  var currentCreativeDataUrl = null;
  var currentCreativeMeta = null;

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
        renderCatalog(result.slots);
      })
      .catch(function () {
        loadingEl.textContent = "Could not load slots. Please refresh.";
      });
  }

  function renderCatalog(slots) {
    grid.innerHTML = "";
    if (!slots.length) {
      emptyEl.hidden = false;
      return;
    }

    grid.hidden = false;
    slots.forEach(function (slot) {
      var card = el("article", "slot-card");
      card.appendChild(el("div", "slot-card__domain", slot.site_domain));
      card.appendChild(el("div", "slot-card__meta", slot.format + " · " + slot.duration_days + " days"));
      card.appendChild(el("div", "slot-card__price", money(slot.price_cents)));

      var bookBtn = el("button", "btn btn--purple", "Book this slot");
      bookBtn.type = "button";
      bookBtn.addEventListener("click", function () {
        openModal(slot);
      });
      card.appendChild(bookBtn);

      grid.appendChild(card);
    });
  }

  // ---------- Booking modal ----------

  function openModal(slot) {
    currentSlot = slot;
    currentCreativeDataUrl = null;
    currentCreativeMeta = null;
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

  // ---------- Creative upload (client-side, read as a data URL) ----------

  fileInput.addEventListener("change", function () {
    clearFieldError("creativeFile");
    currentCreativeDataUrl = null;
    currentCreativeMeta = null;

    var file = fileInput.files[0];
    if (!file) {
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setFieldError("creativeFile", "Image must be under 500KB");
      fileInput.value = "";
      return;
    }

    var reader = new FileReader();
    reader.onload = function () {
      var dataUrl = reader.result;
      var img = new Image();
      img.onload = function () {
        currentCreativeDataUrl = dataUrl;
        currentCreativeMeta = {
          width: img.naturalWidth,
          height: img.naturalHeight,
          mimeType: file.type,
          fileSizeBytes: file.size,
        };
      };
      img.onerror = function () {
        setFieldError("creativeFile", "Could not read this image");
      };
      img.src = dataUrl;
    };
    reader.onerror = function () {
      setFieldError("creativeFile", "Could not read this file");
    };
    reader.readAsDataURL(file);
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

    if (!currentCreativeDataUrl || !currentCreativeMeta) {
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

    fetch("/api/deals", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slotId: currentSlot.slot_id,
        creative: {
          fileUrl: currentCreativeDataUrl,
          clickUrl: clickUrl,
          width: currentCreativeMeta.width,
          height: currentCreativeMeta.height,
          mimeType: currentCreativeMeta.mimeType,
          fileSizeBytes: currentCreativeMeta.fileSizeBytes,
        },
      }),
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
