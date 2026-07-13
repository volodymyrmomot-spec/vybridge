(function () {
  "use strict";

  var step1 = document.getElementById("step1");
  var workspace = document.getElementById("workspace");
  var notDetected = document.getElementById("notDetected");
  if (!step1) {
    return;
  }

  // Publisher-only guard. Reuses /api/dashboard (rather than a dedicated
  // check) since it already tells us both "are you logged in" and "are you
  // a publisher" in one call.
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
      if (!result.ok || result.dashboard.role !== "publisher") {
        window.location.href = "/dashboard";
      }
    })
    .catch(function () {});

  var viewportToggle = document.getElementById("viewportToggle");
  var viewportButtons = viewportToggle ? Array.prototype.slice.call(viewportToggle.querySelectorAll(".slot-picker-viewport-btn")) : [];
  var frameLabel = document.getElementById("frameLabel");
  var pageUrlInput = document.getElementById("pageUrlInput");
  var pageUrlError = document.getElementById("pageUrlError");
  var openPickerBtn = document.getElementById("openPickerBtn");
  var urlHint = document.getElementById("urlHint");
  var desktopOnlyNotice = document.getElementById("desktopOnlyNotice");

  // Drag-to-select needs a real mouse and enough screen to draw a rectangle
  // on — checked once at load, not on resize, since a publisher opening
  // this on a phone isn't expected to rotate their way into a picker. This
  // is a different, unrelated gate from MOBILE_MEDIA_QUERY in w.js, which
  // decides which viewport's *live* ads a real visitor sees — this one
  // gates who can use the picker tool at all, regardless of which viewport
  // (desktop or mobile placement) they're picking for.
  var MIN_PICKER_WIDTH = 1024;
  var pickerToolAvailable = window.innerWidth >= MIN_PICKER_WIDTH;
  if (!pickerToolAvailable) {
    openPickerBtn.disabled = true;
    urlHint.hidden = true;
    desktopOnlyNotice.hidden = false;
    viewportButtons.forEach(function (btn) {
      btn.disabled = true;
    });
  }

  var frameLoading = document.getElementById("frameLoading");
  var iframe = document.getElementById("pickerIframe");
  var frameWrap = document.getElementById("pickerFrameWrap");
  var overlapWarning = document.getElementById("overlapWarning");

  // Forces the framed page to render at a real desktop layout — publisher
  // sites are responsive and would otherwise drop to their tablet/mobile
  // breakpoint at the frame's actual (narrow) on-page width. The iframe's
  // TRUE size is always a fixed 1440x900 desktop viewport; only its visual
  // appearance is scaled down via CSS transform to fit the wrapper. This is
  // a pure paint-time effect — event.clientX/clientY captured by w.js
  // running inside the iframe are relative to the iframe's own document
  // viewport, never affected by an ancestor's transform (verified directly
  // in-browser before writing this), so the drag-select coordinates it
  // posts back are already in this same 1440x900 space with no rescale
  // needed here.
  var PICKER_VIEWPORT_WIDTH = 1440;
  var PICKER_VIEWPORT_HEIGHT = 900;
  var PICKER_MIN_VISIBLE_HEIGHT = 500;

  // Mobile mode's reference canvas — a neutral virtual coordinate system,
  // not tied to any specific real device's viewport (see the plan). Unlike
  // desktop, this is never scaled: the iframe renders at genuine 1:1 native
  // size, centered in the workspace column inside a decorative phone frame.
  var MOBILE_VIEWPORT_WIDTH = 400;
  var MOBILE_VIEWPORT_HEIGHT = 800;

  function applyPickerScale() {
    if (!frameWrap || iframe.hidden) {
      return;
    }
    var scale = frameWrap.clientWidth / PICKER_VIEWPORT_WIDTH;
    iframe.style.width = PICKER_VIEWPORT_WIDTH + "px";
    iframe.style.height = PICKER_VIEWPORT_HEIGHT + "px";
    iframe.style.transform = "scale(" + scale + ")";
    frameWrap.style.height = Math.max(PICKER_VIEWPORT_HEIGHT * scale, PICKER_MIN_VISIBLE_HEIGHT) + "px";
  }

  // Mobile's counterpart to applyPickerScale() — deliberately a separate
  // function, never sharing code with it, so desktop's working scale math
  // can never regress from a mobile-motivated change. No transform: true
  // size, centered via the .is-mobile flex wrap in new.css.
  function applyMobilePreview() {
    if (!frameWrap || iframe.hidden) {
      return;
    }
    frameWrap.classList.add("is-mobile");
    iframe.style.width = MOBILE_VIEWPORT_WIDTH + "px";
    iframe.style.height = MOBILE_VIEWPORT_HEIGHT + "px";
    iframe.style.transform = "";
    frameWrap.style.height = "";
  }

  function applyCurrentPreviewScale() {
    if (state.viewportType === "mobile") {
      applyMobilePreview();
    } else {
      applyPickerScale();
    }
    renderOverlays();
  }

  window.addEventListener("resize", applyCurrentPreviewScale);

  var panelWaiting = document.getElementById("panelWaiting");
  var confirmForm = document.getElementById("confirmForm");
  var panelArea = document.getElementById("panelArea");
  var slotLabelInput = document.getElementById("slotLabel");
  var slotFormatSelect = document.getElementById("slotFormat");
  var slotPriceInput = document.getElementById("slotPrice");
  var slotDurationInput = document.getElementById("slotDuration");
  var createSlotBtn = document.getElementById("createSlotBtn");
  var pickDifferentBtn = document.getElementById("pickDifferentBtn");
  var confirmFormMessage = document.getElementById("confirmFormMessage");

  // How long we wait for w.js on the publisher's page to check in before
  // assuming it isn't installed there (or the site refused to be framed —
  // both look identical from here: silence).
  var READY_TIMEOUT_MS = 8000;

  var state = {
    viewportType: null, // "desktop" | "mobile" — chosen on step 1, locked once a session opens
    slotId: null,
    picked: null, // { x, y, width, height } — the drawn rectangle, in the iframe's own fixed viewport pixels
    existingSlots: [], // read-only overlay data for the current viewportType, from GET /api/slots/picker-overlays
  };
  var readyTimer = null;

  // ---------- Step 1: choose viewport ----------

  function selectViewport(viewportType) {
    state.viewportType = viewportType;
    viewportButtons.forEach(function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-viewport") === viewportType);
    });
    if (pickerToolAvailable) {
      pageUrlInput.disabled = false;
      openPickerBtn.disabled = false;
    }
    urlHint.textContent = "We'll open your page and let you click where you want the ad to appear";
    frameLabel.textContent = viewportType === "mobile" ? "Mobile preview · 400 px" : "Desktop preview · 1440 px";
  }

  viewportButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      selectViewport(btn.getAttribute("data-viewport"));
    });
  });

  function clearFieldErrors(form) {
    form.querySelectorAll(".form-field__error").forEach(function (el) {
      el.hidden = true;
      el.textContent = "";
    });
    form.querySelectorAll(".form-field__input").forEach(function (el) {
      el.classList.remove("form-field__input--error");
    });
  }

  function setFieldError(input, message) {
    input.classList.add("form-field__input--error");
    var errorEl = document.getElementById(input.id + "Error");
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.hidden = false;
    }
  }

  // ---------- Step 1: submit the page URL ----------

  function startPickerSession() {
    var pageUrl = pageUrlInput.value.trim();
    pageUrlError.hidden = true;
    pageUrlInput.classList.remove("form-field__input--error");

    if (!state.viewportType) {
      return;
    }

    if (!pageUrl) {
      pageUrlError.textContent = "Enter your page URL";
      pageUrlError.hidden = false;
      pageUrlInput.classList.add("form-field__input--error");
      return;
    }

    openPickerBtn.disabled = true;

    fetch("/api/slots/picker-session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageUrl: pageUrl, viewportType: state.viewportType }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, body: data };
        });
      })
      .then(function (result) {
        openPickerBtn.disabled = false;
        if (!result.ok) {
          pageUrlError.textContent = result.body.error || "Could not open that page. Please try again.";
          pageUrlError.hidden = false;
          pageUrlInput.classList.add("form-field__input--error");
          return;
        }

        state.slotId = result.body.slotId;

        step1.hidden = true;
        workspace.hidden = false;
        frameLoading.hidden = false;
        iframe.hidden = true;
        frameWrap.classList.toggle("is-mobile", state.viewportType === "mobile");
        iframe.src = result.body.pickerUrl;

        readyTimer = setTimeout(handleNotDetected, READY_TIMEOUT_MS);
      })
      .catch(function () {
        openPickerBtn.disabled = false;
        pageUrlError.textContent = "Network error. Please try again.";
        pageUrlError.hidden = false;
      });

    // Fired in parallel, not chained — a visual aid, not a blocker, so it
    // can resolve slightly before or after the iframe starts loading
    // without adding perceived latency to opening the picker.
    fetch("/api/slots/picker-overlays?viewportType=" + encodeURIComponent(state.viewportType), {
      credentials: "same-origin",
    })
      .then(function (res) {
        return res.ok ? res.json() : { ok: false, overlays: [] };
      })
      .then(function (result) {
        state.existingSlots = (result && result.overlays) || [];
        renderOverlays();
      })
      .catch(function () {
        state.existingSlots = [];
      });
  }

  openPickerBtn.addEventListener("click", startPickerSession);
  pageUrlInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      startPickerSession();
    }
  });

  function handleNotDetected() {
    readyTimer = null;
    workspace.hidden = true;
    notDetected.hidden = false;
  }

  // ---------- Existing-placement read-only overlays ----------

  function rectsIntersect(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  // Same scale math applyPickerScale()/applyMobilePreview() already use —
  // desktop shrinks by the wrap's current scale factor, mobile renders 1:1.
  function currentPreviewScale() {
    if (state.viewportType === "mobile") {
      return 1;
    }
    return frameWrap.clientWidth / PICKER_VIEWPORT_WIDTH;
  }

  function clearOverlays() {
    frameWrap.querySelectorAll(".slot-picker-overlay").forEach(function (el) {
      el.parentNode.removeChild(el);
    });
  }

  // Draws each existing placement of the current viewportType as a
  // read-only, pointer-events:none sibling over the iframe — never inside
  // it, so drag-select on the live iframe underneath is completely
  // unaffected. Cleared and fully redrawn on every call (scale/session
  // change) rather than diffed, since there are at most a handful of them.
  function renderOverlays() {
    clearOverlays();
    if (iframe.hidden || !state.existingSlots.length) {
      return;
    }

    var scale = currentPreviewScale();
    var offsetLeft = iframe.offsetLeft;
    var offsetTop = iframe.offsetTop;
    var wrapBounds = { left: 0, top: 0, right: frameWrap.clientWidth, bottom: frameWrap.clientHeight };

    state.existingSlots.forEach(function (slot) {
      if (slot.posX == null || slot.posY == null || slot.posWidth == null || slot.posHeight == null) {
        return;
      }
      var rect = {
        left: offsetLeft + slot.posX * scale,
        top: offsetTop + slot.posY * scale,
        width: slot.posWidth * scale,
        height: slot.posHeight * scale,
      };
      rect.right = rect.left + rect.width;
      rect.bottom = rect.top + rect.height;

      // Safely ignore overlays completely outside the current visible
      // picker viewport instead of attempting to render them.
      if (!rectsIntersect(rect, wrapBounds)) {
        return;
      }

      var el = document.createElement("div");
      el.className = "slot-picker-overlay";
      el.style.left = rect.left + "px";
      el.style.top = rect.top + "px";
      el.style.width = rect.width + "px";
      el.style.height = rect.height + "px";
      el.title = slot.label || "";
      frameWrap.appendChild(el);
    });
  }

  // ---------- Overlap warning while drawing ----------

  function overlapFraction(a, b) {
    var left = Math.max(a.x, b.x);
    var top = Math.max(a.y, b.y);
    var right = Math.min(a.x + a.width, b.x + b.width);
    var bottom = Math.min(a.y + a.height, b.y + b.height);
    var overlapArea = Math.max(0, right - left) * Math.max(0, bottom - top);
    return a.width * a.height > 0 ? overlapArea / (a.width * a.height) : 0;
  }

  // ---------- Step 2/3: messages from the framed page ----------

  window.addEventListener("message", function (event) {
    // Checking event.source (rather than event.origin) is what actually
    // matters here: it's tied to the specific window object, so it can't be
    // spoofed by another frame — and it still works if the publisher's page
    // redirects to a different scheme/subdomain than the URL they typed in,
    // which event.origin wouldn't survive.
    if (event.source !== iframe.contentWindow) {
      return;
    }
    var data = event.data;
    if (!data) {
      return;
    }

    if (data.vybridgePickerReady) {
      if (readyTimer) {
        clearTimeout(readyTimer);
        readyTimer = null;
      }
      frameLoading.hidden = true;
      iframe.hidden = false;
      applyCurrentPreviewScale();
      return;
    }

    if (data.vybridgeDragging) {
      var overlapsExisting = state.existingSlots.some(function (slot) {
        if (slot.posX == null || slot.posY == null || slot.posWidth == null || slot.posHeight == null) {
          return false;
        }
        return (
          overlapFraction(data, { x: slot.posX, y: slot.posY, width: slot.posWidth, height: slot.posHeight }) > 0.5
        );
      });
      overlapWarning.hidden = !overlapsExisting;
      return;
    }

    if (data.vybridgePicked) {
      state.picked = {
        x: data.x,
        y: data.y,
        width: data.width,
        height: data.height,
        // Anchor-relative capture data (desktop only) — best-effort,
        // possibly undefined if w.js couldn't find a containing anchor;
        // finalizeSlot() already treats these as fully optional.
        anchorSelector: data.anchorSelector,
        relativeX: data.relativeX,
        relativeY: data.relativeY,
        relativeWidth: data.relativeWidth,
        relativeHeight: data.relativeHeight,
      };

      panelArea.textContent = "Selected area: " + data.width + " × " + data.height + " px";
      if (!slotLabelInput.value.trim()) {
        slotLabelInput.value = "New ad slot";
      }
      slotFormatSelect.value = "";
      panelWaiting.hidden = true;
      confirmForm.hidden = false;
    }
  });

  // ---------- Step 3: confirm and create ----------

  pickDifferentBtn.addEventListener("click", function () {
    state.picked = null;
    confirmForm.hidden = true;
    panelWaiting.hidden = false;
    confirmFormMessage.hidden = true;
    overlapWarning.hidden = true;
    if (iframe.contentWindow) {
      iframe.contentWindow.postMessage({ vybridgeResetPick: true }, "*");
    }
  });

  confirmForm.addEventListener("submit", function (event) {
    event.preventDefault();
    clearFieldErrors(confirmForm);
    confirmFormMessage.hidden = true;

    if (!state.picked) {
      return;
    }

    var label = slotLabelInput.value.trim();
    var price = parseFloat(slotPriceInput.value);
    var duration = parseInt(slotDurationInput.value, 10);

    var valid = true;
    if (!label) {
      setFieldError(slotLabelInput, "Label is required");
      valid = false;
    }
    if (!(price > 0)) {
      setFieldError(slotPriceInput, "Enter a price greater than 0");
      valid = false;
    }
    if (!(duration >= 1 && duration <= 365)) {
      setFieldError(slotDurationInput, "Duration must be between 1 and 365 days");
      valid = false;
    }
    if (!valid) {
      return;
    }

    createSlotBtn.disabled = true;

    fetch("/api/slots/" + encodeURIComponent(state.slotId) + "/finalize", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: label,
        format: slotFormatSelect.value,
        posX: state.picked.x,
        posY: state.picked.y,
        width: state.picked.width,
        height: state.picked.height,
        priceEuros: price,
        durationDays: duration,
        viewportType: state.viewportType,
        anchorSelector: state.picked.anchorSelector,
        relativeX: state.picked.relativeX,
        relativeY: state.picked.relativeY,
        relativeWidth: state.picked.relativeWidth,
        relativeHeight: state.picked.relativeHeight,
      }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, body: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          createSlotBtn.disabled = false;
          if (result.body.errors) {
            if (result.body.errors.label) {
              setFieldError(slotLabelInput, result.body.errors.label);
            }
            if (result.body.errors.priceEuros) {
              setFieldError(slotPriceInput, result.body.errors.priceEuros);
            }
            if (result.body.errors.durationDays) {
              setFieldError(slotDurationInput, result.body.errors.durationDays);
            }
            if (result.body.errors.area || result.body.errors.viewportType) {
              confirmFormMessage.textContent = result.body.errors.area || result.body.errors.viewportType;
              confirmFormMessage.hidden = false;
            }
          } else {
            confirmFormMessage.textContent = result.body.error || "Could not create slot. Please try again.";
            confirmFormMessage.hidden = false;
          }
          return;
        }
        window.location.href = "/dashboard";
      })
      .catch(function () {
        createSlotBtn.disabled = false;
        confirmFormMessage.textContent = "Network error. Please try again.";
        confirmFormMessage.hidden = false;
      });
  });
})();
