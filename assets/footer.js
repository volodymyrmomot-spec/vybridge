(function () {
  "use strict";

  var mount = document.getElementById("vybridge-footer");
  if (!mount) return;

  var script =
    document.currentScript ||
    document.querySelector('script[src*="footer.js"]');
  var scriptSrc = script ? script.getAttribute("src") || "" : "";
  var assetsBase = "assets/";

  if (scriptSrc) {
    var normalized = scriptSrc.replace(/\\/g, "/");
    var lastSlash = normalized.lastIndexOf("/");
    assetsBase = lastSlash >= 0 ? normalized.slice(0, lastSlash + 1) : "assets/";
  }

  var path = window.location.pathname.replace(/\\/g, "/");
  var langOverride = mount.getAttribute("data-lang");
  var htmlLang = (document.documentElement.getAttribute("lang") || "").toLowerCase();
  var lang = "en";

  if (langOverride === "uk" || langOverride === "en") {
    lang = langOverride;
  } else if (path.indexOf("/uk/") !== -1 || htmlLang.indexOf("uk") === 0) {
    lang = "uk";
  }

  var isUk = lang === "uk";
  var isPublic = path.indexOf("/public/") !== -1;
  var isUkPath = path.indexOf("/uk/") !== -1;

  var ctx = {
    lang: lang,
    assets: assetsBase,
    home: isUk
      ? (isUkPath ? "../index.html" : "uk/index.html")
      : isPublic
        ? "../index.html"
        : "index.html",
    public: isUk ? (isUkPath ? "" : "uk/") : isPublic ? "" : "public/",
    uk: isUk ? "" : "uk/",
    components: resolveComponentsBase(assetsBase),
  };

  ctx.LINK_HOME = ctx.home;
  ctx.LINK_HOW_IT_WORKS = isUk
    ? (isUkPath ? "how-it-works.html" : "uk/how-it-works.html")
    : isPublic
      ? "../how-it-works.html"
      : "how-it-works.html";

  ctx.LINK_ADVERTISERS =
    ctx.public + (isUk ? "advertisers.html" : "advertisers.html");
  ctx.LINK_PUBLISHERS =
    ctx.public + (isUk ? "publishers.html" : "publishers.html");
  ctx.LINK_PRICING = ctx.public + (isUk ? "pricing.html" : "pricing.html");
  ctx.LINK_BLOG = ctx.public + (isUk ? "blog.html" : "blog.html");
  ctx.LINK_CONTACT = ctx.public + "contact.html";
  ctx.LINK_FAQ = ctx.public + "faq.html";
  ctx.LINK_HELP = ctx.public + "help-center.html";
  ctx.LINK_TERMS = ctx.public + "terms.html";
  ctx.LINK_PRIVACY = ctx.public + "privacy.html";

  ensureFooterStyles(assetsBase + "footer.css");

  var templates = window.__VYBRIDGE_FOOTER_TEMPLATES;
  if (templates && templates[lang]) {
    renderFooter(templates[lang], ctx);
    return;
  }

  fetch(ctx.components + "footer." + lang + ".html")
    .then(function (response) {
      if (!response.ok) throw new Error("Footer template not found");
      return response.text();
    })
    .then(function (html) {
      renderFooter(html, ctx);
    })
    .catch(function () {
      console.error(
        "[Vybridge Footer] Failed to load footer template. Include assets/footer-templates.js before footer.js."
      );
      renderFallback(ctx);
    });

  function resolveComponentsBase(base) {
    if (base.indexOf("../assets/") === 0) return "../components/";
    if (base === "assets/") return "components/";
    return base.replace(/assets\/$/, "components/");
  }

  function ensureFooterStyles(href) {
    if (document.querySelector('link[href*="footer.css"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  function renderFooter(html, context) {
    mount.className = "footer";
    mount.innerHTML = applyContext(html, context);
    mount.setAttribute("data-footer-lang", context.lang);
    mount.setAttribute("data-footer-ready", "true");
  }

  function applyContext(html, context) {
    return html
      .replace(/\{\{ASSETS\}\}/g, context.assets)
      .replace(/\{\{LINK_HOME\}\}/g, context.LINK_HOME)
      .replace(/\{\{HOME\}\}/g, context.LINK_HOME)
      .replace(/\{\{LINK_HOW_IT_WORKS\}\}/g, context.LINK_HOW_IT_WORKS)
      .replace(/\{\{LINK_ADVERTISERS\}\}/g, context.LINK_ADVERTISERS)
      .replace(/\{\{LINK_PUBLISHERS\}\}/g, context.LINK_PUBLISHERS)
      .replace(/\{\{LINK_PRICING\}\}/g, context.LINK_PRICING)
      .replace(/\{\{LINK_BLOG\}\}/g, context.LINK_BLOG)
      .replace(/\{\{LINK_CONTACT\}\}/g, context.LINK_CONTACT)
      .replace(/\{\{LINK_FAQ\}\}/g, context.LINK_FAQ)
      .replace(/\{\{LINK_HELP\}\}/g, context.LINK_HELP)
      .replace(/\{\{LINK_TERMS\}\}/g, context.LINK_TERMS)
      .replace(/\{\{LINK_PRIVACY\}\}/g, context.LINK_PRIVACY);
  }

  function renderFallback(ctx) {
    var year = new Date().getFullYear();
    var copy =
      ctx.lang === "uk"
        ? "\u00a9 " + year + " Vybridge. \u0423\u0441\u0456 \u043f\u0440\u0430\u0432\u0430 \u0437\u0430\u0445\u0438\u0449\u0435\u043d\u0456."
        : "\u00a9 " + year + " Vybridge. All rights reserved.";
    mount.className = "footer";
    mount.innerHTML =
      '<div class="container"><div class="footer__bottom"><span>' +
      copy +
      "</span></div></div>";
  }
})();
