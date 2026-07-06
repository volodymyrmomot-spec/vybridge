const { getUserFromSession, getSessionIdFromRequest } = require("./sessions");
const { createBloggerOffer, acceptOffer, declineOffer, markPublished, confirmPublished } = require("./blogger-deals");
const { parseMultipart, ALLOWED_CREATIVE_MIME_TYPES } = require("./multipart");

const OFFER_ACTION_ROUTE = /^\/api\/blogger-offers\/([^/]+)\/(accept|decline|publish|confirm)$/;

async function readJsonBody(req, readBody) {
  const raw = await readBody(req);
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

async function handleBloggerDealsRequest(req, res, url, readBody, sendJson) {
  if (url.pathname === "/api/blogger-offers" && req.method === "POST") {
    const user = await getUserFromSession(getSessionIdFromRequest(req));
    if (!user) {
      sendJson(res, 401, { ok: false, error: "Not authenticated" });
      return true;
    }

    const contentType = req.headers["content-type"] || "";
    if (!contentType.startsWith("multipart/form-data")) {
      sendJson(res, 400, { ok: false, error: "Expected multipart/form-data" });
      return true;
    }

    let parsed;
    try {
      parsed = await parseMultipart(req);
    } catch (err) {
      sendJson(res, 400, { ok: false, error: "Could not read the request" });
      return true;
    }

    if (parsed.fileTooLarge) {
      sendJson(res, 400, { ok: false, error: "Product photo must be under 2MB" });
      return true;
    }
    // Product photo is always optional, so only validate its type when one
    // was actually sent.
    if (parsed.file && !ALLOWED_CREATIVE_MIME_TYPES.includes(parsed.file.mimeType)) {
      sendJson(res, 400, { ok: false, error: "Product photo must be JPG, PNG, GIF, or WebP" });
      return true;
    }

    const result = await createBloggerOffer({
      advertiserId: user.id,
      channelId: parsed.fields.channelId,
      offerType: parsed.fields.offerType,
      productName: parsed.fields.productName,
      productImageFile: parsed.file,
      websiteUrl: parsed.fields.websiteUrl,
      adFormat: parsed.fields.adFormat,
      contentDescription: parsed.fields.contentDescription,
      sendPhysicalProduct: parsed.fields.sendPhysicalProduct,
      deliveryInstructions: parsed.fields.deliveryInstructions,
      clickUrl: parsed.fields.clickUrl,
      priceEuros: parsed.fields.priceEuros,
    });
    sendJson(res, result.status, result.body);
    return true;
  }

  const actionMatch = url.pathname.match(OFFER_ACTION_ROUTE);
  if (actionMatch && req.method === "POST") {
    const user = await getUserFromSession(getSessionIdFromRequest(req));
    if (!user) {
      sendJson(res, 401, { ok: false, error: "Not authenticated" });
      return true;
    }

    const dealId = decodeURIComponent(actionMatch[1]);
    const action = actionMatch[2];
    const body = await readJsonBody(req, readBody);

    let result;
    if (action === "accept") {
      result = await acceptOffer({ dealId: dealId, bloggerId: user.id });
    } else if (action === "decline") {
      result = await declineOffer({ dealId: dealId, bloggerId: user.id, reason: body.reason });
    } else if (action === "publish") {
      result = await markPublished({ dealId: dealId, bloggerId: user.id, publishedUrl: body.publishedUrl });
    } else {
      result = await confirmPublished({ dealId: dealId, advertiserId: user.id });
    }

    sendJson(res, result.status, result.body);
    return true;
  }

  return false;
}

module.exports = {
  handleBloggerDealsRequest: handleBloggerDealsRequest,
};
