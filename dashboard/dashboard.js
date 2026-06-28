(function () {
  "use strict";

  var welcomeText = document.getElementById("welcomeText");
  var userMeta = document.getElementById("userMeta");
  var logoutBtn = document.getElementById("logoutBtn");

  VybridgeAuth.requireAuth().then(function (user) {
    if (!user) {
      return;
    }

    userMeta.textContent = user.name + " · " + user.email;

    if (user.role === "publisher") {
      welcomeText.textContent = VybridgeI18n.t("publisherWelcome");
    } else {
      welcomeText.textContent = VybridgeI18n.t("advertiserWelcome");
    }
  });

  logoutBtn.addEventListener("click", function () {
    VybridgeAuth.postJson("/api/auth/logout", {}).then(function () {
      window.location.href = VybridgeI18n.authPath("/login");
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
