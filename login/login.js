(function () {
  "use strict";

  var form = document.getElementById("loginForm");
  var message = document.getElementById("loginMessage");

  VybridgeAuth.redirectIfAuthenticated();

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    message.hidden = true;

    VybridgeAuth.postJson("/api/auth/login", {
      email: form.email.value.trim(),
      password: form.password.value,
    }).then(function (result) {
      if (!result.ok) {
        var errors = result.body.errors || [result.body.error || "Prihlásenie zlyhalo"];
        VybridgeAuth.showErrors(message, errors);
        return;
      }
      window.location.href = "/dashboard";
    }).catch(function () {
      VybridgeAuth.showErrors(message, ["Prihlásenie zlyhalo. Skúste to znova."]);
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
