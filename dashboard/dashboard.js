(function () {
  "use strict";

  var BANNER_MESSAGES = {
    pending_approval: "Your ad is pending approval.",
  };

  (function showBannerFromQuery() {
    var message = new URLSearchParams(window.location.search).get("message");
    var text = message && BANNER_MESSAGES[message];
    if (!text) {
      return;
    }
    var banner = document.getElementById("dashboardBanner");
    banner.textContent = text;
    banner.hidden = false;
    // Drop the query param so a refresh doesn't re-show a stale banner.
    window.history.replaceState({}, "", window.location.pathname);
  })();

  var STATUS_LABELS = {
    created: "Created",
    paid_escrow: "Paid (escrow)",
    pending_approval: "Pending approval",
    approved: "Approved",
    live: "Live",
    completed: "Completed",
    payout_released: "Paid out",
    rejected: "Rejected",
    disputed: "Disputed",
    refunded: "Refunded",
    draft: "Draft — connect payouts to activate",
    active: "Active",
    booked: "Booked",
    paused: "Paused",
  };

  function statusLabel(status) {
    return STATUS_LABELS[status] || status;
  }

  function statusPill(status) {
    var span = document.createElement("span");
    span.className = "status-pill status-pill--" + status;
    span.textContent = statusLabel(status);
    return span;
  }

  function formatDate(iso) {
    var date = new Date(iso);
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

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

  function goToLogin() {
    window.location.href = window.VybridgeI18n ? VybridgeI18n.authPath("/login") : "/login";
  }

  var logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" })
        .catch(function () {})
        .then(goToLogin);
    });
  }

  function renderAdvertiserDashboard(data) {
    document.getElementById("advertiserName").textContent = data.user.name;

    var body = document.getElementById("advertiserDealsBody");
    var table = body.closest(".dashboard-table-wrap");
    var empty = document.getElementById("advertiserDealsEmpty");
    body.innerHTML = "";

    if (!data.deals.length) {
      table.hidden = true;
      empty.hidden = false;
    } else {
      table.hidden = false;
      empty.hidden = true;
      data.deals.forEach(function (deal) {
        var row = document.createElement("tr");
        row.appendChild(el("td", null, deal.site));
        row.appendChild(el("td", null, deal.price));
        var statusCell = document.createElement("td");
        statusCell.appendChild(statusPill(deal.status));
        row.appendChild(statusCell);
        row.appendChild(el("td", null, formatDate(deal.createdAt)));
        body.appendChild(row);
      });
    }

    document.getElementById("advertiserDashboard").hidden = false;
  }

  function renderMySite(site) {
    var dl = document.getElementById("mySiteInfo");
    var snippetWrap = document.getElementById("mySiteSnippet");
    dl.innerHTML = "";
    if (!site) {
      dl.appendChild(el("dd", null, "No site on file yet."));
      snippetWrap.hidden = true;
      return;
    }
    dl.appendChild(el("dt", null, "Domain"));
    dl.appendChild(el("dd", null, site.domain));
    dl.appendChild(el("dt", null, "Site key"));
    dl.appendChild(el("dd", null, site.siteKey));

    document.getElementById("mySiteSnippetCode").textContent =
      '<script src="' + window.location.origin + '/w.js" data-site="' + site.siteKey + '" async></' + "script>";
    snippetWrap.hidden = false;
  }

  function renderPayoutsStatus(payouts) {
    var container = document.getElementById("payoutsStatus");
    container.innerHTML = "";

    if (payouts.payoutsEnabled) {
      var enabledPill = el("span", "status-pill status-pill--live", "✓ Payouts enabled");
      container.appendChild(enabledPill);
      return;
    }

    var pill = el(
      "span",
      "status-pill status-pill--pending_approval",
      payouts.connected ? "Setup in progress" : "Not connected"
    );
    container.appendChild(pill);

    var button = el("button", "btn btn--purple dashboard-payouts__cta", "Connect your bank account");
    button.type = "button";
    button.addEventListener("click", function () {
      button.disabled = true;
      fetch("/api/connect/onboard", { method: "POST", credentials: "same-origin" })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, body: data };
          });
        })
        .then(function (result) {
          if (!result.ok || !result.body.url) {
            button.disabled = false;
            window.alert(result.body.error || "Could not start onboarding. Please try again.");
            return;
          }
          window.location.href = result.body.url;
        })
        .catch(function () {
          button.disabled = false;
          window.alert("Network error. Please try again.");
        });
    });
    container.appendChild(button);
  }

  function renderPendingApprovals(deals, onAction) {
    var list = document.getElementById("pendingApprovalsList");
    var empty = document.getElementById("pendingApprovalsEmpty");
    list.innerHTML = "";

    if (!deals.length) {
      list.hidden = true;
      empty.hidden = false;
      return;
    }

    list.hidden = false;
    empty.hidden = true;

    deals.forEach(function (deal) {
      var item = el("div", "approval-item");
      item.dataset.dealId = deal.id;

      var info = el("div", "approval-item__info");
      info.appendChild(el("span", "approval-item__site", deal.site + " — " + deal.slotLabel));
      info.appendChild(el("span", "approval-item__meta", deal.price));
      item.appendChild(info);

      var actions = el("div", "approval-item__actions");
      var approveBtn = el("button", "btn btn--purple", "Approve");
      approveBtn.type = "button";
      var rejectBtn = el("button", "btn btn--danger", "Reject");
      rejectBtn.type = "button";

      approveBtn.addEventListener("click", function () {
        onAction(deal.id, "approve", item, [approveBtn, rejectBtn]);
      });
      rejectBtn.addEventListener("click", function () {
        onAction(deal.id, "reject", item, [approveBtn, rejectBtn]);
      });

      actions.appendChild(approveBtn);
      actions.appendChild(rejectBtn);
      item.appendChild(actions);

      list.appendChild(item);
    });
  }

  // Opens the publisher's own site in a new tab with the one-time picker
  // token in the URL. w.js (already installed on their site) detects the
  // token and takes over from there — this tab doesn't track completion,
  // it just re-fetches the dashboard when the user comes back to it (see
  // the visibilitychange listener in loadDashboard).
  function startPlacementPicker(slotId, triggerBtn) {
    triggerBtn.disabled = true;
    fetch("/api/slots/" + encodeURIComponent(slotId) + "/picker-token", {
      method: "POST",
      credentials: "same-origin",
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, body: data };
        });
      })
      .then(function (result) {
        triggerBtn.disabled = false;
        if (!result.ok || !result.body.url) {
          window.alert(result.body.error || "Could not start the placement picker. Please try again.");
          return;
        }
        window.open(result.body.url, "_blank", "noopener");
      })
      .catch(function () {
        triggerBtn.disabled = false;
        window.alert("Network error. Please try again.");
      });
  }

  function renderSlots(slots) {
    var body = document.getElementById("publisherSlotsBody");
    var table = body.closest(".dashboard-table-wrap");
    var empty = document.getElementById("publisherSlotsEmpty");
    body.innerHTML = "";

    if (!slots.length) {
      table.hidden = true;
      empty.hidden = false;
      return;
    }

    table.hidden = false;
    empty.hidden = true;

    slots.forEach(function (slot) {
      var row = document.createElement("tr");
      row.appendChild(el("td", null, slot.label));
      row.appendChild(el("td", null, slot.format));
      row.appendChild(el("td", null, slot.price));
      row.appendChild(el("td", null, slot.durationDays + " days"));
      var statusCell = document.createElement("td");
      statusCell.appendChild(statusPill(slot.status));
      row.appendChild(statusCell);
      row.appendChild(el("td", "dashboard-cell--code", slot.domSelector));

      var actionCell = document.createElement("td");
      var pickBtn = el("button", "btn btn--outline btn--sm", "Pick placement");
      pickBtn.type = "button";
      pickBtn.addEventListener("click", function () {
        startPlacementPicker(slot.id, pickBtn);
      });
      actionCell.appendChild(pickBtn);
      row.appendChild(actionCell);

      body.appendChild(row);
    });
  }

  function renderAllDeals(deals) {
    var body = document.getElementById("publisherDealsBody");
    var table = body.closest(".dashboard-table-wrap");
    var empty = document.getElementById("publisherDealsEmpty");
    body.innerHTML = "";

    if (!deals.length) {
      table.hidden = true;
      empty.hidden = false;
      return;
    }

    table.hidden = false;
    empty.hidden = true;

    deals.forEach(function (deal) {
      var row = document.createElement("tr");
      row.appendChild(el("td", null, deal.site + " — " + deal.slotLabel));
      var statusCell = document.createElement("td");
      statusCell.appendChild(statusPill(deal.status));
      row.appendChild(statusCell);
      row.appendChild(el("td", null, deal.price));
      body.appendChild(row);
    });
  }

  function reviewDeal(dealId, action, itemEl, buttons) {
    buttons.forEach(function (btn) {
      btn.disabled = true;
    });

    fetch("/api/deals/" + encodeURIComponent(dealId) + "/" + action, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, body: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          buttons.forEach(function (btn) {
            btn.disabled = false;
          });
          window.alert(result.body.error || "Could not update this deal. Please refresh and try again.");
          return;
        }
        itemEl.remove();
        var list = document.getElementById("pendingApprovalsList");
        if (!list.children.length) {
          list.hidden = true;
          document.getElementById("pendingApprovalsEmpty").hidden = false;
        }
      })
      .catch(function () {
        buttons.forEach(function (btn) {
          btn.disabled = false;
        });
        window.alert("Network error. Please try again.");
      });
  }

  function renderPublisherDashboard(data) {
    document.getElementById("publisherName").textContent = data.user.name;
    renderMySite(data.site);
    renderPayoutsStatus(data.payouts);
    renderSlots(data.slots);
    renderPendingApprovals(data.pendingApprovals, reviewDeal);
    renderAllDeals(data.deals);

    document.getElementById("publisherDashboard").hidden = false;
  }

  function loadDashboard() {
    fetch("/api/dashboard", { credentials: "same-origin" })
      .then(function (res) {
        if (res.status === 401) {
          goToLogin();
          return null;
        }
        return res.json();
      })
      .then(function (result) {
        if (!result) {
          return;
        }
        document.getElementById("dashboardLoading").hidden = true;

        if (!result.ok) {
          window.alert("Could not load your dashboard. Please try again.");
          return;
        }

        var dashboard = result.dashboard;
        if (dashboard.role === "publisher") {
          renderPublisherDashboard(dashboard);
        } else {
          renderAdvertiserDashboard(dashboard);
        }
      })
      .catch(function () {
        document.getElementById("dashboardLoading").textContent =
          "Could not load your dashboard. Please refresh the page.";
      });
  }

  loadDashboard();

  // Picking a placement happens in a separate tab (the publisher's own
  // site) — re-fetch when the user comes back to this one so a freshly
  // saved selector shows up without a manual reload.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      loadDashboard();
    }
  });
})();
