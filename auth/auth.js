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
    var translated = window.VybridgeI18n
      ? VybridgeI18n.translateApiMessages(messages)
      : messages;
    el.textContent = translated.join(" ");
  }

  function postAuthPath() {
    return window.VybridgeI18n ? VybridgeI18n.authPath("/dashboard") : "/dashboard";
  }

  function loginPath() {
    return window.VybridgeI18n ? VybridgeI18n.authPath("/login") : "/login";
  }

  window.VybridgeAuth = {
    postJson: postJson,
    showErrors: showErrors,
    redirectIfAuthenticated: function () {
      return fetch("/api/auth/me", { credentials: "same-origin" })
        .then(function (res) {
          if (res.ok) {
            window.location.href = postAuthPath();
          }
        })
        .catch(function () {});
    },
    requireAuth: function () {
      return fetch("/api/auth/me", { credentials: "same-origin" })
        .then(function (res) {
          if (!res.ok) {
            window.location.href = loginPath();
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
