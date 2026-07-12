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

  var pageUrlInput = document.getElementById("pageUrlInput");
  var pageUrlError = document.getElementById("pageUrlError");
  var openPickerBtn = document.getElementById("openPickerBtn");
  var urlHint = document.getElementById("urlHint");
  var desktopOnlyNotice = document.getElementById("desktopOnlyNotice");

  // Drag-to-select needs a real mouse and enough screen to draw a rectangle
  // on — checked once at load, not on resize, since a publisher opening
  // this on a phone isn't expected to rotate their way into a picker.
  var MIN_PICKER_WIDTH = 1024;
  if (window.innerWidth < MIN_PICKER_WIDTH) {
    openPickerBtn.disabled = true;
    urlHint.hidden = true;
    desktopOnlyNotice.hidden = false;
  }

  var frameLoading = document.getElementById("frameLoading");
  var iframe = document.getElementById("pickerIframe");
  var frameWrap = document.getElementById("pickerFrameWrap");

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

  window.addEventListener("resize", applyPickerScale);

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
    slotId: null,
    picked: null, // { x, y, width, height } — the drawn rectangle, in the iframe's fixed 1440x900 viewport pixels
  };
  var readyTimer = null;

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
      body: JSON.stringify({ pageUrl: pageUrl }),
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
        iframe.src = result.body.pickerUrl;

        readyTimer = setTimeout(handleNotDetected, READY_TIMEOUT_MS);
      })
      .catch(function () {
        openPickerBtn.disabled = false;
        pageUrlError.textContent = "Network error. Please try again.";
        pageUrlError.hidden = false;
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
      applyPickerScale();
      return;
    }

    if (data.vybridgePicked) {
      state.picked = {
        x: data.x,
        y: data.y,
        width: data.width,
        height: data.height,
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
            if (result.body.errors.area) {
              confirmFormMessage.textContent = result.body.errors.area;
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
