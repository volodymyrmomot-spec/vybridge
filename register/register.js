(function () {
  "use strict";

  function populateCountrySelect(select) {
    if (window.VybridgeCountries) {
      window.VybridgeCountries.populateSelect(select);
    }
  }

  var roleAdvertiserBtn = document.getElementById("roleAdvertiser");
  var rolePublisherBtn = document.getElementById("rolePublisher");
  var advertiserForm = document.getElementById("advertiserForm");
  var publisherForm = document.getElementById("publisherForm");

  if (!roleAdvertiserBtn || !rolePublisherBtn || !advertiserForm || !publisherForm) {
    return;
  }

  populateCountrySelect(document.getElementById("advCountry"));
  populateCountrySelect(document.getElementById("pubCountry"));

  if (window.VybridgeAuth) {
    VybridgeAuth.redirectIfAuthenticated();
  }

  function selectRole(role) {
    var isAdvertiser = role === "advertiser";
    roleAdvertiserBtn.classList.toggle("role-card--active", isAdvertiser);
    rolePublisherBtn.classList.toggle("role-card--active", !isAdvertiser);
    roleAdvertiserBtn.setAttribute("aria-expanded", String(isAdvertiser));
    rolePublisherBtn.setAttribute("aria-expanded", String(!isAdvertiser));
    advertiserForm.hidden = !isAdvertiser;
    publisherForm.hidden = isAdvertiser;

    var formToFocus = isAdvertiser ? advertiserForm : publisherForm;
    var firstInput = formToFocus.querySelector(".form-field__input");
    if (firstInput) {
      firstInput.focus({ preventScroll: true });
    }
  }

  roleAdvertiserBtn.addEventListener("click", function () {
    selectRole("advertiser");
  });
  rolePublisherBtn.addEventListener("click", function () {
    selectRole("publisher");
  });

  function clearFormErrors(form) {
    form.querySelectorAll(".form-field__error").forEach(function (el) {
      el.hidden = true;
      el.textContent = "";
    });
    form.querySelectorAll(".form-field__input").forEach(function (el) {
      el.classList.remove("form-field__input--error");
    });
    var formMessage = form.querySelector(".form-message");
    if (formMessage) {
      formMessage.hidden = true;
      formMessage.textContent = "";
    }
  }

  function setFieldError(form, fieldName, message) {
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

  function setFormMessage(form, message) {
    var formMessage = form.querySelector(".form-message");
    if (formMessage) {
      formMessage.textContent = message;
      formMessage.hidden = false;
    }
  }

  function validateClientSide(form, fieldNames) {
    var valid = true;

    fieldNames.forEach(function (name) {
      var input = form.querySelector('[name="' + name + '"]');
      var value = input.value.trim();
      var label = input.previousElementSibling ? input.previousElementSibling.textContent : name;

      if (!value) {
        setFieldError(form, name, label + " is required");
        valid = false;
        return;
      }

      if (name === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        setFieldError(form, name, "Email is invalid");
        valid = false;
      } else if (name === "password" && value.length < 8) {
        setFieldError(form, name, "Password must be at least 8 characters");
        valid = false;
      } else if (name === "websiteUrl" && !/^https?:\/\//i.test(value)) {
        setFieldError(form, name, "Website URL must start with http:// or https://");
        valid = false;
      }
    });

    return valid;
  }

  function applyServerErrors(form, errors) {
    if (!errors || typeof errors !== "object") {
      setFormMessage(form, "Registration failed. Please try again.");
      return;
    }
    Object.keys(errors).forEach(function (field) {
      setFieldError(form, field, errors[field]);
    });
  }

  function wireForm(form, role, fieldNames, extraPayload) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      clearFormErrors(form);

      if (!validateClientSide(form, fieldNames)) {
        return;
      }

      var payload = { role: role };
      fieldNames.forEach(function (name) {
        payload[name] = form.querySelector('[name="' + name + '"]').value.trim();
      });
      if (extraPayload) {
        Object.assign(payload, extraPayload(form));
      }

      var submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;

      VybridgeAuth.postJson("/api/auth/register", payload)
        .then(function (result) {
          if (!result.ok) {
            applyServerErrors(form, result.body.errors);
            submitBtn.disabled = false;
            return;
          }
          window.location.href = VybridgeI18n.authPath("/dashboard");
        })
        .catch(function () {
          setFormMessage(form, "Registration failed. Please try again.");
          submitBtn.disabled = false;
        });
    });
  }

  wireForm(advertiserForm, "advertiser", ["name", "email", "password", "country"]);
  wireForm(publisherForm, "publisher", ["name", "email", "password", "websiteUrl", "country"]);
})();
