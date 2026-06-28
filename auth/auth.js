(function () {
  "use strict";

  function postJson(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json().then(function (data) {
        return { ok: res.ok, status: res.status, body: data };
      });
    });
  }

  function showErrors(el, messages) {
    el.hidden = false;
    el.className = "form-message form-message--error";
    el.textContent = messages.join(" ");
  }

  window.VybridgeAuth = {
    postJson: postJson,
    showErrors: showErrors,
    redirectIfAuthenticated: function () {
      return fetch("/api/auth/me", { credentials: "same-origin" })
        .then(function (res) {
          if (res.ok) {
            window.location.href = "/dashboard";
          }
        })
        .catch(function () {});
    },
    requireAuth: function () {
      return fetch("/api/auth/me", { credentials: "same-origin" })
        .then(function (res) {
          if (!res.ok) {
            window.location.href = "/login";
            return null;
          }
          return res.json();
        })
        .then(function (data) {
          return data && data.ok ? data.user : null;
        });
    },
  };
})();
