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
    pending_blogger_approval: "Awaiting blogger's response",
    blogger_accepted: "Accepted — not yet published",
    blogger_published: "Published — awaiting confirmation",
    blogger_declined: "Declined",
  };

  function statusLabel(status) {
    return STATUS_LABELS[status] || status;
  }

  var OFFER_TYPE_ICONS = {
    product: "📦",
    website: "🌐",
    other: "🎯",
  };

  var OFFER_TYPE_LABELS = {
    product: "Product",
    website: "Website / Service",
    other: "Other",
  };

  var AD_FORMAT_ICONS = {
    reels: "🎬",
    stories: "📱",
    post: "📸",
  };

  var AD_FORMAT_LABELS = {
    reels: "Reels/Video",
    stories: "Stories",
    post: "Post/Photo",
  };

  var PLATFORM_ICONS = {
    instagram: "📷",
    tiktok: "🎵",
    youtube: "▶️",
  };

  var PLATFORM_LABELS = {
    instagram: "Instagram",
    tiktok: "TikTok",
    youtube: "YouTube",
  };

  var CATEGORY_LABELS = {
    technology: "Technology",
    lifestyle: "Lifestyle",
    automotive: "Automotive",
    fashion: "Fashion",
    food: "Food",
    travel: "Travel",
    sports: "Sports",
    business: "Business",
    entertainment: "Entertainment",
    education: "Education",
    health: "Health",
    news: "News",
    other: "Other",
  };

  var CATEGORY_ICONS = {
    technology: "💻",
    lifestyle: "🧘",
    automotive: "🚗",
    fashion: "👗",
    food: "🍔",
    travel: "✈️",
    sports: "⚽",
    business: "💼",
    entertainment: "🎬",
    education: "🎓",
    health: "❤️",
    news: "📰",
    other: "📦",
  };

  var MONTHLY_VISITORS_LABELS = {
    under_1k: "Under 1,000",
    "1k_10k": "1,000 – 10,000",
    "10k_50k": "10,000 – 50,000",
    "50k_200k": "50,000 – 200,000",
    "200k_plus": "200,000+",
  };

  var AUDIENCE_LANGUAGE_LABELS = {
    english: "English",
    slovak: "Slovak",
    ukrainian: "Ukrainian",
    russian: "Russian",
    other: "Other",
  };

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
        var siteLabel = deal.offerType ? (OFFER_TYPE_ICONS[deal.offerType] || "") + " " + deal.site : deal.site;
        row.appendChild(el("td", null, siteLabel));
        row.appendChild(el("td", null, deal.price));
        var statusCell = document.createElement("td");
        statusCell.appendChild(statusPill(deal.status));
        row.appendChild(statusCell);
        row.appendChild(el("td", null, formatDate(deal.createdAt)));

        var actionsCell = document.createElement("td");
        if (deal.publishedUrl) {
          var link = document.createElement("a");
          link.href = deal.publishedUrl;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = "View post";
          link.className = "dashboard-table__link";
          actionsCell.appendChild(link);
        }
        if (deal.status === "blogger_published") {
          var confirmBtn = el("button", "btn btn--purple btn--sm", "Confirm");
          confirmBtn.type = "button";
          confirmBtn.style.marginLeft = "10px";
          confirmBtn.addEventListener("click", function () {
            confirmBtn.disabled = true;
            fetch("/api/blogger-offers/" + encodeURIComponent(deal.id) + "/confirm", {
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
                  confirmBtn.disabled = false;
                  window.alert(result.body.error || "Could not confirm this campaign. Please try again.");
                  return;
                }
                loadDashboard();
              })
              .catch(function () {
                confirmBtn.disabled = false;
                window.alert("Network error. Please try again.");
              });
          });
          actionsCell.appendChild(confirmBtn);
        }
        row.appendChild(actionsCell);

        body.appendChild(row);
      });
    }

    document.getElementById("advertiserDashboard").hidden = false;
  }

  // ---------- Install guide (Step 1: install the script) ----------

  var installPollTimer = null;

  function installTabButtons() {
    return document.querySelectorAll(".install-guide__tab");
  }

  function selectInstallTab(tabName) {
    installTabButtons().forEach(function (btn) {
      var active = btn.dataset.tab === tabName;
      btn.classList.toggle("install-guide__tab--active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll("[data-panel]").forEach(function (panel) {
      panel.hidden = panel.dataset.panel !== tabName;
    });
  }

  installTabButtons().forEach(function (btn) {
    btn.addEventListener("click", function () {
      selectInstallTab(btn.dataset.tab);
    });
  });

  var helpCardMyself = document.getElementById("helpCardMyself");
  var installSelfPanel = document.getElementById("installSelfPanel");
  if (helpCardMyself) {
    helpCardMyself.addEventListener("click", function () {
      var expanded = !installSelfPanel.hidden;
      installSelfPanel.hidden = expanded;
      helpCardMyself.setAttribute("aria-expanded", expanded ? "false" : "true");
      helpCardMyself.classList.toggle("help-card--active", !expanded);
    });
  }

  var helpCardAi = document.getElementById("helpCardAi");
  var aiPromptBackdrop = document.getElementById("aiPromptBackdrop");
  var aiPromptModalCloseBtn = document.getElementById("aiPromptModalCloseBtn");
  if (helpCardAi) {
    helpCardAi.addEventListener("click", function () {
      aiPromptBackdrop.hidden = false;
    });
  }
  if (aiPromptModalCloseBtn) {
    aiPromptModalCloseBtn.addEventListener("click", function () {
      aiPromptBackdrop.hidden = true;
    });
  }
  if (aiPromptBackdrop) {
    aiPromptBackdrop.addEventListener("click", function (event) {
      if (event.target === aiPromptBackdrop) {
        aiPromptBackdrop.hidden = true;
      }
    });
  }

  var copyAiPromptBtn = document.getElementById("copyAiPromptBtn");
  if (copyAiPromptBtn) {
    copyAiPromptBtn.addEventListener("click", function () {
      var text = document.getElementById("aiPromptText").textContent;
      var showCopied = function () {
        var original = "Copy prompt";
        copyAiPromptBtn.textContent = "Copied ✓";
        setTimeout(function () {
          copyAiPromptBtn.textContent = original;
        }, 1800);
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(showCopied, function () {
          if (fallbackCopy(text)) {
            showCopied();
          } else {
            window.alert("Could not copy automatically — please select the text and copy it manually.");
          }
        });
      } else if (fallbackCopy(text)) {
        showCopied();
      } else {
        window.alert("Could not copy automatically — please select the text and copy it manually.");
      }
    });
  }

  function fallbackCopy(text) {
    var textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    var copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (err) {
      copied = false;
    }
    document.body.removeChild(textarea);
    return copied;
  }

  var copyCodeBtn = document.getElementById("copyCodeBtn");
  if (copyCodeBtn) {
    copyCodeBtn.addEventListener("click", function () {
      var code = document.getElementById("mySiteSnippetCode").textContent;
      var showCopied = function () {
        var original = "Copy code";
        copyCodeBtn.textContent = "Copied ✓";
        setTimeout(function () {
          copyCodeBtn.textContent = original;
        }, 1800);
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(showCopied, function () {
          if (fallbackCopy(code)) {
            showCopied();
          } else {
            window.alert("Could not copy automatically — please select the code and copy it manually.");
          }
        });
      } else if (fallbackCopy(code)) {
        showCopied();
      } else {
        window.alert("Could not copy automatically — please select the code and copy it manually.");
      }
    });
  }

  function setInstallStatus(state) {
    var block = document.getElementById("connectionStatus");
    var icon = document.getElementById("connectionStatusIcon");
    var text = document.getElementById("connectionStatusText");
    var nextStep = document.getElementById("nextStepBlock");
    if (state === "detected") {
      icon.textContent = "✅";
      text.textContent = "Connected!";
      block.className = "connection-status connection-status--connected";
      nextStep.hidden = false;
    } else {
      icon.textContent = "⏳";
      text.textContent = "Not connected yet";
      block.className = "connection-status connection-status--pending";
      nextStep.hidden = true;
    }
  }

  // Polls GET /api/sites/:site_key/verify (true once w.js has actually
  // loaded from this domain in the last 24h — see lib/script-track.js) so
  // the checkmark appears on its own, without the publisher refreshing.
  function pollInstallStatus(siteKey) {
    if (installPollTimer) {
      clearInterval(installPollTimer);
      installPollTimer = null;
    }

    function check() {
      fetch("/api/sites/" + encodeURIComponent(siteKey) + "/verify", { credentials: "same-origin" })
        .then(function (res) {
          return res.json();
        })
        .then(function (result) {
          if (!result.ok) {
            return;
          }
          setInstallStatus(result.verified ? "detected" : "pending");
          if (result.verified && installPollTimer) {
            clearInterval(installPollTimer);
            installPollTimer = null;
          }
        })
        .catch(function () {});
    }

    check();
    installPollTimer = setInterval(check, 15000);
  }

  var downloadWpPluginBtn = document.getElementById("downloadWpPluginBtn");
  if (downloadWpPluginBtn) {
    downloadWpPluginBtn.addEventListener("click", function () {
      window.alert("The WordPress plugin is coming soon — for now, use the code snippet below.");
    });
  }

  // wix and squarespace share the same tab; anything else (including a
  // domain we couldn't reach or didn't recognize) falls back to the plain
  // HTML instructions, which work for every site regardless of platform.
  var CMS_TAB_MAP = {
    wordpress: "wordpress",
    wix: "wix",
    squarespace: "wix",
    shopify: "html",
    webflow: "html",
    tilda: "html",
    unknown: "html",
  };

  // Runs once per page load per site — a publisher who manually switches
  // tabs afterward shouldn't have their choice overridden by a later
  // dashboard refresh (e.g. the visibilitychange reload after the picker
  // flow).
  var cmsDetectedForSiteKey = null;

  function detectAndSelectTab(siteKey) {
    if (cmsDetectedForSiteKey === siteKey) {
      return;
    }
    cmsDetectedForSiteKey = siteKey;

    fetch("/api/sites/" + encodeURIComponent(siteKey) + "/detect-cms", { credentials: "same-origin" })
      .then(function (res) {
        return res.json();
      })
      .then(function (result) {
        if (!result.ok) {
          return;
        }
        selectInstallTab(CMS_TAB_MAP[result.cms] || "html");
      })
      .catch(function () {});
  }

  // ---------- My site info (audience details) ----------

  var currentSite = null;
  var siteInfoForm = document.getElementById("siteInfoForm");
  var editSiteInfoBtn = document.getElementById("editSiteInfoBtn");
  var cancelSiteInfoBtn = document.getElementById("cancelSiteInfoBtn");
  var siteInfoDescriptionInput = document.getElementById("siteInfoDescription");
  var siteInfoDescriptionCounter = document.getElementById("siteInfoDescriptionCounter");

  function renderSiteAudienceInfo(site) {
    var dl = document.getElementById("siteAudienceInfo");
    dl.innerHTML = "";

    function addRow(label, value) {
      dl.appendChild(el("dt", null, label));
      var dd = document.createElement("dd");
      if (value) {
        dd.textContent = value;
      } else {
        dd.textContent = "No info provided";
        dd.className = "dashboard-site-info__value--empty";
      }
      dl.appendChild(dd);
    }

    addRow("Category", site.category ? CATEGORY_ICONS[site.category] + " " + CATEGORY_LABELS[site.category] : null);
    addRow("Monthly visitors", site.monthlyVisitors ? MONTHLY_VISITORS_LABELS[site.monthlyVisitors] : null);
    addRow("Audience country", site.audienceCountry);
    addRow("Audience language", site.audienceLanguage ? AUDIENCE_LANGUAGE_LABELS[site.audienceLanguage] : null);
    addRow("Description", site.siteDescription);
  }

  // ---------- Marketplace Preview (cover image) ----------

  var coverPreview = document.getElementById("coverPreview");
  var coverUploadInput = document.getElementById("coverUploadInput");
  var removeCoverBtn = document.getElementById("removeCoverBtn");

  function clearCoverFormMessage() {
    var msg = document.getElementById("coverFormMessage");
    msg.hidden = true;
    msg.textContent = "";
  }

  function setCoverFormMessage(message) {
    var msg = document.getElementById("coverFormMessage");
    msg.textContent = message;
    msg.hidden = false;
  }

  // coverImageUrl is the only thing this reads — it never looks at
  // coverSource, matching every other reader of this field (Marketplace
  // catalog, site page): the dashboard preview doesn't care whether a
  // future automatic/AI source produced the image either.
  function renderCoverSection(site) {
    if (!coverPreview) {
      return;
    }
    coverPreview.innerHTML = "";
    if (!site) {
      return;
    }
    if (site.coverImageUrl) {
      var img = document.createElement("img");
      img.className = "cover-preview__image";
      img.src = site.coverImageUrl;
      img.alt = "";
      coverPreview.appendChild(img);
      if (removeCoverBtn) {
        removeCoverBtn.hidden = false;
      }
    } else {
      coverPreview.appendChild(el("span", "cover-preview__placeholder", "No cover yet"));
      if (removeCoverBtn) {
        removeCoverBtn.hidden = true;
      }
    }
  }

  if (coverUploadInput) {
    coverUploadInput.addEventListener("change", function () {
      var file = coverUploadInput.files && coverUploadInput.files[0];
      if (!file || !currentSite) {
        return;
      }
      clearCoverFormMessage();

      var formData = new FormData();
      formData.append("cover", file);

      // No Content-Type header here — the browser sets
      // multipart/form-data with the correct boundary itself.
      fetch("/api/sites/" + encodeURIComponent(currentSite.siteKey) + "/cover", {
        method: "POST",
        credentials: "same-origin",
        body: formData,
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, body: data };
          });
        })
        .then(function (result) {
          coverUploadInput.value = "";
          if (!result.ok) {
            setCoverFormMessage(result.body.error || "Could not upload the cover image. Please try again.");
            return;
          }
          currentSite = result.body.site;
          renderCoverSection(currentSite);
        })
        .catch(function () {
          coverUploadInput.value = "";
          setCoverFormMessage("Network error. Please try again.");
        });
    });
  }

  if (removeCoverBtn) {
    removeCoverBtn.addEventListener("click", function () {
      if (!currentSite) {
        return;
      }
      clearCoverFormMessage();
      removeCoverBtn.disabled = true;

      fetch("/api/sites/" + encodeURIComponent(currentSite.siteKey) + "/cover", {
        method: "DELETE",
        credentials: "same-origin",
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, body: data };
          });
        })
        .then(function (result) {
          removeCoverBtn.disabled = false;
          if (!result.ok) {
            setCoverFormMessage(result.body.error || "Could not remove the cover image. Please try again.");
            return;
          }
          currentSite = result.body.site;
          renderCoverSection(currentSite);
        })
        .catch(function () {
          removeCoverBtn.disabled = false;
          setCoverFormMessage("Network error. Please try again.");
        });
    });
  }

  function updateDescriptionCounter() {
    siteInfoDescriptionCounter.textContent = siteInfoDescriptionInput.value.length + " / 300";
  }

  if (siteInfoDescriptionInput) {
    siteInfoDescriptionInput.addEventListener("input", updateDescriptionCounter);
  }

  function clearSiteInfoFormErrors() {
    var msg = document.getElementById("siteInfoFormMessage");
    msg.hidden = true;
    msg.textContent = "";
  }

  function setSiteInfoFormMessage(message) {
    var msg = document.getElementById("siteInfoFormMessage");
    msg.textContent = message;
    msg.hidden = false;
  }

  function openSiteInfoForm(site) {
    document.getElementById("siteInfoCategory").value = site.category || "";
    document.getElementById("siteInfoVisitors").value = site.monthlyVisitors || "";
    document.getElementById("siteInfoCountry").value = site.audienceCountry || "";
    document.getElementById("siteInfoLanguage").value = site.audienceLanguage || "";
    siteInfoDescriptionInput.value = site.siteDescription || "";
    updateDescriptionCounter();
    clearSiteInfoFormErrors();
    siteInfoForm.hidden = false;
    editSiteInfoBtn.hidden = true;
  }

  function closeSiteInfoForm() {
    siteInfoForm.hidden = true;
    editSiteInfoBtn.hidden = false;
  }

  if (editSiteInfoBtn) {
    editSiteInfoBtn.addEventListener("click", function () {
      if (currentSite) {
        openSiteInfoForm(currentSite);
      }
    });
  }

  if (cancelSiteInfoBtn) {
    cancelSiteInfoBtn.addEventListener("click", function () {
      closeSiteInfoForm();
    });
  }

  if (siteInfoForm) {
    siteInfoForm.addEventListener("submit", function (event) {
      event.preventDefault();
      clearSiteInfoFormErrors();

      var submitBtn = siteInfoForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;

      fetch("/api/sites/" + encodeURIComponent(currentSite.siteKey), {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: document.getElementById("siteInfoCategory").value,
          monthlyVisitors: document.getElementById("siteInfoVisitors").value,
          audienceCountry: document.getElementById("siteInfoCountry").value,
          audienceLanguage: document.getElementById("siteInfoLanguage").value,
          siteDescription: siteInfoDescriptionInput.value,
        }),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, body: data };
          });
        })
        .then(function (result) {
          submitBtn.disabled = false;
          if (!result.ok) {
            setSiteInfoFormMessage(result.body.error || "Could not save. Please check the fields and try again.");
            return;
          }
          currentSite = result.body.site;
          renderSiteAudienceInfo(currentSite);
          closeSiteInfoForm();
        })
        .catch(function () {
          submitBtn.disabled = false;
          setSiteInfoFormMessage("Network error. Please try again.");
        });
    });
  }

  function buildDevEmailHref(snippetCode) {
    var subject = "Please connect our website to Vybridge ad platform";
    var body =
      "Hi,\n\n" +
      "I'd like to start monetizing our website with Vybridge — an advertising marketplace.\n\n" +
      "Please add the following script tag to the <head> section of our website:\n\n" +
      snippetCode +
      "\n\nAfter adding the script, I'll handle the rest through the Vybridge dashboard myself.\n\n" +
      "This is a one-time change and takes about 2 minutes.\n\n" +
      "Thank you!";
    return "mailto:?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  }

  function buildAiPrompt(snippetCode) {
    return (
      "Please add the Vybridge advertising widget to this website.\n\n" +
      "Add the following script tag inside the <head> section of the main layout file (or every page if there's no shared layout):\n\n" +
      snippetCode +
      "\n\nThis script must load on every page of the website. It is lightweight (under 5KB), loads asynchronously and will not affect page speed.\n\n" +
      "After adding it, please confirm which file was modified and deploy the changes."
    );
  }

  function renderMySite(site) {
    var dl = document.getElementById("mySiteInfo");
    var snippetWrap = document.getElementById("mySiteSnippet");
    dl.innerHTML = "";
    currentSite = site;

    if (!site) {
      dl.appendChild(el("dd", null, "No site on file yet."));
      snippetWrap.hidden = true;
      document.getElementById("siteAudienceInfo").innerHTML = "";
      if (editSiteInfoBtn) {
        editSiteInfoBtn.hidden = true;
      }
      closeSiteInfoForm();
      renderCoverSection(null);
      if (installPollTimer) {
        clearInterval(installPollTimer);
        installPollTimer = null;
      }
      return;
    }
    dl.appendChild(el("dt", null, "Domain"));
    dl.appendChild(el("dd", null, site.domain));
    dl.appendChild(el("dt", null, "Site key"));
    dl.appendChild(el("dd", null, site.siteKey));

    var snippetCode =
      '<script src="' + window.location.origin + '/w.js" data-site="' + site.siteKey + '" async></' + "script>";
    document.getElementById("mySiteSnippetCode").textContent = snippetCode;
    document.getElementById("helpCardDeveloper").href = buildDevEmailHref(snippetCode);
    document.getElementById("aiPromptText").textContent = buildAiPrompt(snippetCode);
    snippetWrap.hidden = false;

    setInstallStatus(null);
    pollInstallStatus(site.siteKey);
    detectAndSelectTab(site.siteKey);

    renderSiteAudienceInfo(site);
    if (editSiteInfoBtn) {
      editSiteInfoBtn.hidden = false;
    }
    renderCoverSection(site);
  }

  function renderPayoutsStatus(payouts, containerId) {
    var container = document.getElementById(containerId || "payoutsStatus");
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

  // A slot's domSelector starts out as this auto-generated placeholder
  // (see lib/slots.js) until either the old CSS-selector picker overwrites
  // it with a real one, or the drag-to-select picker sets posX/posY
  // instead (domSelector stays the placeholder forever for those, by
  // design) — so "not picked yet" means neither has happened.
  var currentSlots = [];

  function needsPicker(slot) {
    var domUnset = slot.domSelector === "#vybridge-slot-" + slot.id;
    var posUnset = slot.posX === null || slot.posX === undefined;
    return domUnset && posUnset;
  }

  function findSlotNeedingPicker() {
    for (var i = 0; i < currentSlots.length; i++) {
      if (needsPicker(currentSlots[i])) {
        return currentSlots[i];
      }
    }
    return null;
  }

  var openPickerBtn = document.getElementById("openPickerBtn");
  if (openPickerBtn) {
    openPickerBtn.addEventListener("click", function () {
      if (!currentSlots.length) {
        window.location.href = "/slots/new";
        return;
      }
      var slot = findSlotNeedingPicker();
      if (!slot) {
        window.location.href = "/slots/new";
        return;
      }
      startPlacementPicker(slot.id, openPickerBtn);
    });
  }

  function renderSlots(slots) {
    currentSlots = slots;
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
      var placementText =
        slot.posX !== null && slot.posX !== undefined
          ? slot.posX + ", " + slot.posY + " (" + slot.posWidth + "×" + slot.posHeight + ")"
          : slot.domSelector;
      row.appendChild(el("td", "dashboard-cell--code", placementText));

      var actionCell = document.createElement("td");
      // Only offered for a slot that was never positioned at all (legacy
      // recovery case) — re-running the old element-click picker on a slot
      // already positioned by drag-to-select would write a domSelector
      // that w.js then ignores in favor of the existing posX/posY.
      if (needsPicker(slot)) {
        var pickBtn = el("button", "btn btn--outline btn--sm", "Pick placement");
        pickBtn.type = "button";
        pickBtn.addEventListener("click", function () {
          startPlacementPicker(slot.id, pickBtn);
        });
        actionCell.appendChild(pickBtn);
      }
      row.appendChild(actionCell);

      var deleteCell = document.createElement("td");
      var deleteBtn = el("button", "btn btn--danger btn--sm", "Delete");
      deleteBtn.type = "button";
      deleteBtn.addEventListener("click", function () {
        openDeleteSlotModal(slot.id, row);
      });
      deleteCell.appendChild(deleteBtn);
      row.appendChild(deleteCell);

      body.appendChild(row);
    });
  }

  // ---------- Delete slot ----------

  var deleteSlotBackdrop = document.getElementById("deleteSlotBackdrop");
  var deleteSlotConfirmBtn = document.getElementById("deleteSlotConfirmBtn");
  var deleteSlotCancelBtn = document.getElementById("deleteSlotCancelBtn");
  var deleteSlotModalCloseBtn = document.getElementById("deleteSlotModalCloseBtn");
  var deleteSlotFormMessage = document.getElementById("deleteSlotFormMessage");
  var pendingDeleteSlotId = null;
  var pendingDeleteRow = null;

  function openDeleteSlotModal(slotId, row) {
    pendingDeleteSlotId = slotId;
    pendingDeleteRow = row;
    deleteSlotFormMessage.hidden = true;
    deleteSlotBackdrop.hidden = false;
  }

  function closeDeleteSlotModal() {
    pendingDeleteSlotId = null;
    pendingDeleteRow = null;
    deleteSlotBackdrop.hidden = true;
  }

  if (deleteSlotCancelBtn) {
    deleteSlotCancelBtn.addEventListener("click", closeDeleteSlotModal);
  }
  if (deleteSlotModalCloseBtn) {
    deleteSlotModalCloseBtn.addEventListener("click", closeDeleteSlotModal);
  }
  if (deleteSlotBackdrop) {
    deleteSlotBackdrop.addEventListener("click", function (event) {
      if (event.target === deleteSlotBackdrop) {
        closeDeleteSlotModal();
      }
    });
  }

  if (deleteSlotConfirmBtn) {
    deleteSlotConfirmBtn.addEventListener("click", function () {
      if (!pendingDeleteSlotId) {
        return;
      }
      var slotId = pendingDeleteSlotId;
      var row = pendingDeleteRow;
      deleteSlotConfirmBtn.disabled = true;

      fetch("/api/slots/" + encodeURIComponent(slotId), {
        method: "DELETE",
        credentials: "same-origin",
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, body: data };
          });
        })
        .then(function (result) {
          deleteSlotConfirmBtn.disabled = false;
          if (!result.ok) {
            deleteSlotFormMessage.textContent = result.body.error || "Could not delete this slot. Please try again.";
            deleteSlotFormMessage.hidden = false;
            return;
          }

          currentSlots = currentSlots.filter(function (slot) {
            return slot.id !== slotId;
          });
          if (row) {
            row.remove();
          }
          var body = document.getElementById("publisherSlotsBody");
          if (!body.children.length) {
            body.closest(".dashboard-table-wrap").hidden = true;
            document.getElementById("publisherSlotsEmpty").hidden = false;
          }
          closeDeleteSlotModal();
        })
        .catch(function () {
          deleteSlotConfirmBtn.disabled = false;
          deleteSlotFormMessage.textContent = "Network error. Please try again.";
          deleteSlotFormMessage.hidden = false;
        });
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

  // ---------- Blogger dashboard ----------

  function renderBloggerChannels(channels) {
    var body = document.getElementById("bloggerChannelsBody");
    var table = body.closest(".dashboard-table-wrap");
    var empty = document.getElementById("bloggerChannelsEmpty");
    body.innerHTML = "";

    if (!channels.length) {
      table.hidden = true;
      empty.hidden = false;
      return;
    }
    table.hidden = false;
    empty.hidden = true;

    channels.forEach(function (channel) {
      var row = document.createElement("tr");
      row.appendChild(el("td", null, (PLATFORM_ICONS[channel.platform] || "") + " " + (PLATFORM_LABELS[channel.platform] || channel.platform)));
      row.appendChild(el("td", null, channel.channelHandle || "—"));
      row.appendChild(el("td", null, channel.followersCount.toLocaleString()));
      row.appendChild(el("td", null, channel.contentCategory ? (CATEGORY_ICONS[channel.contentCategory] + " " + CATEGORY_LABELS[channel.contentCategory]) : "—"));
      row.appendChild(el("td", null, channel.pricePerPost));
      body.appendChild(row);
    });
  }

  function offerSubject(offer) {
    return (PLATFORM_ICONS[offer.channelPlatform] || "") + " " + (offer.channelHandle || PLATFORM_LABELS[offer.channelPlatform] || offer.channelPlatform);
  }

  // Falls back to the channel label for any deal that predates the
  // offer-type fields (offerType null) — never a blank title.
  function offerTitle(offer) {
    if (!offer.offerType) {
      return offerSubject(offer);
    }
    var icon = OFFER_TYPE_ICONS[offer.offerType] || "";
    if (offer.offerType === "other") {
      return icon + " " + OFFER_TYPE_LABELS.other;
    }
    return icon + " " + (offer.productName || OFFER_TYPE_LABELS[offer.offerType]);
  }

  // The full "what is this campaign" block — used on both the incoming
  // offer card (blogger deciding whether to accept) and the active
  // campaign card, so a blogger never has to message the advertiser to
  // understand what's being asked of them.
  function buildOfferDetails(offer) {
    var wrap = el("div", "offer-details");

    if (offer.productImageUrl) {
      var img = document.createElement("img");
      img.src = offer.productImageUrl;
      img.alt = offer.productName || "Product photo";
      img.className = "offer-details__image";
      wrap.appendChild(img);
    }

    var tags = el("div", "offer-details__tags");
    if (offer.adFormat) {
      tags.appendChild(el("span", "offer-details__tag", (AD_FORMAT_ICONS[offer.adFormat] || "") + " " + (AD_FORMAT_LABELS[offer.adFormat] || offer.adFormat)));
    }
    if (offer.websiteUrl) {
      var link = document.createElement("a");
      link.href = offer.websiteUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = offer.websiteUrl;
      link.className = "offer-details__tag offer-details__tag--link";
      tags.appendChild(link);
    }
    if (tags.children.length) {
      wrap.appendChild(tags);
    }

    if (offer.contentDescription) {
      wrap.appendChild(el("p", "offer-details__description", offer.contentDescription));
    }

    if (offer.sendPhysicalProduct) {
      wrap.appendChild(
        el(
          "p",
          "offer-details__note",
          "📦 Advertiser will send a physical product" + (offer.deliveryInstructions ? ": " + offer.deliveryInstructions : "")
        )
      );
    }

    return wrap;
  }

  function renderIncomingOffers(offers, onAction) {
    var list = document.getElementById("incomingOffersList");
    var empty = document.getElementById("incomingOffersEmpty");
    list.innerHTML = "";

    if (!offers.length) {
      list.hidden = true;
      empty.hidden = false;
      return;
    }
    list.hidden = false;
    empty.hidden = true;

    offers.forEach(function (offer) {
      var item = el("div", "approval-item approval-item--offer");
      item.dataset.dealId = offer.id;

      var info = el("div", "approval-item__info");
      info.appendChild(el("span", "approval-item__site", offer.advertiserName + " — " + offerTitle(offer)));
      info.appendChild(el("span", "approval-item__meta", offerSubject(offer) + " · " + offer.price));
      info.appendChild(buildOfferDetails(offer));
      item.appendChild(info);

      var actions = el("div", "approval-item__actions");
      var acceptBtn = el("button", "btn btn--purple", "Accept");
      acceptBtn.type = "button";
      var declineBtn = el("button", "btn btn--danger", "Decline");
      declineBtn.type = "button";

      acceptBtn.addEventListener("click", function () {
        onAction(offer.id, "accept", item, [acceptBtn, declineBtn]);
      });
      declineBtn.addEventListener("click", function () {
        onAction(offer.id, "decline", item, [acceptBtn, declineBtn]);
      });

      actions.appendChild(acceptBtn);
      actions.appendChild(declineBtn);
      item.appendChild(actions);

      list.appendChild(item);
    });
  }

  function reviewOffer(dealId, action, itemEl, buttons) {
    buttons.forEach(function (btn) {
      btn.disabled = true;
    });

    fetch("/api/blogger-offers/" + encodeURIComponent(dealId) + "/" + action, {
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
          window.alert(result.body.error || "Could not update this offer. Please refresh and try again.");
          return;
        }
        loadDashboard();
      })
      .catch(function () {
        buttons.forEach(function (btn) {
          btn.disabled = false;
        });
        window.alert("Network error. Please try again.");
      });
  }

  var publishBackdrop = document.getElementById("publishBackdrop");
  var publishForm = document.getElementById("publishForm");
  var publishModalCloseBtn = document.getElementById("publishModalCloseBtn");
  var publishConfirmBtn = document.getElementById("publishConfirmBtn");
  var publishingDealId = null;

  function openPublishModal(dealId) {
    publishingDealId = dealId;
    if (publishForm) {
      publishForm.reset();
      document.getElementById("publishedUrlError").hidden = true;
      document.getElementById("publishFormMessage").hidden = true;
    }
    if (publishBackdrop) {
      publishBackdrop.hidden = false;
    }
  }

  function closePublishModal() {
    publishingDealId = null;
    if (publishBackdrop) {
      publishBackdrop.hidden = true;
    }
  }

  if (publishModalCloseBtn) {
    publishModalCloseBtn.addEventListener("click", closePublishModal);
  }
  if (publishBackdrop) {
    publishBackdrop.addEventListener("click", function (event) {
      if (event.target === publishBackdrop) {
        closePublishModal();
      }
    });
  }
  if (publishForm) {
    publishForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var urlInput = document.getElementById("publishedUrlInput");
      var url = urlInput.value.trim();
      var errorEl = document.getElementById("publishedUrlError");
      errorEl.hidden = true;

      if (!url || !/^https?:\/\//i.test(url)) {
        errorEl.textContent = "Enter a URL starting with http:// or https://";
        errorEl.hidden = false;
        return;
      }

      publishConfirmBtn.disabled = true;
      fetch("/api/blogger-offers/" + encodeURIComponent(publishingDealId) + "/publish", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publishedUrl: url }),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, body: data };
          });
        })
        .then(function (result) {
          publishConfirmBtn.disabled = false;
          if (!result.ok) {
            var msg = document.getElementById("publishFormMessage");
            msg.textContent = result.body.error || "Could not save this link. Please try again.";
            msg.hidden = false;
            return;
          }
          closePublishModal();
          loadDashboard();
        })
        .catch(function () {
          publishConfirmBtn.disabled = false;
          var msg = document.getElementById("publishFormMessage");
          msg.textContent = "Network error. Please try again.";
          msg.hidden = false;
        });
    });
  }

  function renderActiveCampaigns(campaigns) {
    var list = document.getElementById("activeCampaignsList");
    var empty = document.getElementById("activeCampaignsEmpty");
    list.innerHTML = "";

    if (!campaigns.length) {
      list.hidden = true;
      empty.hidden = false;
      return;
    }
    list.hidden = false;
    empty.hidden = true;

    campaigns.forEach(function (campaign) {
      var item = el("div", "approval-item approval-item--offer");

      var info = el("div", "approval-item__info");
      info.appendChild(el("span", "approval-item__site", campaign.advertiserName + " — " + offerTitle(campaign)));
      info.appendChild(el("span", "approval-item__meta", offerSubject(campaign) + " · " + campaign.price));
      info.appendChild(buildOfferDetails(campaign));
      item.appendChild(info);

      var actions = el("div", "approval-item__actions");
      if (campaign.status === "blogger_accepted") {
        var publishBtn = el("button", "btn btn--purple", "Mark as published");
        publishBtn.type = "button";
        publishBtn.addEventListener("click", function () {
          openPublishModal(campaign.id);
        });
        actions.appendChild(publishBtn);
      } else {
        actions.appendChild(statusPill(campaign.status));
      }
      item.appendChild(actions);

      list.appendChild(item);
    });
  }

  function renderBloggerCompleted(deals) {
    var body = document.getElementById("bloggerCompletedBody");
    var table = body.closest(".dashboard-table-wrap");
    var empty = document.getElementById("bloggerCompletedEmpty");
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
      row.appendChild(el("td", null, deal.advertiserName));
      row.appendChild(el("td", null, offerTitle(deal)));
      var statusCell = document.createElement("td");
      statusCell.appendChild(statusPill(deal.status));
      row.appendChild(statusCell);
      row.appendChild(el("td", null, deal.price));
      body.appendChild(row);
    });
  }

  function renderBloggerDashboard(data) {
    document.getElementById("bloggerName").textContent = data.user.name;
    renderBloggerChannels(data.channels);
    renderPayoutsStatus(data.payouts, "bloggerPayoutsStatus");
    renderIncomingOffers(data.incomingOffers, reviewOffer);
    renderActiveCampaigns(data.activeCampaigns);
    renderBloggerCompleted(data.completed);

    document.getElementById("bloggerDashboard").hidden = false;
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
        } else if (dashboard.role === "blogger") {
          renderBloggerDashboard(dashboard);
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
