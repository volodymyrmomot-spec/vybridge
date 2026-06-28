(function () {
  "use strict";

  var form = document.getElementById("registerForm");
  var message = document.getElementById("registerMessage");

  VybridgeAuth.redirectIfAuthenticated();

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    message.hidden = true;

    var roleInput = form.querySelector('input[name="role"]:checked');
    var payload = {
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      password: form.password.value,
      role: roleInput ? roleInput.value : "",
    };

    VybridgeAuth.postJson("/api/auth/register", payload).then(function (result) {
      if (!result.ok) {
        var errors = result.body.errors || [result.body.error || "Registrácia zlyhala"];
        VybridgeAuth.showErrors(message, errors);
        return;
      }
      window.location.href = "/dashboard";
    }).catch(function () {
      VybridgeAuth.showErrors(message, ["Registrácia zlyhala. Skúste to znova."]);
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
