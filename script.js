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

// Shared across /, /terms, and /privacy — all three load this file and
// share the exact same header markup. Swaps Log in/Sign up for the user's
// name plus Dashboard/Log out once a session is confirmed, without a page
// reload (except after logout, where a reload is the simplest way to get
// every other script on the page back to its logged-out state).
(function () {
  var actions = document.querySelector(".header__actions");
  if (!actions) {
    return;
  }

  function truncate(str, max) {
    return str.length > max ? str.slice(0, max - 1) + "…" : str;
  }

  fetch("/api/auth/me", { credentials: "same-origin" })
    .then(function (res) {
      return res.ok ? res.json() : null;
    })
    .then(function (result) {
      if (!result || !result.ok) {
        return;
      }

      var user = result.user;
      var label = truncate(user.name || user.email, 24);

      var nameEl = document.createElement("span");
      nameEl.className = "header__user";
      nameEl.textContent = label;
      nameEl.title = user.name ? user.name + " (" + user.email + ")" : user.email;

      var dashboardLink = document.createElement("a");
      dashboardLink.href = "/dashboard";
      dashboardLink.className = "header__login";
      dashboardLink.textContent = "Dashboard";

      var logoutBtn = document.createElement("button");
      logoutBtn.type = "button";
      logoutBtn.className = "btn btn--purple btn--sm";
      logoutBtn.textContent = "Log out";
      logoutBtn.addEventListener("click", function () {
        logoutBtn.disabled = true;
        fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" })
          .catch(function () {})
          .then(function () {
            window.location.reload();
          });
      });

      actions.innerHTML = "";
      actions.appendChild(nameEl);
      actions.appendChild(dashboardLink);
      actions.appendChild(logoutBtn);
    })
    .catch(function () {});
})();

// Homepage-only — a no-op everywhere else, since /terms and /privacy (the
// other two pages that load this file) don't have #adPlacementsSection.
// Renders the first 6 sites from the same public catalog data as /sites, and
// only reveals the section when there's at least one — an empty/never-shown
// section beats a "coming soon" placeholder with no real data behind it.
(function () {
  var section = document.getElementById("adPlacementsSection");
  var grid = document.getElementById("placementsGrid");
  if (!section || !grid) {
    return;
  }

  function money(cents, currency) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency || "eur").toUpperCase(),
    }).format(cents / 100);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined && text !== null) {
      node.textContent = text;
    }
    return node;
  }

  function placementCard(site) {
    var card = el("a", "placement-card");
    card.href = "/sites/" + encodeURIComponent(site.slug);

    var cover = el("div", "placement-card__cover");
    if (site.coverImageUrl) {
      cover.style.backgroundImage = 'url("' + site.coverImageUrl.replace(/["\\]/g, "\\$&") + '")';
    }
    card.appendChild(cover);

    card.appendChild(el("div", "placement-card__domain", site.domain));
    card.appendChild(el("div", "placement-card__price", "From " + money(site.minPriceCents, site.currency)));
    card.appendChild(el("span", "placement-card__cta", "View Site"));

    return card;
  }

  fetch("/api/sites/public")
    .then(function (res) {
      return res.ok ? res.json() : null;
    })
    .then(function (result) {
      if (!result || !result.ok || !result.sites.length) {
        return;
      }
      result.sites.slice(0, 6).forEach(function (site) {
        grid.appendChild(placementCard(site));
      });
      section.hidden = false;
    })
    .catch(function () {});
})();
