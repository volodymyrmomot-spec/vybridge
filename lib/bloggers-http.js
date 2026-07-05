const { getUserFromSession, getSessionIdFromRequest } = require("./sessions");
const { getAvailableBloggers } = require("./bloggers");
const prisma = require("./prisma");

async function handleBloggersRequest(req, res, url, sendJson) {
  if (url.pathname !== "/api/bloggers/available" || req.method !== "GET") {
    return false;
  }

  const user = await getUserFromSession(getSessionIdFromRequest(req));
  if (!user) {
    sendJson(res, 401, { ok: false, error: "Not authenticated" });
    return true;
  }
  if (user.role !== "advertiser") {
    sendJson(res, 403, { ok: false, error: "Only advertiser accounts can browse bloggers" });
    return true;
  }

  const fullUser = await prisma.user.findUnique({ where: { id: user.id } });
  const bloggers = await getAvailableBloggers({ advertiserLifetimeSpendCents: fullUser.lifetimeAdvertiserSpendCents });
  sendJson(res, 200, { ok: true, bloggers: bloggers });
  return true;
}

module.exports = {
  handleBloggersRequest: handleBloggersRequest,
};
