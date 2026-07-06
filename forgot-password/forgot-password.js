(function () {
  "use strict";

  var form = document.getElementById("forgotPasswordForm");
  var message = document.getElementById("forgotPasswordMessage");
  var emailInput = document.getElementById("email");
  var emailError = document.getElementById("emailError");

  if (!form) {
    return;
  }

  function clearErrors() {
    emailInput.classList.remove("form-field__input--error");
    emailError.hidden = true;
    emailError.textContent = "";
    message.hidden = true;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearErrors();

    var email = emailInput.value.trim();
    if (!email) {
      emailInput.classList.add("form-field__input--error");
      emailError.textContent = "Email is required";
      emailError.hidden = false;
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailInput.classList.add("form-field__input--error");
      emailError.textContent = "Email is invalid";
      emailError.hidden = false;
      return;
    }

    var submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    VybridgeAuth.postJson("/api/auth/forgot-password", { email: email })
      .then(function () {
        // Same message whether or not the email is registered — the
        // server never reveals which, so neither does this page.
        message.className = "form-message form-message--success";
        message.textContent = "If this email exists, you'll receive a reset link.";
        message.hidden = false;
        submitBtn.disabled = false;
      })
      .catch(function () {
        message.className = "form-message form-message--error";
        message.textContent = "Something went wrong. Please try again.";
        message.hidden = false;
        submitBtn.disabled = false;
      });
  });
})();
