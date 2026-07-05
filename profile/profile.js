(function () {
  "use strict";

  function goToLogin() {
    window.location.href = window.VybridgeI18n ? VybridgeI18n.authPath("/login") : "/login";
  }

  var logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" })
        .catch(function () {})
        .then(goToLogin);
    });
  }

  // ---------- Load current user ----------

  var loadingEl = document.getElementById("profileLoading");
  var contentEl = document.getElementById("profileContent");

  function loadProfile() {
    fetch("/api/auth/me", { credentials: "same-origin" })
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
        loadingEl.hidden = true;
        if (!result.ok) {
          loadingEl.hidden = false;
          loadingEl.textContent = "Could not load your profile. Please refresh.";
          return;
        }
        fillForm(result.user);
        contentEl.hidden = false;
      })
      .catch(function () {
        loadingEl.textContent = "Could not load your profile. Please refresh.";
      });
  }

  function fillForm(user) {
    document.getElementById("profileName").value = user.name || "";
    document.getElementById("profileEmail").value = user.email || "";
    var countrySelect = document.getElementById("profileCountry");
    if (window.VybridgeCountries) {
      window.VybridgeCountries.populateSelect(countrySelect);
    }
    countrySelect.value = user.country || "";
  }

  // ---------- Profile / password form ----------

  var profileForm = document.getElementById("profileForm");
  var profileSaveBtn = document.getElementById("profileSaveBtn");

  var PROFILE_FIELDS = ["name", "email", "country", "currentPassword", "newPassword", "newPasswordConfirm"];

  function clearProfileFormErrors() {
    PROFILE_FIELDS.forEach(function (field) {
      var errorEl = document.getElementById("profile" + capitalize(field) + "Error");
      var inputEl = document.getElementById("profile" + capitalize(field));
      if (errorEl) {
        errorEl.hidden = true;
        errorEl.textContent = "";
      }
      if (inputEl) {
        inputEl.classList.remove("form-field__input--error");
      }
    });
    document.getElementById("profileFormMessage").hidden = true;
    document.getElementById("profileFormSuccess").hidden = true;
  }

  function capitalize(field) {
    return field.charAt(0).toUpperCase() + field.slice(1);
  }

  function setProfileFieldErrors(errors) {
    Object.keys(errors).forEach(function (field) {
      var errorEl = document.getElementById("profile" + capitalize(field) + "Error");
      var inputEl = document.getElementById("profile" + capitalize(field));
      if (errorEl) {
        errorEl.textContent = errors[field];
        errorEl.hidden = false;
      }
      if (inputEl) {
        inputEl.classList.add("form-field__input--error");
      }
    });
  }

  profileForm.addEventListener("submit", function (event) {
    event.preventDefault();
    clearProfileFormErrors();

    profileSaveBtn.disabled = true;

    var payload = {
      name: document.getElementById("profileName").value.trim(),
      email: document.getElementById("profileEmail").value.trim(),
      country: document.getElementById("profileCountry").value,
      currentPassword: document.getElementById("profileCurrentPassword").value,
      newPassword: document.getElementById("profileNewPassword").value,
      newPasswordConfirm: document.getElementById("profileNewPasswordConfirm").value,
    };

    fetch("/api/profile", {
      method: "PUT",
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
        profileSaveBtn.disabled = false;
        if (!result.ok) {
          if (result.body.errors) {
            setProfileFieldErrors(result.body.errors);
          } else {
            var msg = document.getElementById("profileFormMessage");
            msg.textContent = result.body.error || "Could not save your changes. Please try again.";
            msg.hidden = false;
          }
          return;
        }

        // Password fields never come back from the server — clear them so
        // a successful save doesn't leave the old password sitting in the
        // form (and doesn't look like a change is still pending).
        document.getElementById("profileCurrentPassword").value = "";
        document.getElementById("profileNewPassword").value = "";
        document.getElementById("profileNewPasswordConfirm").value = "";
        fillForm(result.body.user);

        var success = document.getElementById("profileFormSuccess");
        success.textContent = "Your profile has been updated.";
        success.hidden = false;
      })
      .catch(function () {
        profileSaveBtn.disabled = false;
        var msg = document.getElementById("profileFormMessage");
        msg.textContent = "Network error. Please try again.";
        msg.hidden = false;
      });
  });

  // ---------- Delete account ----------

  var deleteBackdrop = document.getElementById("deleteBackdrop");
  var deleteAccountBtn = document.getElementById("deleteAccountBtn");
  var deleteModalCloseBtn = document.getElementById("deleteModalCloseBtn");
  var deleteForm = document.getElementById("deleteForm");
  var deleteConfirmBtn = document.getElementById("deleteConfirmBtn");
  var deletePasswordInput = document.getElementById("deletePassword");

  function clearDeleteFormErrors() {
    document.getElementById("deletePasswordError").hidden = true;
    document.getElementById("deletePasswordError").textContent = "";
    deletePasswordInput.classList.remove("form-field__input--error");
    document.getElementById("deleteFormMessage").hidden = true;
  }

  function openDeleteModal() {
    deleteForm.reset();
    clearDeleteFormErrors();
    deleteBackdrop.hidden = false;
  }

  function closeDeleteModal() {
    deleteBackdrop.hidden = true;
  }

  deleteAccountBtn.addEventListener("click", openDeleteModal);
  deleteModalCloseBtn.addEventListener("click", closeDeleteModal);
  deleteBackdrop.addEventListener("click", function (event) {
    if (event.target === deleteBackdrop) {
      closeDeleteModal();
    }
  });

  deleteForm.addEventListener("submit", function (event) {
    event.preventDefault();
    clearDeleteFormErrors();

    deleteConfirmBtn.disabled = true;

    fetch("/api/profile", {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: deletePasswordInput.value }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, body: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          deleteConfirmBtn.disabled = false;
          if (result.body.error === "Incorrect password") {
            document.getElementById("deletePasswordError").textContent = result.body.error;
            document.getElementById("deletePasswordError").hidden = false;
            deletePasswordInput.classList.add("form-field__input--error");
          } else {
            var msg = document.getElementById("deleteFormMessage");
            msg.textContent = result.body.error || "Could not delete your account. Please try again.";
            msg.hidden = false;
          }
          return;
        }

        window.location.href = "/?message=account_deleted";
      })
      .catch(function () {
        deleteConfirmBtn.disabled = false;
        var msg = document.getElementById("deleteFormMessage");
        msg.textContent = "Network error. Please try again.";
        msg.hidden = false;
      });
  });

  loadProfile();
})();
