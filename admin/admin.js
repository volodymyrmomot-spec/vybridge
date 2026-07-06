(function () {
  "use strict";

  var DEAL_STATUSES = [
    "created",
    "paid_escrow",
    "pending_approval",
    "approved",
    "live",
    "completed",
    "payout_released",
    "rejected",
    "disputed",
    "refunded",
    "pending_blogger_approval",
    "blogger_accepted",
    "blogger_published",
    "blogger_declined",
  ];

  var loginGate = document.getElementById("loginGate");
  var adminPanel = document.getElementById("adminPanel");
  var loginForm = document.getElementById("adminLoginForm");
  var loginError = document.getElementById("adminLoginError");
  var passwordInput = document.getElementById("adminPassword");
  var logoutBtn = document.getElementById("adminLogoutBtn");

  var state = {
    users: { search: "", page: 1 },
    deals: { status: "", page: 1 },
    sites: { page: 1 },
  };

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

  function money(cents) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" }).format((cents || 0) / 100);
  }

  function formatDate(iso) {
    if (!iso) {
      return "—";
    }
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function statusPill(status) {
    var span = el("span", "admin-pill admin-pill--" + status, status.replace(/_/g, " "));
    return span;
  }

  function api(path, options) {
    return fetch(path, Object.assign({ credentials: "same-origin" }, options)).then(function (res) {
      return res.json().then(function (data) {
        return { ok: res.ok, status: res.status, body: data };
      });
    });
  }

  function apiJson(path, method, payload) {
    return api(path, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
  }

  // ---------- Auth ----------

  function showGate() {
    adminPanel.hidden = true;
    loginGate.hidden = false;
  }

  function showPanel() {
    loginGate.hidden = true;
    adminPanel.hidden = false;
    loadOverview();
  }

  function checkAuth() {
    api("/api/admin/auth")
      .then(function (result) {
        if (result.ok && result.body.authenticated) {
          showPanel();
        } else {
          showGate();
        }
      })
      .catch(showGate);
  }

  loginForm.addEventListener("submit", function (event) {
    event.preventDefault();
    loginError.hidden = true;

    var submitBtn = loginForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    apiJson("/api/admin/auth", "POST", { password: passwordInput.value })
      .then(function (result) {
        submitBtn.disabled = false;
        if (!result.ok) {
          loginError.textContent = result.body.error || "Incorrect password";
          loginError.hidden = false;
          return;
        }
        passwordInput.value = "";
        showPanel();
      })
      .catch(function () {
        submitBtn.disabled = false;
        loginError.textContent = "Network error. Please try again.";
        loginError.hidden = false;
      });
  });

  logoutBtn.addEventListener("click", function () {
    api("/api/admin/auth", { method: "DELETE" }).then(showGate).catch(showGate);
  });

  // ---------- Nav ----------

  var navButtons = document.querySelectorAll(".admin-nav__item");
  var sections = document.querySelectorAll(".admin-section");
  var LOADERS = { overview: loadOverview, users: loadUsers, deals: loadDeals, sites: loadSites };

  navButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      navButtons.forEach(function (b) {
        b.classList.remove("admin-nav__item--active");
      });
      btn.classList.add("admin-nav__item--active");

      var target = btn.dataset.section;
      sections.forEach(function (section) {
        section.hidden = section.id !== "section-" + target;
      });

      LOADERS[target]();
    });
  });

  // ---------- Overview ----------

  function loadOverview() {
    api("/api/admin/overview").then(function (result) {
      if (!result.ok) {
        return;
      }
      renderOverview(result.body.overview);
    });
  }

  function statCard(label, value, breakdown) {
    var card = el("div", "admin-stat-card");
    card.appendChild(el("div", "admin-stat-card__label", label));
    card.appendChild(el("div", "admin-stat-card__value", value));
    if (breakdown && breakdown.length) {
      var list = el("div", "admin-stat-card__breakdown");
      breakdown.forEach(function (row) {
        var line = el("div", "admin-stat-card__breakdown-row");
        line.appendChild(el("span", null, row[0]));
        line.appendChild(el("span", null, String(row[1])));
        list.appendChild(line);
      });
      card.appendChild(list);
    }
    return card;
  }

  function renderOverview(overview) {
    var grid = document.getElementById("overviewGrid");
    grid.innerHTML = "";

    grid.appendChild(
      statCard("Total users", String(overview.totalUsers), [
        ["Advertisers", overview.usersByRole.advertiser],
        ["Publishers", overview.usersByRole.publisher],
        ["Bloggers", overview.usersByRole.blogger],
      ])
    );

    var dealBreakdown = Object.keys(overview.dealsByStatus).map(function (status) {
      return [status.replace(/_/g, " "), overview.dealsByStatus[status]];
    });
    grid.appendChild(statCard("Total deals", String(overview.totalDeals), dealBreakdown));

    grid.appendChild(statCard("GMV (completed + paid out)", overview.gmv));
    grid.appendChild(statCard("Platform fee earned", overview.platformFee));
    grid.appendChild(statCard("Active deals right now", String(overview.activeDealsCount)));
    grid.appendChild(statCard("New registrations (7d)", String(overview.newRegistrations7d)));
  }

  // ---------- Pagination (shared render helper) ----------

  function renderPagination(containerId, pageInfo, onChange) {
    var container = document.getElementById(containerId);
    container.innerHTML = "";

    if (pageInfo.totalPages <= 1) {
      return;
    }

    var prevBtn = el("button", "admin-btn admin-btn--ghost admin-btn--sm", "Prev");
    prevBtn.type = "button";
    prevBtn.disabled = pageInfo.page <= 1;
    prevBtn.addEventListener("click", function () {
      onChange(pageInfo.page - 1);
    });

    var nextBtn = el("button", "admin-btn admin-btn--ghost admin-btn--sm", "Next");
    nextBtn.type = "button";
    nextBtn.disabled = pageInfo.page >= pageInfo.totalPages;
    nextBtn.addEventListener("click", function () {
      onChange(pageInfo.page + 1);
    });

    container.appendChild(prevBtn);
    container.appendChild(el("span", null, "Page " + pageInfo.page + " of " + pageInfo.totalPages + " (" + pageInfo.total + " total)"));
    container.appendChild(nextBtn);
  }

  // ---------- Users ----------

  var usersSearchInput = document.getElementById("usersSearchInput");
  var usersSearchTimer = null;

  usersSearchInput.addEventListener("input", function () {
    clearTimeout(usersSearchTimer);
    usersSearchTimer = setTimeout(function () {
      state.users.search = usersSearchInput.value.trim();
      state.users.page = 1;
      loadUsers();
    }, 300);
  });

  function loadUsers() {
    var params = new URLSearchParams();
    if (state.users.search) {
      params.set("search", state.users.search);
    }
    params.set("page", String(state.users.page));

    api("/api/admin/users?" + params.toString()).then(function (result) {
      if (!result.ok) {
        return;
      }
      renderUsers(result.body);
    });
  }

  function renderUsers(data) {
    var body = document.getElementById("usersTableBody");
    var table = body.closest(".admin-table-wrap");
    var empty = document.getElementById("usersEmpty");
    body.innerHTML = "";

    if (!data.users.length) {
      table.hidden = true;
      empty.hidden = false;
      renderPagination("usersPagination", data, function () {});
      return;
    }
    table.hidden = false;
    empty.hidden = true;

    data.users.forEach(function (user) {
      var row = document.createElement("tr");
      row.appendChild(el("td", null, user.name));
      row.appendChild(el("td", null, user.email));
      row.appendChild(el("td", null, user.role));
      row.appendChild(el("td", null, user.country));
      row.appendChild(el("td", null, formatDate(user.createdAt)));
      row.appendChild(el("td", null, String(user.dealCount)));

      var actionsCell = document.createElement("td");
      var deleteBtn = el("button", "admin-btn admin-btn--danger admin-btn--sm", "Delete user");
      deleteBtn.type = "button";
      deleteBtn.addEventListener("click", function () {
        confirmAction(
          'Delete "' + user.name + '" (' + user.email + ")? This permanently removes their account, deals, sites, and slots. This cannot be undone.",
          function () {
            return api("/api/admin/users/" + encodeURIComponent(user.id), { method: "DELETE" }).then(function (result) {
              if (!result.ok) {
                window.alert(result.body.error || "Could not delete this user.");
                return;
              }
              loadUsers();
            });
          }
        );
      });
      actionsCell.appendChild(deleteBtn);
      row.appendChild(actionsCell);

      body.appendChild(row);
    });

    renderPagination("usersPagination", data, function (page) {
      state.users.page = page;
      loadUsers();
    });
  }

  // ---------- Deals ----------

  var dealsStatusFilter = document.getElementById("dealsStatusFilter");
  DEAL_STATUSES.forEach(function (status) {
    var option = document.createElement("option");
    option.value = status;
    option.textContent = status.replace(/_/g, " ");
    dealsStatusFilter.appendChild(option);
  });

  dealsStatusFilter.addEventListener("change", function () {
    state.deals.status = dealsStatusFilter.value;
    state.deals.page = 1;
    loadDeals();
  });

  function loadDeals() {
    var params = new URLSearchParams();
    if (state.deals.status) {
      params.set("status", state.deals.status);
    }
    params.set("page", String(state.deals.page));

    api("/api/admin/deals?" + params.toString()).then(function (result) {
      if (!result.ok) {
        return;
      }
      renderDeals(result.body);
    });
  }

  function renderDeals(data) {
    var body = document.getElementById("dealsTableBody");
    var table = body.closest(".admin-table-wrap");
    var empty = document.getElementById("dealsEmpty");
    body.innerHTML = "";

    if (!data.deals.length) {
      table.hidden = true;
      empty.hidden = false;
      renderPagination("dealsPagination", data, function () {});
      return;
    }
    table.hidden = false;
    empty.hidden = true;

    data.deals.forEach(function (deal) {
      var row = document.createElement("tr");
      row.appendChild(el("td", null, deal.shortId));
      row.appendChild(el("td", null, deal.type));
      row.appendChild(el("td", null, deal.subject));
      row.appendChild(el("td", null, deal.parties.advertiser.name));
      row.appendChild(el("td", null, deal.parties.publisher.name));
      row.appendChild(el("td", null, deal.total));

      var statusCell = document.createElement("td");
      statusCell.appendChild(statusPill(deal.status));
      row.appendChild(statusCell);

      row.appendChild(el("td", null, formatDate(deal.createdAt)));

      var actionsCell = document.createElement("td");
      var viewBtn = el("button", "admin-btn admin-btn--ghost admin-btn--sm", "View details");
      viewBtn.type = "button";
      viewBtn.addEventListener("click", function () {
        openDealModal(deal);
      });
      actionsCell.appendChild(viewBtn);
      row.appendChild(actionsCell);

      body.appendChild(row);
    });

    renderPagination("dealsPagination", data, function (page) {
      state.deals.page = page;
      loadDeals();
    });
  }

  var dealModalBackdrop = document.getElementById("dealModalBackdrop");
  var dealModalBody = document.getElementById("dealModalBody");
  var dealModalClose = document.getElementById("dealModalClose");

  function dealDetailRow(dl, label, value) {
    dl.appendChild(el("dt", null, label));
    dl.appendChild(el("dd", null, value === null || value === undefined || value === "" ? "—" : String(value)));
  }

  function openDealModal(deal) {
    dealModalBody.innerHTML = "";
    var dl = document.createElement("dl");

    dealDetailRow(dl, "Full ID", deal.id);
    dealDetailRow(dl, "Type", deal.type);
    dealDetailRow(dl, "Subject", deal.subject);
    dealDetailRow(dl, "Status", deal.status.replace(/_/g, " "));
    dealDetailRow(dl, "Advertiser", deal.parties.advertiser.name + " (" + deal.parties.advertiser.email + ")");
    dealDetailRow(dl, "Publisher/Blogger", deal.parties.publisher.name + " (" + deal.parties.publisher.email + ")");
    dealDetailRow(dl, "Price", money(deal.priceCents));
    dealDetailRow(dl, "Platform fee", money(deal.platformFeeCents));
    dealDetailRow(dl, "Total charged", money(deal.totalChargedCents));
    dealDetailRow(dl, "Created", formatDate(deal.createdAt));
    dealDetailRow(dl, "Starts", formatDate(deal.startsAt));
    dealDetailRow(dl, "Ends", formatDate(deal.endsAt));
    dealDetailRow(dl, "Published URL", deal.publishedUrl);
    dealDetailRow(dl, "PaymentIntent", deal.stripePaymentIntentId);
    dealDetailRow(dl, "Charge", deal.stripeChargeId);
    dealDetailRow(dl, "Transfer", deal.stripeTransferId);
    dealDetailRow(dl, "Refund", deal.stripeRefundId);

    dealModalBody.appendChild(dl);

    if (Array.isArray(deal.statusHistory) && deal.statusHistory.length) {
      var historyTitle = el("h3", null, "Status history");
      historyTitle.style.fontSize = "13px";
      historyTitle.style.margin = "20px 0 8px";
      dealModalBody.appendChild(historyTitle);

      var historyList = el("div", null);
      deal.statusHistory.forEach(function (entry) {
        var line = el("div", null, entry.status + " — " + formatDate(entry.at) + " (" + entry.actor + ")");
        line.style.fontSize = "13px";
        line.style.color = "var(--admin-text-muted)";
        line.style.marginBottom = "4px";
        historyList.appendChild(line);
      });
      dealModalBody.appendChild(historyList);
    }

    dealModalBackdrop.hidden = false;
  }

  function closeDealModal() {
    dealModalBackdrop.hidden = true;
  }

  dealModalClose.addEventListener("click", closeDealModal);
  dealModalBackdrop.addEventListener("click", function (event) {
    if (event.target === dealModalBackdrop) {
      closeDealModal();
    }
  });

  // ---------- Sites & Slots ----------

  function loadSites() {
    var params = new URLSearchParams();
    params.set("page", String(state.sites.page));

    api("/api/admin/sites?" + params.toString()).then(function (result) {
      if (!result.ok) {
        return;
      }
      renderSites(result.body);
    });
  }

  function renderSites(data) {
    var list = document.getElementById("sitesList");
    var empty = document.getElementById("sitesEmpty");
    list.innerHTML = "";

    if (!data.sites.length) {
      list.hidden = true;
      empty.hidden = false;
      renderPagination("sitesPagination", data, function () {});
      return;
    }
    list.hidden = false;
    empty.hidden = true;

    data.sites.forEach(function (site) {
      var card = el("div", "admin-site-card");

      var header = el("div", "admin-site-card__header");
      header.appendChild(el("div", "admin-site-card__domain", site.domain));
      header.appendChild(statusPill(site.status));
      card.appendChild(header);

      card.appendChild(el("div", "admin-site-card__meta", site.publisher.name + " (" + site.publisher.email + ") · " + formatDate(site.createdAt)));

      if (!site.slots.length) {
        card.appendChild(el("p", "admin-empty", "No slots on this site yet."));
      } else {
        var tableWrap = el("div", "admin-table-wrap");
        var table = document.createElement("table");
        table.className = "admin-table";

        var thead = document.createElement("thead");
        var headRow = document.createElement("tr");
        ["Label", "Format", "Status", "Price", "Deals"].forEach(function (label) {
          headRow.appendChild(el("th", null, label));
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        var tbody = document.createElement("tbody");
        site.slots.forEach(function (slot) {
          var row = document.createElement("tr");
          row.appendChild(el("td", null, slot.label));
          row.appendChild(el("td", null, slot.format));
          var statusCell = document.createElement("td");
          statusCell.appendChild(statusPill(slot.status));
          row.appendChild(statusCell);
          row.appendChild(el("td", null, slot.price));
          row.appendChild(el("td", null, String(slot.dealCount)));
          tbody.appendChild(row);
        });
        table.appendChild(tbody);

        tableWrap.appendChild(table);
        card.appendChild(tableWrap);
      }

      list.appendChild(card);
    });

    renderPagination("sitesPagination", data, function (page) {
      state.sites.page = page;
      loadSites();
    });
  }

  // ---------- Shared confirm modal ----------

  var confirmModalBackdrop = document.getElementById("confirmModalBackdrop");
  var confirmModalText = document.getElementById("confirmModalText");
  var confirmModalCancel = document.getElementById("confirmModalCancel");
  var confirmModalConfirm = document.getElementById("confirmModalConfirm");
  var pendingConfirmAction = null;

  function confirmAction(text, onConfirm) {
    confirmModalText.textContent = text;
    pendingConfirmAction = onConfirm;
    confirmModalBackdrop.hidden = false;
  }

  function closeConfirmModal() {
    confirmModalBackdrop.hidden = true;
    pendingConfirmAction = null;
  }

  confirmModalCancel.addEventListener("click", closeConfirmModal);
  confirmModalBackdrop.addEventListener("click", function (event) {
    if (event.target === confirmModalBackdrop) {
      closeConfirmModal();
    }
  });
  confirmModalConfirm.addEventListener("click", function () {
    var action = pendingConfirmAction;
    closeConfirmModal();
    if (action) {
      action();
    }
  });

  checkAuth();
})();
