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
  var dragStart = null;
  var dragEl = null;

  // Live ad-serving viewport detection — a different, unrelated threshold
  // from the picker tool's own MIN_PICKER_WIDTH gate in new.js (that one
  // decides who can use the picker at all; this one decides which
  // viewport's slots a real visitor sees). 767/768 is the standard
  // mobile/tablet boundary. This is the ONE and only window.matchMedia()
  // call in this file — every other function that needs to know the
  // current viewport calls currentViewportType() below instead.
  var MOBILE_MEDIA_QUERY = "(max-width: 767px)";
  var mobileMql = window.matchMedia(MOBILE_MEDIA_QUERY);
  var allSlots = []; // full fetched list, both viewport types, fetched once
  var renderedSlots = {}; // slot_id -> { wrap, io } currently in the DOM

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

  // A visitor who closes a slot shouldn't see it again for a while, but
  // shouldn't have it gone forever either — localStorage (not a cookie, no
  // server round-trip needed) keyed per slot, checked against this window
  // before ever rendering that slot.
  var CLOSE_HIDE_MS = 12 * 60 * 60 * 1000;

  function closedStorageKey(slotId) {
    return "vybridge_closed_" + slotId;
  }

  function isClosedRecently(slotId) {
    try {
      var raw = window.localStorage.getItem(closedStorageKey(slotId));
      if (!raw) {
        return false;
      }
      var closedAt = Number(raw);
      return Number.isFinite(closedAt) && Date.now() - closedAt < CLOSE_HIDE_MS;
    } catch (err) {
      // localStorage can throw (private browsing, disabled storage) — treat
      // as "never closed" rather than breaking ad serving over it.
      return false;
    }
  }

  function markClosed(slotId) {
    try {
      window.localStorage.setItem(closedStorageKey(slotId), String(Date.now()));
    } catch (err) {}
  }

  function createCloseButton(slotId, containerEl, viewportType) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "×";
    btn.setAttribute("aria-label", "Close");
    // 40x40 minimum tap target on mobile, per the mobile safety
    // requirements — the visible glyph stays small (font-size), the
    // invisible transparent hit box around it grows instead, so it never
    // reads as an oversized button. Desktop keeps its existing small size.
    var isMobile = viewportType === "mobile";
    var boxSize = isMobile ? 40 : 18;
    var fontSize = isMobile ? 20 : 14;
    btn.style.cssText =
      "position:absolute;top:8px;right:8px;width:" + boxSize + "px;height:" + boxSize + "px;" +
      "display:flex;align-items:center;justify-content:center;font-size:" + fontSize + "px;" +
      "cursor:pointer;color:#9CA3AF;background:transparent;border:none;line-height:1;z-index:2;padding:0;";
    btn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      containerEl.style.display = "none";
      markClosed(slotId);
    });
    return btn;
  }

  // Single source of truth for "what viewport is this visitor on right
  // now" — per the plan, no other function in this file calls
  // window.matchMedia() directly; they all call this instead.
  function currentViewportType() {
    return mobileMql.matches ? "mobile" : "desktop";
  }

  // Current implementation detail — a pure client-side filter over the
  // already-fetched list.
  function getSlotsForCurrentViewport(slots) {
    var viewport = currentViewportType();
    return slots.filter(function (slot) {
      return slot.viewport_type === viewport;
    });
  }

  // The single, stable call site every renderer goes through to ask "what
  // should render right now" — one extra layer of indirection beyond
  // getSlotsForCurrentViewport() so a future move to server-side filtering
  // only ever touches THIS function.
  function getRenderableSlots(slots) {
    return getSlotsForCurrentViewport(slots);
  }

  function removeSlotNode(entry) {
    if (!entry) {
      return;
    }
    if (entry.io) {
      entry.io.disconnect();
    }
    if (entry.wrap && entry.wrap.parentNode) {
      entry.wrap.parentNode.removeChild(entry.wrap);
    }
  }

  // Keeps an already-rendered fixed-position slot's on-screen rect in sync
  // with the current window.innerWidth on resize/orientationchange —
  // desktopRenderRect()/mobileRenderRect() are pure functions of the
  // current viewport width, but were previously only ever evaluated once,
  // at mount time, leaving the slot visually stuck at its original
  // position after a resize. Updates the existing wrap element in place —
  // never recreates a DOM node or re-runs scheduleSlot(), so close-button
  // state and dismiss listeners already attached to it are untouched.
  function repositionSlot(slot, entry) {
    if (!entry || !entry.wrap || !hasFixedPosition(slot)) {
      return;
    }
    var rect = effectiveRect(slot);
    entry.wrap.style.left = rect.left + "px";
    entry.wrap.style.top = rect.top + "px";
    entry.wrap.style.width = rect.width + "px";
    entry.wrap.style.height = rect.height + "px";

    var iframe = entry.wrap.querySelector("iframe");
    if (iframe) {
      iframe.width = rect.width;
      iframe.height = rect.height;
      iframe.style.width = rect.width + "px";
      iframe.style.height = rect.height + "px";
    }
  }

  function applyViewportFilter() {
    var matchingSlots = getRenderableSlots(allSlots);
    var matching = {};
    matchingSlots.forEach(function (slot) {
      matching[slot.slot_id] = true;
      if (!renderedSlots[slot.slot_id]) {
        renderedSlots[slot.slot_id] = scheduleSlot(slot);
      } else {
        repositionSlot(slot, renderedSlots[slot.slot_id]);
      }
    });
    Object.keys(renderedSlots).forEach(function (id) {
      if (!matching[id]) {
        removeSlotNode(renderedSlots[id]);
        delete renderedSlots[id];
      }
    });
  }

  function startAdServing(siteKey) {
    fetch(apiOrigin + "/api/widget/" + encodeURIComponent(siteKey))
      .then(function (res) {
        return res.json();
      })
      .then(function (slots) {
        allSlots = Array.isArray(slots) ? slots : [];
        applyViewportFilter();
      })
      .catch(function () {});

    if (mobileMql.addEventListener) {
      mobileMql.addEventListener("change", applyViewportFilter);
    } else if (mobileMql.addListener) {
      mobileMql.addListener(applyViewportFilter); // older Safari
    }
    window.addEventListener("orientationchange", applyViewportFilter);
    // mobileMql's "change" only fires when crossing the mobile/desktop
    // breakpoint, and orientationchange only fires on device rotation —
    // neither fires for an ordinary desktop window resize that stays on
    // the same side of the breakpoint (e.g. 1440px -> 1920px). Without
    // this, repositionSlot() (called from applyViewportFilter()) would
    // never run for that case, leaving already-rendered slots stuck at
    // their mount-time position.
    window.addEventListener("resize", applyViewportFilter);
  }

  // True once a slot has been through the drag-to-select picker (see
  // onMouseUp below) — pos_width/pos_height are only ever both set
  // together with pos_x/pos_y, never independently.
  function hasFixedPosition(slot) {
    return (
      slot.pos_x !== null &&
      slot.pos_x !== undefined &&
      slot.pos_y !== null &&
      slot.pos_y !== undefined &&
      !!slot.pos_width &&
      !!slot.pos_height
    );
  }

  // Real phone viewports vary meaningfully (320-428px wide) around the
  // reference width a mobile slot's coordinates were captured against
  // (slot.picker_viewport_width — per-slot and immutable, never a
  // hardcoded constant, so a future change to the picker's reference size
  // can never silently reinterpret an already-created slot's coordinates).
  function mobileRenderRect(slot) {
    var referenceWidth = slot.picker_viewport_width || 400; // fallback only in case of unexpected null
    var scale = window.innerWidth / referenceWidth;
    var renderWidth = slot.pos_width * scale;
    var renderHeight = slot.pos_height * scale;
    var renderX = slot.pos_x * scale;
    var renderY = slot.pos_y * scale;

    // Horizontal safety — the actual mechanism behind "never past the
    // left/right edge, min 8px margin, no horizontal overflow":
    renderWidth = Math.min(renderWidth, window.innerWidth - 16);
    renderX = Math.max(8, Math.min(renderX, window.innerWidth - renderWidth - 8));

    // Vertical — a light sanity clamp only (never negative), not a
    // reference-height-based recalculation. position:fixed is always
    // relative to the CURRENT viewport regardless of scroll position, so —
    // unlike the horizontal case — there's no fixed "bottom edge of the
    // page" to clamp against; picker_viewport_height is never read here.
    renderY = Math.max(8, renderY);

    return { left: renderX, top: renderY, width: renderWidth, height: renderHeight };
  }

  // Desktop's counterpart to mobileRenderRect() above — same shape, same
  // horizontal safety clamp, scaled against the slot's own immutable
  // picker_viewport_width (1440 for every desktop slot today) instead of a
  // mobile-specific reference. Bug fix: a real desktop viewport wider than
  // 1440px was previously rendering the slot at its raw, un-scaled capture
  // coordinates, which drifts it left of where it was actually picked as
  // the page grows wider — this scales it the same way mobile already was.
  function desktopRenderRect(slot) {
    var referenceWidth = slot.picker_viewport_width || 1440; // fallback only in case of unexpected null
    var scale = window.innerWidth / referenceWidth;
    var renderWidth = slot.pos_width * scale;
    var renderHeight = slot.pos_height * scale;
    var renderX = slot.pos_x * scale;
    var renderY = slot.pos_y * scale;

    // Horizontal safety — the actual mechanism behind "never past the
    // left/right edge, min 8px margin, no horizontal overflow":
    renderWidth = Math.min(renderWidth, window.innerWidth - 16);
    renderX = Math.max(8, Math.min(renderX, window.innerWidth - renderWidth - 8));

    // Vertical — a light sanity clamp only (never negative), not a
    // reference-height-based recalculation, same reasoning as mobile above.
    renderY = Math.max(8, renderY);

    return { left: renderX, top: renderY, width: renderWidth, height: renderHeight };
  }

  // Resolves the on-screen rect a fixed-position slot should render at —
  // both desktop and mobile route through their own scale-factor formula
  // above, each keyed off the slot's own immutable picker_viewport_width. A
  // slot without a fixed position (legacy dom_selector-based) just keeps
  // its plain width/height.
  function effectiveRect(slot) {
    if (!hasFixedPosition(slot)) {
      return { left: null, top: null, width: slot.width, height: slot.height };
    }
    if (slot.viewport_type === "mobile") {
      return mobileRenderRect(slot);
    }
    return desktopRenderRect(slot);
  }

  function scheduleSlot(slot) {
    if (isClosedRecently(slot.slot_id)) {
      return null;
    }

    var entry = { wrap: null, io: null };

    // Drawn-area slots render at a fixed viewport position, independent of
    // any page element — nothing to look up or wait to scroll into view.
    if (hasFixedPosition(slot)) {
      entry.wrap = renderAd(document.body, slot);
      return entry;
    }

    // Fallback for any slot picked before drag-to-select existed — still
    // positioned via its CSS selector, same as always.
    var target;
    try {
      target = document.querySelector(slot.dom_selector);
    } catch (err) {
      return entry;
    }
    if (!target) {
      return entry;
    }

    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (intersectionEntry) {
          if (intersectionEntry.isIntersecting) {
            io.unobserve(target);
            entry.wrap = renderAd(target, slot);
          }
        });
      });
      io.observe(target);
      entry.io = io;
    } else {
      entry.wrap = renderAd(target, slot);
    }

    return entry;
  }

  function renderAd(target, slot) {
    if (slot.kind === "placeholder") {
      return renderPlaceholder(target, slot);
    }

    clickDestinations[slot.slot_id] = slot.click_tracking_url;
    ensureClickListener();

    var rect = effectiveRect(slot);
    var w = rect.width;
    var h = rect.height;

    var wrap = document.createElement("div");
    wrap.style.cssText = hasFixedPosition(slot)
      ? "position:fixed;left:" +
        rect.left +
        "px;top:" +
        rect.top +
        "px;width:" +
        w +
        "px;height:" +
        h +
        "px;max-width:calc(100vw - 16px);z-index:999997;"
      : "position:relative;display:inline-block;width:" + w + "px;height:" + h + "px;";

    var iframe = document.createElement("iframe");
    iframe.width = w;
    iframe.height = h;
    iframe.setAttribute("scrolling", "no");
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
    iframe.style.cssText = "border:0;display:block;width:" + w + "px;height:" + h + "px;";
    iframe.srcdoc =
      "<style>body{margin:0}img{display:block;width:100%;height:100%;cursor:pointer}</style>" +
      '<img src="' +
      escapeAttr(slot.creative_url) +
      '" onclick="parent.postMessage({vybridgeClick:\'' +
      slot.slot_id +
      "'},'*')\">";
    wrap.appendChild(iframe);
    wrap.appendChild(createSlotBadge());
    wrap.appendChild(createCloseButton(slot.slot_id, wrap, slot.viewport_type));
    target.appendChild(wrap);
    return wrap;
  }

  // Small, unobtrusive attribution link — lives inside the slot itself
  // (bottom-right corner of the placeholder box or, for a real ad, the
  // relative-positioned wrapper around the creative iframe) rather than
  // fixed to the page, so it never floats over unrelated site content.
  function createSlotBadge() {
    var badge = document.createElement("a");
    badge.href = "https://vybridge.com";
    badge.target = "_blank";
    badge.rel = "noopener";
    badge.style.cssText =
      "position:absolute;bottom:4px;right:6px;font-size:9px;color:#9CA3AF;" +
      "text-decoration:none;opacity:0.7;";
    badge.textContent = "⚡ Ads by Vybridge";
    return badge;
  }

  // Shown in an active slot with nothing booked yet — our own trusted
  // content (not an advertiser's), so a plain styled block instead of the
  // sandboxed iframe renderAd() uses for real creatives.
  function renderPlaceholder(target, slot) {
    var rect = effectiveRect(slot);
    var w = rect.width;
    var h = rect.height;
    var box = document.createElement("div");
    box.style.cssText =
      (hasFixedPosition(slot)
        ? "position:fixed;left:" +
          rect.left +
          "px;top:" +
          rect.top +
          "px;max-width:calc(100vw - 16px);z-index:999997;"
        : "position:relative;") +
      "box-sizing:border-box;display:flex;flex-direction:column;align-items:center;" +
      "justify-content:center;gap:6px;width:" +
      w +
      "px;height:" +
      h +
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

    box.appendChild(createSlotBadge());
    box.appendChild(createCloseButton(slot.slot_id, box, slot.viewport_type));
    target.appendChild(box);
    return box;
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
      "#vybridge-picker-drag{position:fixed;border:2px dashed #6366F1;background:rgba(99,102,241,0.1);" +
      "pointer-events:none;z-index:999999;}" +
      "#vybridge-picker-preview{position:fixed;z-index:999998;box-sizing:border-box;" +
      "display:flex;align-items:center;justify-content:center;text-align:center;padding:8px;" +
      "background:rgba(124,58,237,0.15);border:2px solid #7c3aed;border-radius:6px;" +
      "font:600 13px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#4f46e5;" +
      "pointer-events:none;}";
    document.head.appendChild(style);
  }

  // Confirmed-selection box, shown after mouseup — position:fixed with
  // plain viewport coordinates (no scrollX/scrollY), same as the drag
  // rectangle and the final ad render, so it lines up exactly regardless
  // of page scroll position.
  function showAreaPreview(x, y, width, height) {
    removePickPreview();
    previewEl = document.createElement("div");
    previewEl.id = "vybridge-picker-preview";
    previewEl.style.left = x + "px";
    previewEl.style.top = y + "px";
    previewEl.style.width = width + "px";
    previewEl.style.height = height + "px";
    previewEl.textContent = "Your ad will appear here (" + width + "×" + height + ")";
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

  // New flow: framed by /slots/new on the vybridge app. Drag-to-select —
  // no DOM element detection at all, just the rectangle the publisher
  // drew. Nothing is written to the backend from here; the coordinates are
  // relayed to the parent page, which already holds the token and finishes
  // the slot itself once the publisher confirms label/format/price/duration.
  function onMouseDown(event) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();

    dragStart = { x: event.clientX, y: event.clientY };
    dragEl = document.createElement("div");
    dragEl.id = "vybridge-picker-drag";
    dragEl.style.left = dragStart.x + "px";
    dragEl.style.top = dragStart.y + "px";
    dragEl.style.width = "0px";
    dragEl.style.height = "0px";
    document.body.appendChild(dragEl);

    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("mouseup", onMouseUp, true);
  }

  function onMouseMove(event) {
    if (!dragStart || !dragEl) {
      return;
    }
    var x = Math.min(dragStart.x, event.clientX);
    var y = Math.min(dragStart.y, event.clientY);
    var width = Math.abs(event.clientX - dragStart.x);
    var height = Math.abs(event.clientY - dragStart.y);
    dragEl.style.left = x + "px";
    dragEl.style.top = y + "px";
    dragEl.style.width = width + "px";
    dragEl.style.height = height + "px";

    if (embedded) {
      window.parent.postMessage({ vybridgeDragging: true, x: x, y: y, width: width, height: height }, "*");
    }
  }

  function onMouseUp(event) {
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("mouseup", onMouseUp, true);
    if (!dragStart) {
      return;
    }

    var x = Math.min(dragStart.x, event.clientX);
    var y = Math.min(dragStart.y, event.clientY);
    var width = Math.abs(event.clientX - dragStart.x);
    var height = Math.abs(event.clientY - dragStart.y);
    dragStart = null;
    if (dragEl) {
      dragEl.remove();
      dragEl = null;
    }

    // Too small to be a deliberate drag (a stray click or a jitter) —
    // ignore it and keep listening for a real one.
    if (width < 10 || height < 10) {
      return;
    }

    document.removeEventListener("mousedown", onMouseDown, true);
    if (toastEl) {
      toastEl.remove();
      toastEl = null;
    }

    showAreaPreview(x, y, width, height);

    window.parent.postMessage({ vybridgePicked: true, x: x, y: y, width: width, height: height }, "*");
  }

  function onParentMessage(event) {
    if (!event.data || !event.data.vybridgeResetPick) {
      return;
    }
    removePickPreview();
    showToast("Click and drag to draw your ad area");
    document.addEventListener("mousedown", onMouseDown, true);
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
      showToast("Click and drag to draw your ad area");
      document.addEventListener("mousedown", onMouseDown, true);
      return;
    }

    showToast("Click the element where this ad should appear.", { cancel: true });
    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("click", onClickTab, true);
  }
})();
