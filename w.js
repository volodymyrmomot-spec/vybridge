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

  // Temporary diagnostic instrumentation for the anchor-relative Picker
  // positioning investigation — safe to delete entirely (this flag, every
  // function/branch it gates, and the CSS in injectDebugStyles()) once the
  // investigation is done. Never touches the actual capture/render math.
  // Off for every normal publisher/visitor by default — only enabled when
  // the page URL carries vybridge_debug=1, which new.js only ever adds
  // when /slots/new itself was opened as /slots/new?debug=1. Exists only
  // inside picker mode (every reference below is picker-mode-only code);
  // startAdServing()/the live ad-rendering path never reads this flag, so
  // it can never affect what a real site visitor sees.
  var PICKER_DEBUG = params.get("vybridge_debug") === "1";
  var debugPanelEl = null;
  var reconstructedEl = null;

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

  // Resolves a desktop slot's on-screen rect relative to its captured
  // anchor container's CURRENT box, instead of a scale factor off window
  // width — correct even when the anchor's own box doesn't scale uniformly
  // with window.innerWidth (e.g. a centered max-width container that stops
  // growing past its cap, the actual root cause window-relative scaling
  // can't account for). Returns null if the anchor can't be resolved on
  // this page load (selector drift, anchor removed), so the caller falls
  // back to desktopRenderRect().
  function anchorRenderRect(slot) {
    var anchorEl;
    try {
      anchorEl = document.querySelector(slot.anchor_selector);
    } catch (err) {
      anchorEl = null;
    }
    if (!anchorEl) {
      return null;
    }
    var anchorRect = anchorEl.getBoundingClientRect();
    if (!anchorRect.width || !anchorRect.height) {
      return null;
    }

    var renderWidth = slot.anchor_rel_width * anchorRect.width;
    var renderHeight = slot.anchor_rel_height * anchorRect.height;
    // Document-relative (not viewport-relative) since this renders via
    // position:absolute — adds the current scroll offset once, the
    // standard technique for placing an absolutely-positioned element
    // under a viewport-relative point; the browser then scrolls it with
    // the page natively.
    var renderX = anchorRect.left + window.scrollX + slot.anchor_rel_x * anchorRect.width;
    var renderY = anchorRect.top + window.scrollY + slot.anchor_rel_y * anchorRect.height;

    // Horizontal safety, evaluated against the CURRENT viewport (what's
    // actually visible right now) — same guarantee as the other render
    // formulas: never past the left/right edge, min 8px margin, no
    // horizontal overflow.
    var viewportLeft = window.scrollX;
    var viewportRight = window.scrollX + window.innerWidth;
    renderWidth = Math.min(renderWidth, window.innerWidth - 16);
    renderX = Math.max(viewportLeft + 8, Math.min(renderX, viewportRight - renderWidth - 8));

    return { left: renderX, top: renderY, width: renderWidth, height: renderHeight, positioning: "absolute" };
  }

  // Resolves the on-screen rect a fixed-position slot should render at.
  // Mobile always uses its own scale-factor formula (untouched). Desktop
  // tries the anchor-relative path first when anchor data was captured —
  // falling back to the window-relative scale-factor formula only if no
  // anchor was captured, or the anchor can no longer be found on this page
  // (legacy slots, or a redesigned site). A slot without a fixed position
  // (legacy dom_selector-based) just keeps its plain width/height.
  function effectiveRect(slot) {
    if (!hasFixedPosition(slot)) {
      return { left: null, top: null, width: slot.width, height: slot.height };
    }
    if (slot.viewport_type === "mobile") {
      var mobileRect = mobileRenderRect(slot);
      mobileRect.positioning = "fixed";
      return mobileRect;
    }
    if (slot.anchor_selector && slot.anchor_rel_width != null) {
      var anchorRect = anchorRenderRect(slot);
      if (anchorRect) {
        return anchorRect;
      }
    }
    var desktopRect = desktopRenderRect(slot);
    desktopRect.positioning = "fixed";
    return desktopRect;
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
      ? "position:" +
        (rect.positioning || "fixed") +
        ";left:" +
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
        ? "position:" +
          (rect.positioning || "fixed") +
          ";left:" +
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

  // Walks up from the selection's center point to find the smallest
  // element whose box fully contains the selection — the real, stable DOM
  // container the selection was actually drawn inside. Generic and
  // site-agnostic: for a selection inside a centered, max-width content
  // box, this naturally resolves to that box; for a selection in a
  // full-bleed section's side gutter, it resolves to the section itself.
  //
  // Real-world case that requires one more preference beyond plain
  // containment: a selection that starts a little outside a centered
  // content box (e.g. in the gutter beside it) fails that box's full-
  // containment test and jumps the anchor all the way out to the outer,
  // unconstrained full-bleed section — which then scales with the window
  // just like the old model did, reintroducing the exact drift this
  // feature exists to fix. So: prefer the smallest ancestor that has an
  // explicit CSS max-width AND still contains the selection's CENTER
  // point, even if it doesn't fully enclose the whole rectangle, over a
  // wider ancestor that only qualifies via full containment. An explicit
  // max-width is the concrete, already-confirmed signal that distinguishes
  // a real centered content container from an unconstrained full-bleed
  // section (verified against Stavbahub's own hero/.container markup) —
  // not a numeric threshold, just a boolean CSS property check.
  //
  // Falls back to document.body if nothing qualifies at all, mirroring
  // computeSelector()'s own body boundary above.
  function findAnchorContainer(rect) {
    var centerX = rect.x + rect.width / 2;
    var centerY = rect.y + rect.height / 2;
    var el = document.elementFromPoint(centerX, centerY);
    if (!el) {
      return null;
    }

    var right = rect.x + rect.width;
    var bottom = rect.y + rect.height;
    function fullyContains(box) {
      return box.left <= rect.x && box.top <= rect.y && box.right >= right && box.bottom >= bottom;
    }
    function containsCenter(box) {
      return box.left <= centerX && box.right >= centerX && box.top <= centerY && box.bottom >= centerY;
    }

    var fullyContainingCandidate = null;
    var constrainedCandidate = null;

    var node = el;
    while (node && node.nodeType === 1) {
      var box = node.getBoundingClientRect();
      if (!fullyContainingCandidate && fullyContains(box)) {
        fullyContainingCandidate = node;
      }
      if (!constrainedCandidate && containsCenter(box) && getComputedStyle(node).maxWidth !== "none") {
        constrainedCandidate = node;
      }
      node = node.parentElement;
    }
    return constrainedCandidate || fullyContainingCandidate || document.body;
  }

  // Computes anchor-relative capture data for a just-drawn selection —
  // desktop's replacement for raw viewport pixels alone (responsive pages
  // don't scale uniformly with window width, so a fixed scale factor off
  // window.innerWidth alone can't correctly reposition a slot; anchoring to
  // the real container it was drawn inside can). Wrapped in try/catch so
  // any failure simply yields no anchor data — the parent/finalizeSlot
  // already treat these fields as optional and fall back to the raw
  // x/y/width/height captured alongside them.
  function computeAnchorData(x, y, width, height) {
    try {
      var anchorEl = findAnchorContainer({ x: x, y: y, width: width, height: height });
      if (!anchorEl) {
        return {};
      }
      var anchorRect = anchorEl.getBoundingClientRect();
      if (!anchorRect.width || !anchorRect.height) {
        return {};
      }
      return {
        anchorSelector: computeSelector(anchorEl),
        relativeX: (x - anchorRect.left) / anchorRect.width,
        relativeY: (y - anchorRect.top) / anchorRect.height,
        relativeWidth: width / anchorRect.width,
        relativeHeight: height / anchorRect.height,
      };
    } catch (err) {
      return {};
    }
  }

  // PICKER_DEBUG-only — duplicates just enough of computeAnchorData()'s own
  // lookup (never modifies it) to also expose the anchor's raw rect and a
  // "reconstructed" rectangle computed with the exact same formula
  // anchorRenderRect() uses at live-render time, so the two can be
  // compared visually and numerically inside the Picker itself.
  function computeDebugInfo(x, y, width, height) {
    try {
      var anchorEl = findAnchorContainer({ x: x, y: y, width: width, height: height });
      if (!anchorEl) {
        return null;
      }
      var anchorRect = anchorEl.getBoundingClientRect();
      if (!anchorRect.width || !anchorRect.height) {
        return null;
      }
      var relativeX = (x - anchorRect.left) / anchorRect.width;
      var relativeY = (y - anchorRect.top) / anchorRect.height;
      var relativeWidth = width / anchorRect.width;
      var relativeHeight = height / anchorRect.height;

      var reconstructed = {
        left: anchorRect.left + relativeX * anchorRect.width,
        top: anchorRect.top + relativeY * anchorRect.height,
        width: relativeWidth * anchorRect.width,
        height: relativeHeight * anchorRect.height,
      };

      return {
        anchorSelector: computeSelector(anchorEl),
        anchorRect: { left: anchorRect.left, top: anchorRect.top, width: anchorRect.width, height: anchorRect.height },
        relativeX: relativeX,
        relativeY: relativeY,
        relativeWidth: relativeWidth,
        relativeHeight: relativeHeight,
        reconstructed: reconstructed,
        delta: {
          x: reconstructed.left - x,
          y: reconstructed.top - y,
          width: reconstructed.width - width,
          height: reconstructed.height - height,
        },
      };
    } catch (err) {
      return null;
    }
  }

  function removeReconstructedBox() {
    if (reconstructedEl) {
      reconstructedEl.remove();
      reconstructedEl = null;
    }
  }

  function removeDebugPanel() {
    if (debugPanelEl) {
      debugPanelEl.remove();
      debugPanelEl = null;
    }
    removeReconstructedBox();
  }

  // PICKER_DEBUG-only — live debug panel + "Reconstructed" overlay box,
  // updated on every drag tick and once more at mouseup.
  function updateDebugPanel(x, y, width, height) {
    if (!PICKER_DEBUG) {
      return;
    }
    var info = computeDebugInfo(x, y, width, height);

    if (!debugPanelEl) {
      debugPanelEl = document.createElement("div");
      debugPanelEl.id = "vybridge-picker-debug-panel";
      document.body.appendChild(debugPanelEl);
    }

    var lines = [
      "selectionX: " + x,
      "selectionY: " + y,
      "selectionWidth: " + width,
      "selectionHeight: " + height,
      "iframe viewport: " + window.innerWidth + "x" + window.innerHeight,
      "scrollX/Y: " + window.scrollX + ", " + window.scrollY,
    ];

    if (info) {
      lines.push(
        "anchorSelector: " + info.anchorSelector,
        "anchorRect: " +
          info.anchorRect.left.toFixed(1) +
          ", " +
          info.anchorRect.top.toFixed(1) +
          ", " +
          info.anchorRect.width.toFixed(1) +
          ", " +
          info.anchorRect.height.toFixed(1),
        "anchorRelX/Y: " + info.relativeX.toFixed(4) + ", " + info.relativeY.toFixed(4),
        "anchorRelW/H: " + info.relativeWidth.toFixed(4) + ", " + info.relativeHeight.toFixed(4),
        "deltaX/Y: " + info.delta.x.toFixed(2) + ", " + info.delta.y.toFixed(2),
        "deltaW/H: " + info.delta.width.toFixed(2) + ", " + info.delta.height.toFixed(2)
      );

      if (!reconstructedEl) {
        reconstructedEl = document.createElement("div");
        reconstructedEl.id = "vybridge-picker-reconstructed";
        document.body.appendChild(reconstructedEl);
      }
      reconstructedEl.style.left = info.reconstructed.left + "px";
      reconstructedEl.style.top = info.reconstructed.top + "px";
      reconstructedEl.style.width = info.reconstructed.width + "px";
      reconstructedEl.style.height = info.reconstructed.height + "px";
    } else {
      lines.push("anchor: (none found)");
      removeReconstructedBox();
    }

    debugPanelEl.textContent = lines.join("\n");
  }

  // PICKER_DEBUG-only CSS — separate from injectPickerStyles() so it's
  // trivially removable as one block.
  function injectDebugStyles() {
    var style = document.createElement("style");
    style.textContent =
      "#vybridge-picker-debug-panel{position:fixed;top:8px;right:8px;z-index:2147483647;" +
      "background:rgba(15,23,42,0.92);color:#e2e8f0;padding:10px 12px;border-radius:8px;" +
      "font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;pointer-events:none;" +
      "max-width:360px;}" +
      "#vybridge-picker-reconstructed{position:fixed;border:2px dashed #f97316;" +
      "background:rgba(249,115,22,0.08);pointer-events:none;z-index:999999;}" +
      "#vybridge-picker-reconstructed::after{content:'Reconstructed';position:absolute;top:-18px;left:0;" +
      "font:600 10px/1 -apple-system,BlinkMacSystemFont,sans-serif;color:#f97316;white-space:nowrap;}" +
      "#vybridge-picker-drag::after{content:'Selected';position:absolute;top:-18px;left:0;" +
      "font:600 10px/1 -apple-system,BlinkMacSystemFont,sans-serif;color:#6366F1;white-space:nowrap;}";
    document.head.appendChild(style);
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

    if (PICKER_DEBUG) {
      updateDebugPanel(dragStart.x, dragStart.y, 0, 0);
    }

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

    if (PICKER_DEBUG) {
      updateDebugPanel(x, y, width, height);
    }

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

    var anchorData = computeAnchorData(x, y, width, height);
    var debugInfo = PICKER_DEBUG ? computeDebugInfo(x, y, width, height) : null;
    if (PICKER_DEBUG) {
      updateDebugPanel(x, y, width, height);
    }

    window.parent.postMessage(
      {
        vybridgePicked: true,
        x: x,
        y: y,
        width: width,
        height: height,
        anchorSelector: anchorData.anchorSelector,
        relativeX: anchorData.relativeX,
        relativeY: anchorData.relativeY,
        relativeWidth: anchorData.relativeWidth,
        relativeHeight: anchorData.relativeHeight,
        debug: debugInfo
          ? {
              iframeViewportWidth: window.innerWidth,
              iframeViewportHeight: window.innerHeight,
              scrollX: window.scrollX,
              scrollY: window.scrollY,
              anchorRect: debugInfo.anchorRect,
              reconstructed: debugInfo.reconstructed,
              delta: debugInfo.delta,
            }
          : null,
      },
      "*"
    );
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
    if (PICKER_DEBUG) {
      injectDebugStyles();
    }

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
