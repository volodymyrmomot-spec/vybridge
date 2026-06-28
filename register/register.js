(function () {
  "use strict";

  var form = document.getElementById("registerForm");
  var message = document.getElementById("registerMessage");
  var nameInput = document.getElementById("name");
  var emailInput = document.getElementById("email");
  var passwordInput = document.getElementById("password");

  if (!form || !nameInput || !emailInput || !passwordInput) {
    return;
  }

  VybridgeAuth.redirectIfAuthenticated();

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    message.hidden = true;

    var roleInput = form.querySelector('input[name="role"]:checked');
    var payload = {
      name: nameInput.value.trim(),
      email: emailInput.value.trim(),
      password: passwordInput.value,
      role: roleInput ? roleInput.value : "",
    };

    VybridgeAuth.postJson("/api/auth/register", payload).then(function (result) {
      if (!result.ok) {
        var errors = result.body.errors || [result.body.error || VybridgeI18n.t("registerFailed")];
        VybridgeAuth.showErrors(message, errors);
        return;
      }
      window.location.href = VybridgeI18n.authPath("/dashboard");
    }).catch(function () {
      VybridgeAuth.showErrors(message, [VybridgeI18n.t("registerRetry")]);
    });
  });

  var menuToggle = document.getElementById("menuToggle");
  var nav = document.getElementById("nav");
  if (menuToggle && nav) {
    menuToggle.addEventListener("click", function () {
      var open = nav.classList.toggle("nav--open");
      menuToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }
})();
