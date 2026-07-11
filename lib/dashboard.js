const prisma = require("./prisma");
const { formatMoney } = require("./currency");
const { publicSiteInfo } = require("./sites");
const { PENDING_FORMAT } = require("./slots");

// deal.slot is set for the ad-slot vertical, deal.bloggerChannel for the
// blogger vertical (never both) — every advertiser-facing deal formatter
// branches on whichever is present rather than assuming slot deals are the
// only kind an advertiser can have. For a blogger deal, prefer what the
// advertiser is actually promoting (product/website name) over the raw
// channel handle — falls back to the handle for older deals with no
// offerType on file.
function dealSubject(deal) {
  if (deal.slot) {
    return deal.slot.site.domain;
  }
  if (deal.bloggerChannel) {
    return (
      deal.productName ||
      deal.websiteUrl ||
      (deal.bloggerChannel.channelHandle || deal.bloggerChannel.platform) + " (" + deal.bloggerChannel.platform + ")"
    );
  }
  return "Unknown";
}

function formatAdvertiserDeal(deal) {
  return {
    id: deal.id,
    site: dealSubject(deal),
    offerType: deal.offerType,
    price: formatMoney(deal.totalChargedCents, deal.currency),
    status: deal.status,
    publishedUrl: deal.publishedUrl,
    createdAt: deal.createdAt,
  };
}

// deal.slot is null for a historical deal whose slot has since been deleted
// (deleteSlot unlinks rather than blocks on non-active deals) — the deal's
// own price/status/date snapshot is untouched, only the site/label lookup
// falls back to a placeholder.
function formatPublisherDeal(deal) {
  return {
    id: deal.id,
    site: deal.slot ? deal.slot.site.domain : "Deleted slot",
    slotLabel: deal.slot ? deal.slot.label : "Deleted slot",
    price: formatMoney(deal.slotPriceCents, deal.currency),
    status: deal.status,
    createdAt: deal.createdAt,
  };
}

function formatSlot(slot) {
  return {
    id: slot.id,
    label: slot.label,
    format: slot.format,
    price: formatMoney(slot.priceCents, slot.currency),
    durationDays: slot.durationDays,
    status: slot.status,
    domSelector: slot.domSelector,
    posX: slot.posX,
    posY: slot.posY,
    posWidth: slot.posWidth,
    posHeight: slot.posHeight,
    createdAt: slot.createdAt,
  };
}

// Blogger vertical: the same deal shape publisher deals use, plus the
// channel it's for and (once published) the post link — the blogger
// dashboard's Incoming/Active/Completed lists all use this one formatter.
function formatBloggerDeal(deal) {
  return {
    id: deal.id,
    channelPlatform: deal.bloggerChannel.platform,
    channelHandle: deal.bloggerChannel.channelHandle,
    advertiserName: deal.advertiser.name,
    offerType: deal.offerType,
    productName: deal.productName,
    productImageUrl: deal.productImageUrl,
    websiteUrl: deal.websiteUrl,
    adFormat: deal.adFormat,
    contentDescription: deal.contentDescription,
    sendPhysicalProduct: deal.sendPhysicalProduct,
    deliveryInstructions: deal.deliveryInstructions,
    price: formatMoney(deal.slotPriceCents, deal.currency),
    status: deal.status,
    publishedUrl: deal.publishedUrl,
    createdAt: deal.createdAt,
  };
}

async function getAdvertiserDashboard(user) {
  const deals = await prisma.deal.findMany({
    where: { advertiserId: user.id },
    include: { slot: { include: { site: true } }, bloggerChannel: true },
    orderBy: { createdAt: "desc" },
  });

  return {
    role: "advertiser",
    user: { id: user.id, name: user.name, email: user.email },
    deals: deals.map(formatAdvertiserDeal),
  };
}

async function getPublisherDashboard(user) {
  const [site, deals, stripeAccount, slots] = await Promise.all([
    prisma.site.findFirst({ where: { publisherId: user.id }, orderBy: { createdAt: "asc" } }),
    prisma.deal.findMany({
      where: { publisherId: user.id },
      include: { slot: { include: { site: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.stripeAccount.findUnique({ where: { userId: user.id } }),
    prisma.slot.findMany({
      where: { publisherId: user.id, format: { not: PENDING_FORMAT } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const formatted = deals.map(formatPublisherDeal);

  return {
    role: "publisher",
    user: { id: user.id, name: user.name, email: user.email },
    site: site ? publicSiteInfo(site) : null,
    payouts: {
      connected: !!stripeAccount,
      payoutsEnabled: stripeAccount ? stripeAccount.payoutsEnabled : false,
    },
    slots: slots.map(formatSlot),
    pendingApprovals: formatted.filter(function (deal) {
      return deal.status === "pending_approval";
    }),
    deals: formatted,
  };
}

async function getBloggerDashboard(user) {
  const [channels, deals, stripeAccount] = await Promise.all([
    prisma.bloggerChannel.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    prisma.deal.findMany({
      where: { bloggerChannel: { userId: user.id } },
      include: { bloggerChannel: true, advertiser: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.stripeAccount.findUnique({ where: { userId: user.id } }),
  ]);

  const formatted = deals.map(formatBloggerDeal);

  return {
    role: "blogger",
    user: { id: user.id, name: user.name, email: user.email },
    channels: channels.map(function (channel) {
      return {
        id: channel.id,
        platform: channel.platform,
        channelUrl: channel.channelUrl,
        channelHandle: channel.channelHandle,
        followersCount: channel.followersCount,
        contentCategory: channel.contentCategory,
        pricePerPost: formatMoney(channel.pricePerPostCents, "eur"),
      };
    }),
    payouts: {
      connected: !!stripeAccount,
      payoutsEnabled: stripeAccount ? stripeAccount.payoutsEnabled : false,
    },
    incomingOffers: formatted.filter(function (deal) {
      return deal.status === "pending_blogger_approval";
    }),
    activeCampaigns: formatted.filter(function (deal) {
      return deal.status === "blogger_accepted" || deal.status === "blogger_published";
    }),
    completed: formatted.filter(function (deal) {
      return deal.status === "completed" || deal.status === "payout_released";
    }),
  };
}

async function getDashboardData(user) {
  if (user.role === "publisher") {
    return getPublisherDashboard(user);
  }
  if (user.role === "blogger") {
    return getBloggerDashboard(user);
  }
  return getAdvertiserDashboard(user);
}

module.exports = {
  getDashboardData: getDashboardData,
};
