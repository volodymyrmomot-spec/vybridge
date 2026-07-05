const dns = require("dns").promises;
const net = require("net");

const FETCH_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 300 * 1024; // plenty to reach the markers below, which all live in <head> or early <body>

// Checked in order — wordpress first since it's the most common case and
// its markers (wp-content/wp-includes paths) are the most distinctive.
const CMS_MARKERS = [
  {
    cms: "wordpress",
    test: function (html) {
      return /\/wp-content\/|\/wp-includes\//i.test(html) || /<meta[^>]+name=["']generator["'][^>]+content=["']WordPress/i.test(html);
    },
  },
  { cms: "wix", test: function (html) { return /static\.wix\.com|wix-thunderbolt/i.test(html); } },
  { cms: "squarespace", test: function (html) { return /squarespace\.com/i.test(html); } },
  { cms: "shopify", test: function (html) { return /cdn\.shopify\.com/i.test(html); } },
  { cms: "webflow", test: function (html) { return /webflow\.com/i.test(html); } },
  { cms: "tilda", test: function (html) { return /tilda\.ws/i.test(html); } },
];

function detectCmsFromHtml(html) {
  for (const marker of CMS_MARKERS) {
    if (marker.test(html)) {
      return marker.cms;
    }
  }
  return "unknown";
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) {
      return true;
    }
    if (parts[0] === 169 && parts[1] === 254) {
      return true;
    }
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
      return true;
    }
    if (parts[0] === 192 && parts[1] === 168) {
      return true;
    }
    return false;
  }

  const lower = ip.toLowerCase();
  return lower === "::1" || /^fc|^fd/.test(lower) || /^fe80/.test(lower);
}

// This endpoint fetches a URL built from a domain the publisher typed in
// themselves (see extractHostname in lib/users.js) — without this check, an
// authenticated publisher could point it at internal infrastructure (SSRF).
// A hostname that fails to resolve is treated the same as "unsafe": it's
// never fetched, just reported as an undetectable CMS.
async function isPrivateHostname(hostname) {
  if (hostname === "localhost") {
    return true;
  }
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch (err) {
    return true;
  }
  return addresses.some(function (addr) {
    return isPrivateIp(addr.address);
  });
}

async function readBodyCapped(res, maxBytes) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.length;
    chunks.push(value);
    if (total >= maxBytes) {
      reader.cancel().catch(function () {});
      break;
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

// Best-effort: any failure (private/unresolvable host, timeout, network
// error, non-2xx) resolves to "unknown" rather than rejecting — this only
// drives which install-guide tab is preselected, never anything that has to
// be correct or block the dashboard from loading.
async function detectCms(domain) {
  if (await isPrivateHostname(domain)) {
    return "unknown";
  }

  const controller = new AbortController();
  const timeout = setTimeout(function () {
    controller.abort();
  }, FETCH_TIMEOUT_MS);

  try {
    const res = await fetch("https://" + domain + "/", {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "VybridgeCMSDetector/1.0" },
    });

    if (!res.ok || !res.body) {
      return "unknown";
    }

    const html = await readBodyCapped(res, MAX_BODY_BYTES);
    return detectCmsFromHtml(html);
  } catch (err) {
    return "unknown";
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  detectCms: detectCms,
  detectCmsFromHtml: detectCmsFromHtml,
};
