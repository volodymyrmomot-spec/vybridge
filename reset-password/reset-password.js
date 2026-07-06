(function () {
  "use strict";

  var form = document.getElementById("resetPasswordForm");
  var message = document.getElementById("resetPasswordMessage");
  var subtitle = document.getElementById("resetPasswordSubtitle");
  var newPasswordInput = document.getElementById("newPassword");
  var newPasswordError = document.getElementById("newPasswordError");
  var confirmPasswordInput = document.getElementById("confirmPassword");
  var confirmPasswordError = document.getElementById("confirmPasswordError");
  var submitBtn = document.getElementById("resetPasswordSubmit");

  if (!form) {
    return;
  }

  var token = new URLSearchParams(window.location.search).get("token");

  function showFormMessage(text) {
    message.className = "form-message form-message--error";
    message.textContent = text;
    message.hidden = false;
  }

  if (!token) {
    subtitle.textContent = "This reset link is missing its token.";
    form.hidden = true;
    showFormMessage('Please request a new link from the "Forgot your password?" page.');
    return;
  }

  function clearErrors() {
    [newPasswordInput, confirmPasswordInput].forEach(function (input) {
      input.classList.remove("form-field__input--error");
    });
    [newPasswordError, confirmPasswordError].forEach(function (el) {
      el.hidden = true;
      el.textContent = "";
    });
    message.hidden = true;
  }

  function setFieldError(input, errorEl, text) {
    input.classList.add("form-field__input--error");
    errorEl.textContent = text;
    errorEl.hidden = false;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearErrors();

    var password = newPasswordInput.value;
    var confirmPassword = confirmPasswordInput.value;
    var valid = true;

    if (!password) {
      setFieldError(newPasswordInput, newPasswordError, "Password is required");
      valid = false;
    } else if (password.length < 8) {
      setFieldError(newPasswordInput, newPasswordError, "Password must be at least 8 characters");
      valid = false;
    }

    if (!confirmPassword) {
      setFieldError(confirmPasswordInput, confirmPasswordError, "Please confirm your password");
      valid = false;
    } else if (password && confirmPassword !== password) {
      setFieldError(confirmPasswordInput, confirmPasswordError, "Passwords don't match");
      valid = false;
    }

    if (!valid) {
      return;
    }

    submitBtn.disabled = true;

    VybridgeAuth.postJson("/api/auth/reset-password", { token: token, password: password })
      .then(function (result) {
        if (!result.ok) {
          submitBtn.disabled = false;
          if (result.body.errors && result.body.errors.password) {
            setFieldError(newPasswordInput, newPasswordError, result.body.errors.password);
            return;
          }
          showFormMessage(result.body.error || "Could not reset your password. Please try again.");
          return;
        }
        window.location.href = "/login?message=password_reset";
      })
      .catch(function () {
        submitBtn.disabled = false;
        showFormMessage("Something went wrong. Please try again.");
      });
  });
})();
