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
      welcomeText.textContent =
        "Vitajte vo Vybridge. Tu budete môcť pridať svoje reklamné miesta.";
    } else {
      welcomeText.textContent =
        "Vitajte vo Vybridge. Tu budete môcť nájsť reklamné miesta.";
    }
  });

  logoutBtn.addEventListener("click", function () {
    VybridgeAuth.postJson("/api/auth/logout", {}).then(function () {
      window.location.href = "/login";
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
