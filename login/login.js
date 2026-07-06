(function () {
  "use strict";

  var form = document.getElementById("loginForm");
  var message = document.getElementById("loginMessage");

  if (!form) {
    return;
  }

  VybridgeAuth.redirectIfAuthenticated();

  (function showBannerFromQuery() {
    var message = new URLSearchParams(window.location.search).get("message");
    if (message !== "password_reset") {
      return;
    }
    var banner = document.getElementById("loginBanner");
    banner.textContent = "Password updated. Please log in.";
    banner.hidden = false;
    // Drop the query param so a refresh doesn't re-show a stale banner.
    window.history.replaceState({}, "", window.location.pathname);
  })();

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    message.hidden = true;

    VybridgeAuth.postJson("/api/auth/login", {
      email: form.email.value.trim(),
      password: form.password.value,
    }).then(function (result) {
      if (!result.ok) {
        var errors = result.body.errors || [result.body.error || VybridgeI18n.t("loginFailed")];
        VybridgeAuth.showErrors(message, errors);
        return;
      }
      window.location.href = VybridgeI18n.authPath("/dashboard");
    }).catch(function () {
      VybridgeAuth.showErrors(message, [VybridgeI18n.t("loginRetry")]);
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
