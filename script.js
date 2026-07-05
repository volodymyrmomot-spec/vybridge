(function () {
  var BANNER_MESSAGES = {
    account_deleted: "Your account has been deleted.",
  };

  var message = new URLSearchParams(window.location.search).get("message");
  var text = message && BANNER_MESSAGES[message];
  if (!text) {
    return;
  }
  var banner = document.getElementById("landingBanner");
  if (!banner) {
    return;
  }
  banner.textContent = text;
  banner.hidden = false;
  window.history.replaceState({}, "", window.location.pathname);
})();

(function () {
  var toggle = document.getElementById("menuToggle");
  var nav = document.getElementById("nav");

  if (!toggle || !nav) return;

  toggle.addEventListener("click", function () {
    var open = nav.classList.toggle("is-open");
    toggle.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  });

  nav.querySelectorAll(".nav__link").forEach(function (link) {
    link.addEventListener("click", function () {
      nav.classList.remove("is-open");
      toggle.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    });
  });
})();
