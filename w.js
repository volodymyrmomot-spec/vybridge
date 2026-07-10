(function () {
  "use strict";

  // This is the one script a publisher ever adds to their site by hand.
  // Two mutually exclusive modes, both driven by this same tag:
  //  - ?vybridge_pick=TOKEN&vybridge_slot=ID in the page URL -> visual
  //    placement picker (see startPickerMode).
  //  - otherwise -> normal ad serving for whatever slots on this site
  //    currently have a live, approved creative (see startAdServing).
  var currentScript = document.currentScript || document.querySelector('script[src*="w.js"]');
  var apiOrigin = "";
  if (currentScript) {
    try {
      apiOrigin = new URL(currentScript.src).origin;
    } catch (err) {
      apiOrigin = "";
    }
  }

  var params = new URLSearchParams(window.location.search);
  var pickToken = params.get("vybridge_pick");
  var pickSlotId = params.get("vybridge_slot");

  // True when this page was opened inside the /slots/new iframe (the new,
  // primary picker flow) rather than in its own tab (the older per-slot
  // "Pick placement" dashboard button, which still posts straight to
  // /api/slots/:id/selector — see onClickTab further down).
  var embedded = window.self !== window.top;

  // Every other piece of module state that startAdServing/startPickerMode
  // (and the functions they call) touch also has to live up here, before
  // the ready(...) dispatch below — ready(fn) can invoke fn synchronously,
  // before the script has finished evaluating the rest of the file, and a
  // `var x = ...` statement further down would silently clobber whatever an
  // early synchronous call already assigned once execution reached it.
  var clickDestinations = {};
  var messageListenerAdded = false;
  var toastEl = null;
  var lastHighlighted = null;
  var previewEl = null;

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  if (pickToken && pickSlotId) {
    ready(function () {
      startPickerMode(pickToken, pickSlotId);
    });
  } else if (currentScript) {
    var siteKey = currentScript.getAttribute("data-site");
    if (siteKey) {
      ready(function () {
        startAdServing(siteKey);
      });
    }
  }

  // ---------- Ad serving ----------

  function startAdServing(siteKey) {
    fetch(apiOrigin + "/api/widget/" + encodeURIComponent(siteKey))
      .then(function (res) {
        return res.json();
      })
      .then(function (slots) {
        if (!Array.isArray(slots)) {
          return;
        }
        slots.forEach(scheduleSlot);
      })
      .catch(function () {});
  }

  function scheduleSlot(slot) {
    var target;
    try {
      target = document.querySelector(slot.dom_selector);
    } catch (err) {
      return;
    }
    if (!target) {
      return;
    }

    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            io.unobserve(target);
            renderAd(target, slot);
          }
        });
      });
      io.observe(target);
    } else {
      renderAd(target, slot);
    }
  }

  function renderAd(target, slot) {
    if (slot.kind === "placeholder") {
      renderPlaceholder(target, slot);
      return;
    }

    clickDestinations[slot.slot_id] = slot.click_tracking_url;
    ensureClickListener();

    var iframe = document.createElement("iframe");
    iframe.width = slot.width;
    iframe.height = slot.height;
    iframe.setAttribute("scrolling", "no");
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
    iframe.style.cssText = "border:0;display:block;width:" + slot.width + "px;height:" + slot.height + "px;";
    iframe.srcdoc =
      "<style>body{margin:0}img{display:block;width:100%;height:100%;cursor:pointer}</style>" +
      '<img src="' +
      escapeAttr(slot.creative_url) +
      '" onclick="parent.postMessage({vybridgeClick:\'' +
      slot.slot_id +
      "'},'*')\">";
    target.appendChild(iframe);
  }

  // Shown in an active slot with nothing booked yet — our own trusted
  // content (not an advertiser's), so a plain styled block instead of the
  // sandboxed iframe renderAd() uses for real creatives.
  function renderPlaceholder(target, slot) {
    var box = document.createElement("div");
    box.style.cssText =
      "box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;" +
      "gap:6px;width:" +
      slot.width +
      "px;height:" +
      slot.height +
      "px;max-width:100%;padding:8px;text-align:center;" +
      "border:2px dashed #7c3aed;border-radius:8px;background:rgba(124,58,237,0.06);" +
      "font:600 13px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#4f46e5;";

    var label = document.createElement("span");
    label.textContent = "Your ad could be here";
    box.appendChild(label);

    var link = document.createElement("a");
    link.href = slot.advertise_url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Advertise on this site";
    link.style.cssText = "color:#7c3aed;text-decoration:underline;font-weight:700;";
    box.appendChild(link);

    target.appendChild(box);
  }

  function ensureClickListener() {
    if (messageListenerAdded) {
      return;
    }
    messageListenerAdded = true;
    window.addEventListener("message", function (event) {
      var id = event.data && event.data.vybridgeClick;
      var url = id && clickDestinations[id];
      if (url) {
        window.open(url, "_blank", "noopener");
      }
    });
  }

  function escapeAttr(str) {
    return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // ---------- Visual placement picker ----------

  // Same buckets described to the publisher on /slots/new — checked in this
  // order, first match wins, so a very wide-but-short element still lands on
  // Leaderboard before the mobile-banner check below it gets a chance.
  function suggestFormat(width, height) {
    if (width > 600) {
      return { value: "728x90", label: "Leaderboard (728×90)", width: 728, height: 90 };
    }
    if (width >= 280 && width <= 400 && height >= 230 && height <= 270) {
      return { value: "300x250", label: "Medium Rectangle (300×250)", width: 300, height: 250 };
    }
    if (width > 280 && height < 100) {
      return { value: "320x50", label: "Mobile Banner (320×50)", width: 320, height: 50 };
    }
    if (width >= 150 && width <= 170 && height >= 580 && height <= 620) {
      return { value: "160x600", label: "Wide Skyscraper (160×600)", width: 160, height: 600 };
    }
    return { value: "custom", label: "Custom (" + width + "×" + height + ")", width: width, height: height };
  }

  // Rough position-based guess for the label field, which the publisher can
  // always edit before creating the slot — this only saves them typing.
  function suggestLabel(rect) {
    var pageY = rect.top + window.scrollY;
    var pageHeight = document.documentElement.scrollHeight;
    if (pageY < 400) {
      return "Header banner";
    }
    if (pageY > pageHeight - 600) {
      return "Footer banner";
    }
    if (rect.left < 120 || window.innerWidth - rect.right < 120) {
      return "Sidebar banner";
    }
    return "Content banner";
  }

  function computeSelector(el) {
    if (el.id) {
      return "#" + CSS.escape(el.id);
    }

    var path = [];
    var node = el;
    while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
      var part = node.tagName.toLowerCase();
      if (node.id) {
        part = "#" + CSS.escape(node.id);
        path.unshift(part);
        break;
      }
      var sibling = node;
      var nth = 1;
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.tagName === node.tagName) {
          nth++;
        }
      }
      part += ":nth-of-type(" + nth + ")";
      path.unshift(part);
      node = node.parentElement;
    }
    return path.join(" > ") || "body";
  }

  function injectPickerStyles() {
    var style = document.createElement("style");
    style.textContent =
      ".vybridge-picker-highlight{outline:2px solid #7c3aed !important;outline-offset:-2px !important;" +
      "background-color:rgba(124,58,237,0.12) !important;cursor:pointer !important;}" +
      "#vybridge-picker-toast{position:fixed;top:16px;left:50%;transform:translateX(-50%);" +
      "z-index:2147483647;background:#0f172a;color:#fff;padding:12px 20px;border-radius:10px;" +
      "font:14px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;box-shadow:0 8px 24px rgba(0,0,0,0.25);" +
      "display:flex;align-items:center;gap:14px;max-width:calc(100vw - 32px);}" +
      "#vybridge-picker-toast button{background:rgba(255,255,255,0.12);color:#fff;border:none;" +
      "padding:6px 12px;border-radius:6px;font:inherit;cursor:pointer;}" +
      "#vybridge-picker-toast button:hover{background:rgba(255,255,255,0.2);}" +
      "#vybridge-picker-toast.vybridge-picker-toast--success{background:#059669;}" +
      "#vybridge-picker-toast.vybridge-picker-toast--error{background:#dc2626;}" +
      "#vybridge-picker-preview{position:absolute;z-index:2147483646;box-sizing:border-box;" +
      "display:flex;align-items:center;justify-content:center;text-align:center;padding:8px;" +
      "background:rgba(124,58,237,0.15);border:2px solid #7c3aed;border-radius:6px;" +
      "font:600 13px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#4f46e5;" +
      "pointer-events:none;}";
    document.head.appendChild(style);
  }

  function showPickPreview(el, format) {
    removePickPreview();
    var rect = el.getBoundingClientRect();
    previewEl = document.createElement("div");
    previewEl.id = "vybridge-picker-preview";
    previewEl.style.left = rect.left + window.scrollX + "px";
    previewEl.style.top = rect.top + window.scrollY + "px";
    previewEl.style.width = rect.width + "px";
    previewEl.style.height = rect.height + "px";
    previewEl.textContent = "Your ad will appear here · " + format.label;
    document.body.appendChild(previewEl);
  }

  function removePickPreview() {
    if (previewEl) {
      previewEl.remove();
      previewEl = null;
    }
  }

  function showToast(message, opts) {
    opts = opts || {};
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = "vybridge-picker-toast";
      document.body.appendChild(toastEl);
    }
    toastEl.className = opts.variant ? "vybridge-picker-toast--" + opts.variant : "";
    toastEl.textContent = message + " ";

    if (opts.cancel) {
      var cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", exitPickerMode);
      toastEl.appendChild(cancelBtn);
    }
  }

  function onMouseOver(event) {
    if (lastHighlighted) {
      lastHighlighted.classList.remove("vybridge-picker-highlight");
    }
    lastHighlighted = event.target;
    lastHighlighted.classList.add("vybridge-picker-highlight");
  }

  // Older flow: opened in its own tab from the dashboard's per-slot "Pick
  // placement" button, for a slot whose format/price/duration are already
  // set. Saves straight to the backend on click.
  function onClickTab(event) {
    event.preventDefault();
    event.stopPropagation();

    var selector = computeSelector(event.target);
    document.removeEventListener("mouseover", onMouseOver, true);
    document.removeEventListener("click", onClickTab, true);
    if (lastHighlighted) {
      lastHighlighted.classList.remove("vybridge-picker-highlight");
    }

    showToast("Saving placement…");

    fetch(apiOrigin + "/api/slots/" + encodeURIComponent(pickSlotId) + "/selector", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: pickToken, selector: selector }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, body: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          showToast(result.body.error || "Could not save this placement.", { variant: "error" });
          return;
        }
        showToast("Placement saved ✓", { variant: "success" });
      })
      .catch(function () {
        showToast("Network error — could not save this placement.", { variant: "error" });
      });
  }

  // New flow: framed by /slots/new on the vybridge app. Nothing is written
  // to the backend from here — the selector/size/suggested format are
  // relayed to the parent page, which already holds the token and finishes
  // the slot itself once the publisher confirms label/price/duration.
  function onClickEmbedded(event) {
    event.preventDefault();
    event.stopPropagation();

    var el = event.target;
    var selector = computeSelector(el);
    var rect = el.getBoundingClientRect();
    var width = Math.round(rect.width);
    var height = Math.round(rect.height);
    var format = suggestFormat(width, height);

    document.removeEventListener("mouseover", onMouseOver, true);
    document.removeEventListener("click", onClickEmbedded, true);
    if (lastHighlighted) {
      lastHighlighted.classList.remove("vybridge-picker-highlight");
      lastHighlighted = null;
    }
    if (toastEl) {
      toastEl.remove();
      toastEl = null;
    }

    showPickPreview(el, format);

    window.parent.postMessage(
      {
        vybridgePicked: true,
        selector: selector,
        width: width,
        height: height,
        format: format.value,
        formatLabel: format.label,
        label: suggestLabel(rect),
      },
      "*"
    );
  }

  function onParentMessage(event) {
    if (!event.data || !event.data.vybridgeResetPick) {
      return;
    }
    removePickPreview();
    showToast("Hover over any area and click to place your ad here");
    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("click", onClickEmbedded, true);
  }

  function exitPickerMode() {
    document.removeEventListener("mouseover", onMouseOver, true);
    document.removeEventListener("click", onClickTab, true);
    if (lastHighlighted) {
      lastHighlighted.classList.remove("vybridge-picker-highlight");
    }
    if (toastEl) {
      toastEl.remove();
      toastEl = null;
    }
  }

  function startPickerMode() {
    injectPickerStyles();

    if (embedded) {
      window.parent.postMessage({ vybridgePickerReady: true }, "*");
      window.addEventListener("message", onParentMessage);
      showToast("Hover over any area and click to place your ad here");
      document.addEventListener("mouseover", onMouseOver, true);
      document.addEventListener("click", onClickEmbedded, true);
      return;
    }

    showToast("Click the element where this ad should appear.", { cancel: true });
    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("click", onClickTab, true);
  }
})();
