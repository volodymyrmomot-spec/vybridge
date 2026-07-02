(function () {
  "use strict";

  var card = document.getElementById("connectReturnCard");
  var params = new URLSearchParams(window.location.search);

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function render(title, text) {
    card.innerHTML = "";
    card.appendChild(el("h1", "auth-card__title", title));
    card.appendChild(el("p", "auth-card__subtitle", text));
    var link = el("a", "btn btn--purple", "Go to dashboard");
    link.href = "/dashboard";
    card.appendChild(link);
  }

  if (params.get("refresh") === "1") {
    render(
      "This link expired",
      "Setup links only last a few minutes. Go back to your dashboard and click “Connect your bank account” again."
    );
    return;
  }

  fetch("/api/dashboard", { credentials: "same-origin" })
    .then(function (res) {
      if (res.status === 401) {
        window.location.href = "/login";
        return null;
      }
      return res.json();
    })
    .then(function (result) {
      if (!result) {
        return;
      }
      if (result.ok && result.dashboard.role === "publisher" && result.dashboard.payouts.payoutsEnabled) {
        render("You're all set", "Payouts are enabled — you'll be paid automatically when a placement ends.");
      } else {
        render(
          "Almost there",
          "We're confirming your details with Stripe — this can take a minute. Check your dashboard shortly."
        );
      }
    })
    .catch(function () {
      render("Could not check your status", "Please go to your dashboard and check there.");
    });
})();
