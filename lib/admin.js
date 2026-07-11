const prisma = require("./prisma");
const { formatMoney } = require("./currency");
const { deleteUserAndData } = require("./profile");

const PAGE_SIZE = 20;

// Deals actually settled — this is the one status set both GMV and total
// platform-fee-earned filter on, since "earned" means money that actually
// moved, not just escrowed-in-flight.
const SETTLED_STATUSES = ["completed", "payout_released"];
const ACTIVE_NOW_STATUSES = ["live", "pending_approval", "blogger_accepted"];

function toPage(value) {
  const page = Number(value);
  return Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
}

async function getOverview() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [usersByRole, dealsByStatus, settledAgg, activeDealsCount, newRegistrations, totalUsers, totalDeals] =
    await Promise.all([
      prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
      prisma.deal.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.deal.aggregate({
        where: { status: { in: SETTLED_STATUSES } },
        _sum: { totalChargedCents: true, platformFeeCents: true },
      }),
      prisma.deal.count({ where: { status: { in: ACTIVE_NOW_STATUSES } } }),
      prisma.user.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      prisma.user.count(),
      prisma.deal.count(),
    ]);

  const usersByRoleMap = { advertiser: 0, publisher: 0, blogger: 0 };
  usersByRole.forEach(function (row) {
    usersByRoleMap[row.role] = row._count._all;
  });

  const dealsByStatusMap = {};
  dealsByStatus.forEach(function (row) {
    dealsByStatusMap[row.status] = row._count._all;
  });

  const gmvCents = settledAgg._sum.totalChargedCents || 0;
  const platformFeeCents = settledAgg._sum.platformFeeCents || 0;

  return {
    totalUsers: totalUsers,
    usersByRole: usersByRoleMap,
    totalDeals: totalDeals,
    dealsByStatus: dealsByStatusMap,
    gmvCents: gmvCents,
    gmv: formatMoney(gmvCents),
    platformFeeCents: platformFeeCents,
    platformFee: formatMoney(platformFeeCents),
    activeDealsCount: activeDealsCount,
    newRegistrations7d: newRegistrations,
  };
}

function formatAdminUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    country: user.country,
    createdAt: user.createdAt,
    dealCount: user._count.dealsAsAdvertiser + user._count.dealsAsPublisher,
  };
}

async function getUsers({ search, page }) {
  const currentPage = toPage(page);
  const term = search ? String(search).trim() : "";

  const where = term
    ? {
        OR: [
          { email: { contains: term, mode: "insensitive" } },
          { name: { contains: term, mode: "insensitive" } },
        ],
      }
    : {};

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where: where,
      orderBy: { createdAt: "desc" },
      skip: (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { _count: { select: { dealsAsAdvertiser: true, dealsAsPublisher: true } } },
    }),
    prisma.user.count({ where: where }),
  ]);

  return {
    users: users.map(formatAdminUser),
    page: currentPage,
    pageSize: PAGE_SIZE,
    total: total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

async function deleteUser(userId) {
  return deleteUserAndData(userId);
}

function dealParties(deal) {
  return {
    advertiser: { id: deal.advertiser.id, name: deal.advertiser.name, email: deal.advertiser.email },
    publisher: { id: deal.publisher.id, name: deal.publisher.name, email: deal.publisher.email },
  };
}

function dealSubject(deal) {
  if (deal.slot) {
    return deal.slot.site.domain + " — " + deal.slot.label;
  }
  if (deal.bloggerChannel) {
    return (deal.bloggerChannel.channelHandle || deal.bloggerChannel.platform) + " (" + deal.bloggerChannel.platform + ")";
  }
  if (!deal.bloggerChannelId) {
    return "Deleted slot";
  }
  return "Unknown";
}

function formatAdminDeal(deal) {
  return {
    id: deal.id,
    shortId: deal.id.slice(0, 8),
    // bloggerChannelId (not slotId) is the reliable discriminator — a slot
    // deal's slotId can become null after its slot is deleted (deleteSlot
    // unlinks rather than blocks on non-active deals), but bloggerChannelId
    // is never touched by that.
    type: deal.bloggerChannelId ? "blogger" : "slot",
    subject: dealSubject(deal),
    parties: dealParties(deal),
    priceCents: deal.slotPriceCents,
    platformFeeCents: deal.platformFeeCents,
    totalChargedCents: deal.totalChargedCents,
    total: formatMoney(deal.totalChargedCents, deal.currency),
    status: deal.status,
    statusHistory: deal.statusHistory,
    stripePaymentIntentId: deal.stripePaymentIntentId,
    stripeChargeId: deal.stripeChargeId,
    stripeTransferId: deal.stripeTransferId,
    stripeRefundId: deal.stripeRefundId,
    createdAt: deal.createdAt,
    startsAt: deal.startsAt,
    endsAt: deal.endsAt,
    publishedUrl: deal.publishedUrl,
  };
}

async function getDeals({ status, page }) {
  const currentPage = toPage(page);
  const where = status ? { status: String(status) } : {};

  const [deals, total] = await Promise.all([
    prisma.deal.findMany({
      where: where,
      orderBy: { createdAt: "desc" },
      skip: (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        advertiser: { select: { id: true, name: true, email: true } },
        publisher: { select: { id: true, name: true, email: true } },
        slot: { select: { label: true, site: { select: { domain: true } } } },
        bloggerChannel: { select: { platform: true, channelHandle: true } },
      },
    }),
    prisma.deal.count({ where: where }),
  ]);

  return {
    deals: deals.map(formatAdminDeal),
    page: currentPage,
    pageSize: PAGE_SIZE,
    total: total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

function formatAdminSite(site) {
  return {
    id: site.id,
    domain: site.domain,
    status: site.status,
    publisher: { id: site.publisher.id, name: site.publisher.name, email: site.publisher.email },
    createdAt: site.createdAt,
    slots: site.slots.map(function (slot) {
      return {
        id: slot.id,
        label: slot.label,
        format: slot.format,
        status: slot.status,
        price: formatMoney(slot.priceCents, slot.currency),
        dealCount: slot._count.deals,
      };
    }),
  };
}

async function getSites({ page }) {
  const currentPage = toPage(page);

  const [sites, total] = await Promise.all([
    prisma.site.findMany({
      orderBy: { createdAt: "desc" },
      skip: (currentPage - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        publisher: { select: { id: true, name: true, email: true } },
        slots: {
          orderBy: { createdAt: "desc" },
          include: { _count: { select: { deals: true } } },
        },
      },
    }),
    prisma.site.count(),
  ]);

  return {
    sites: sites.map(formatAdminSite),
    page: currentPage,
    pageSize: PAGE_SIZE,
    total: total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

module.exports = {
  getOverview: getOverview,
  getUsers: getUsers,
  deleteUser: deleteUser,
  getDeals: getDeals,
  getSites: getSites,
};
