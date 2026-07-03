(function () {
  "use strict";

  // This is the one script a publisher ever adds to their site by hand.
  // Right now it only handles the visual placement picker
  // (?vybridge_pick=TOKEN&vybridge_slot=SLOT_ID) — serving live creatives
  // into approved slots is a separate, later step; a page with neither
  // query param loaded does nothing at all today.
  var params = new URLSearchParams(window.location.search);
  var token = params.get("vybridge_pick");
  var slotId = params.get("vybridge_slot");
  if (!token || !slotId) {
    return;
  }

  var currentScript =
    document.currentScript || document.querySelector('script[src*="w.js"]');
  var apiOrigin = "";
  if (currentScript) {
    try {
      apiOrigin = new URL(currentScript.src).origin;
    } catch (err) {
      apiOrigin = "";
    }
  }

  var overlayEl = null;
  var toastEl = null;
  var lastHighlighted = null;

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

  function injectStyles() {
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
      "#vybridge-picker-toast.vybridge-picker-toast--error{background:#dc2626;}";
    document.head.appendChild(style);
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

  function onClick(event) {
    event.preventDefault();
    event.stopPropagation();

    var selector = computeSelector(event.target);
    document.removeEventListener("mouseover", onMouseOver, true);
    document.removeEventListener("click", onClick, true);
    if (lastHighlighted) {
      lastHighlighted.classList.remove("vybridge-picker-highlight");
    }

    showToast("Saving placement…");

    fetch(apiOrigin + "/api/slots/" + encodeURIComponent(slotId) + "/selector", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token, selector: selector }),
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

  function exitPickerMode() {
    document.removeEventListener("mouseover", onMouseOver, true);
    document.removeEventListener("click", onClick, true);
    if (lastHighlighted) {
      lastHighlighted.classList.remove("vybridge-picker-highlight");
    }
    if (toastEl) {
      toastEl.remove();
      toastEl = null;
    }
  }

  function startPickerMode() {
    injectStyles();
    showToast("Click the element where this ad should appear.", { cancel: true });
    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("click", onClick, true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startPickerMode);
  } else {
    startPickerMode();
  }
})();
