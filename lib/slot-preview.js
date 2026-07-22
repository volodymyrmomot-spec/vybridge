const puppeteer = require("puppeteer-core");
const prisma = require("./prisma");
const { uploadSlotPreview, deleteImage } = require("./storage");

// Alpine's own apk chromium, not Puppeteer's bundled (glibc-only) download —
// see the Dockerfile comment. Undefined locally (outside the container),
// which just makes puppeteer.launch() throw and this module fail closed
// into previewStatus "failed" — acceptable, since real capture only ever
// needs to work in the deployed container.
function chromiumExecutablePath() {
  return process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
}

const NAV_TIMEOUT_MS = 30000;
// Gives late-loading images/fonts/client-side rendering a moment to settle
// after the network goes idle, rather than screenshotting mid-paint.
const SETTLE_DELAY_MS = 1000;

function wait(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

// Runs INSIDE the Puppeteer page (via page.evaluate) — deliberately mirrors
// w.js's own anchorRenderRect()/effectiveRect() branching exactly (anchor-
// relative rect if anchor data resolves, else the raw capture-time rect
// as-is), evaluated against the SAME page snapshot the screenshot pixels
// come from. This is what makes previewPosX/Y/Width/Height agree with the
// screenshot: posX/Y alone can drift from what anchor-relative live
// rendering actually shows (the anchor's box moves as the page changes
// between Picker selection time and this capture), and for a no-anchor
// fixed-position slot there's no better static answer than its scrollY=0
// rect anyway — same rect posX/Y already holds. No horizontal viewport-
// edge clamp here (unlike the live version): this runs at exactly
// pickerViewportWidth, the reference the rect is meant to describe, not a
// real, variable visitor viewport.
function resolveFinalRect(anchorSelector, anchorRelX, anchorRelY, anchorRelWidth, anchorRelHeight, posX, posY, posWidth, posHeight) {
  /* eslint-disable no-undef */
  if (anchorSelector && anchorRelWidth != null) {
    let anchorEl;
    try {
      anchorEl = document.querySelector(anchorSelector);
    } catch (err) {
      anchorEl = null;
    }
    if (anchorEl) {
      const anchorRect = anchorEl.getBoundingClientRect();
      if (anchorRect.width && anchorRect.height) {
        return {
          left: anchorRect.left + window.scrollX + anchorRelX * anchorRect.width,
          top: anchorRect.top + window.scrollY + anchorRelY * anchorRect.height,
          width: anchorRelWidth * anchorRect.width,
          height: anchorRelHeight * anchorRect.height,
        };
      }
    }
  }
  return { left: posX, top: posY, width: posWidth, height: posHeight };
  /* eslint-enable no-undef */
}

// Fire-and-forget capture pipeline for one slot's Marketplace preview
// screenshot. Deliberately a single plain async function with no internal
// queueing/retry of its own — callers (finalizeSlot, the regenerate-preview
// endpoint) call it unawaited and let it update the Slot row whenever it
// finishes; a future retry-capable queue can wrap or replace this call
// without any change to its signature, the Slot schema, or the Marketplace UI.
async function capturePreview(slotId) {
  let browser;
  try {
    const slot = await prisma.slot.findUnique({ where: { id: slotId } });
    if (!slot) {
      return;
    }
    if (!slot.pageUrl) {
      await prisma.slot.update({ where: { id: slotId }, data: { previewStatus: "failed" } });
      console.error("[slot-preview] Slot " + slotId + " has no pageUrl on file — cannot capture a preview");
      return;
    }

    const width = slot.pickerViewportWidth || 1440;
    const height = slot.pickerViewportHeight || 900;

    browser = await puppeteer.launch({
      executablePath: chromiumExecutablePath(),
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: width, height: height });

    // Blocks our own widget script from ever loading during this one
    // navigation, so the capture shows clean underlying page content with
    // no Vybridge-rendered box/text baked into the pixels — w.js itself is
    // untouched, it's simply never fetched for this request. The
    // Marketplace draws its own highlight over the image via CSS instead.
    await page.setRequestInterception(true);
    page.on("request", function (req) {
      let pathname = "";
      try {
        pathname = new URL(req.url()).pathname;
      } catch (err) {
        // Not a parseable absolute URL — let it through unmodified.
      }
      if (pathname === "/w.js") {
        req.abort();
        return;
      }
      req.continue();
    });

    await page.goto(slot.pageUrl, { waitUntil: "networkidle0", timeout: NAV_TIMEOUT_MS });
    await wait(SETTLE_DELAY_MS);

    const buffer = await page.screenshot({ fullPage: true, type: "png" });

    // Same page, same snapshot as the screenshot above — see
    // resolveFinalRect()'s own comment for why this can't just reuse
    // posX/Y/Width/Height directly.
    const finalRect = await page.evaluate(
      resolveFinalRect,
      slot.anchorRelWidth != null ? slot.domSelector : null,
      slot.anchorRelX,
      slot.anchorRelY,
      slot.anchorRelWidth,
      slot.anchorRelHeight,
      slot.posX,
      slot.posY,
      slot.posWidth,
      slot.posHeight
    );

    const previousPublicId = slot.previewImagePublicId;
    const uploaded = await uploadSlotPreview({ buffer: buffer, mimeType: "image/png" });

    await prisma.slot.update({
      where: { id: slotId },
      data: {
        previewImageUrl: uploaded.secureUrl,
        previewImagePublicId: uploaded.publicId,
        previewStatus: "ready",
        previewPosX: Math.round(finalRect.left),
        previewPosY: Math.round(finalRect.top),
        previewPosWidth: Math.round(finalRect.width),
        previewPosHeight: Math.round(finalRect.height),
      },
    });

    // Best-effort — a regenerated preview leaves the prior Cloudinary asset
    // orphaned otherwise. Never allowed to affect the status already saved
    // above.
    if (previousPublicId && previousPublicId !== uploaded.publicId) {
      deleteImage(previousPublicId).catch(function (err) {
        console.error("[slot-preview] Failed to clean up previous preview image for slot " + slotId + ":", err.message);
      });
    }
  } catch (err) {
    // .message only — never the full error/stack, which for a Cloudinary or
    // navigation failure can otherwise carry internal URLs/config detail.
    console.error("[slot-preview] Capture failed for slot " + slotId + ":", err.message);
    try {
      await prisma.slot.update({ where: { id: slotId }, data: { previewStatus: "failed" } });
    } catch (updateErr) {
      console.error("[slot-preview] Failed to record failure status for slot " + slotId + ":", updateErr.message);
    }
  } finally {
    if (browser) {
      await browser.close().catch(function () {});
    }
  }
}

module.exports = {
  capturePreview: capturePreview,
};
