(function () {
  "use strict";

  var form = document.getElementById("newSlotForm");
  if (!form) {
    return;
  }

  // Publisher-only guard. Reuses /api/dashboard (rather than a dedicated
  // check) since it already tells us both "are you logged in" and "are you
  // a publisher" in one call.
  fetch("/api/dashboard", { credentials: "same-origin" })
    .then(function (res) {
      if (res.status === 401) {
        window.location.href = "/login";
        return null;
      }
      return res.json();
    })
    .then(function (result) {
      if (!result) {
        return;
      }
      if (!result.ok || result.dashboard.role !== "publisher") {
        window.location.href = "/dashboard";
      }
    })
    .catch(function () {});

  function formMessageEl() {
    return document.getElementById("newSlotFormMessage");
  }

  function clearFormErrors() {
    form.querySelectorAll(".form-field__error").forEach(function (el) {
      el.hidden = true;
      el.textContent = "";
    });
    form.querySelectorAll(".form-field__input").forEach(function (el) {
      el.classList.remove("form-field__input--error");
    });
    var msg = formMessageEl();
    msg.hidden = true;
    msg.textContent = "";
  }

  function setFieldError(fieldName, message) {
    var input = form.querySelector('[name="' + fieldName + '"]');
    if (!input) {
      return;
    }
    input.classList.add("form-field__input--error");
    var errorEl = document.getElementById(input.id + "Error");
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }
  }

  function setFormMessage(message) {
    var msg = formMessageEl();
    msg.textContent = message;
    msg.hidden = false;
  }

  function validateClientSide() {
    var valid = true;
    var label = form.label.value.trim();
    var format = form.format.value;
    var price = parseFloat(form.priceEuros.value);
    var duration = parseInt(form.durationDays.value, 10);

    if (!label) {
      setFieldError("label", "Label is required");
      valid = false;
    }
    if (!format) {
      setFieldError("format", "Choose an ad size");
      valid = false;
    }
    if (!(price > 0)) {
      setFieldError("priceEuros", "Enter a price greater than 0");
      valid = false;
    }
    if (!(duration >= 1 && duration <= 365)) {
      setFieldError("durationDays", "Duration must be between 1 and 365 days");
      valid = false;
    }

    return valid;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearFormErrors();

    if (!validateClientSide()) {
      return;
    }

    var payload = {
      label: form.label.value.trim(),
      format: form.format.value,
      priceEuros: parseFloat(form.priceEuros.value),
      durationDays: parseInt(form.durationDays.value, 10),
    };

    var submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    fetch("/api/slots", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, body: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          submitBtn.disabled = false;
          if (result.body.errors) {
            Object.keys(result.body.errors).forEach(function (field) {
              setFieldError(field, result.body.errors[field]);
            });
          } else {
            setFormMessage(result.body.error || "Could not create slot. Please try again.");
          }
          return;
        }
        window.location.href = "/dashboard";
      })
      .catch(function () {
        submitBtn.disabled = false;
        setFormMessage("Network error. Please try again.");
      });
  });
})();
