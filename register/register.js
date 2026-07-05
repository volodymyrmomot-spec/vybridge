(function () {
  "use strict";

  function populateCountrySelect(select) {
    if (window.VybridgeCountries) {
      window.VybridgeCountries.populateSelect(select);
    }
  }

  var roleAdvertiserBtn = document.getElementById("roleAdvertiser");
  var rolePublisherBtn = document.getElementById("rolePublisher");
  var roleBloggerBtn = document.getElementById("roleBlogger");
  var advertiserForm = document.getElementById("advertiserForm");
  var publisherForm = document.getElementById("publisherForm");
  var bloggerForm = document.getElementById("bloggerForm");

  if (!roleAdvertiserBtn || !rolePublisherBtn || !advertiserForm || !publisherForm) {
    return;
  }

  populateCountrySelect(document.getElementById("advCountry"));
  populateCountrySelect(document.getElementById("pubCountry"));
  populateCountrySelect(document.getElementById("blgCountry"));

  if (window.VybridgeAuth) {
    VybridgeAuth.redirectIfAuthenticated();
  }

  var ROLE_BUTTONS = { advertiser: roleAdvertiserBtn, publisher: rolePublisherBtn, blogger: roleBloggerBtn };
  var ROLE_FORMS = { advertiser: advertiserForm, publisher: publisherForm, blogger: bloggerForm };

  function selectRole(role) {
    Object.keys(ROLE_BUTTONS).forEach(function (key) {
      var active = key === role;
      ROLE_BUTTONS[key].classList.toggle("role-card--active", active);
      ROLE_BUTTONS[key].setAttribute("aria-expanded", String(active));
      ROLE_FORMS[key].hidden = !active;
    });

    var firstInput = ROLE_FORMS[role].querySelector(".form-field__input");
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
  if (roleBloggerBtn) {
    roleBloggerBtn.addEventListener("click", function () {
      selectRole("blogger");
    });
  }

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

  function wireForm(form, role, fieldNames, extraPayload, applyErrors, extraValidation) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      clearFormErrors(form);

      if (!validateClientSide(form, fieldNames)) {
        return;
      }
      if (extraValidation && !extraValidation(form)) {
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
            (applyErrors || applyServerErrors)(form, result.body.errors);
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

  // ---------- Blogger: "My channels" (3 fixed rows, sent in this exact
  // order so a server-side "channel1Url"-style error key can be mapped
  // straight back to the right platform's field) ----------

  var CHANNEL_PLATFORMS = ["instagram", "tiktok", "youtube"];

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function gatherChannels() {
    return CHANNEL_PLATFORMS.map(function (platform) {
      var p = capitalize(platform);
      return {
        platform: platform,
        channelUrl: document.getElementById("channel" + p + "Url").value.trim(),
        followersCount: document.getElementById("channel" + p + "Followers").value,
        contentCategory: document.getElementById("channel" + p + "Category").value,
        pricePerPostEuros: document.getElementById("channel" + p + "Price").value,
      };
    });
  }

  function validateChannelsClientSide() {
    var channelsErrorEl = document.getElementById("channelsError");
    var anyFilled = CHANNEL_PLATFORMS.some(function (platform) {
      return document.getElementById("channel" + capitalize(platform) + "Url").value.trim();
    });
    if (!anyFilled) {
      channelsErrorEl.textContent = "Add at least one channel (Instagram, TikTok, or YouTube)";
      channelsErrorEl.hidden = false;
      return false;
    }
    return true;
  }

  function applyBloggerServerErrors(form, errors) {
    if (!errors || typeof errors !== "object") {
      setFormMessage(form, "Registration failed. Please try again.");
      return;
    }

    Object.keys(errors).forEach(function (key) {
      if (key === "channels") {
        var channelsErrorEl = document.getElementById("channelsError");
        channelsErrorEl.textContent = errors[key];
        channelsErrorEl.hidden = false;
        return;
      }

      var match = /^channel(\d+)(.*)$/.exec(key);
      if (!match) {
        setFieldError(form, key, errors[key]);
        return;
      }

      var platform = CHANNEL_PLATFORMS[Number(match[1])];
      if (!platform) {
        return;
      }
      // suffix is "", "Url", "Followers", "Category", or "Price" — "" (a bad
      // platform value, which the fixed rows here never actually send)
      // falls back to the row's URL field, same as any other field-less error.
      var suffix = match[2] || "Url";
      var fieldId = "channel" + capitalize(platform) + suffix;
      var input = document.getElementById(fieldId);
      var errorEl = document.getElementById(fieldId + "Error");
      if (input) {
        input.classList.add("form-field__input--error");
      }
      if (errorEl) {
        errorEl.textContent = errors[key];
        errorEl.hidden = false;
      }
    });
  }

  wireForm(advertiserForm, "advertiser", ["name", "email", "password", "country"]);
  wireForm(publisherForm, "publisher", ["name", "email", "password", "websiteUrl", "country"]);
  if (bloggerForm) {
    wireForm(
      bloggerForm,
      "blogger",
      ["name", "email", "password", "country"],
      function () {
        return { channels: gatherChannels() };
      },
      applyBloggerServerErrors,
      validateChannelsClientSide
    );
  }
})();
