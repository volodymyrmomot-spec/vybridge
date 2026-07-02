const prisma = require("./prisma");

function formatMoney(cents, currency) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency || "usd").toUpperCase(),
  }).format(cents / 100);
}

function formatAdvertiserDeal(deal) {
  return {
    id: deal.id,
    site: deal.slot.site.domain,
    price: formatMoney(deal.totalChargedCents, deal.currency),
    status: deal.status,
    createdAt: deal.createdAt,
  };
}

function formatPublisherDeal(deal) {
  return {
    id: deal.id,
    site: deal.slot.site.domain,
    slotLabel: deal.slot.label,
    price: formatMoney(deal.slotPriceCents, deal.currency),
    status: deal.status,
    createdAt: deal.createdAt,
  };
}

async function getAdvertiserDashboard(user) {
  const deals = await prisma.deal.findMany({
    where: { advertiserId: user.id },
    include: { slot: { include: { site: true } } },
    orderBy: { createdAt: "desc" },
  });

  return {
    role: "advertiser",
    user: { id: user.id, name: user.name, email: user.email },
    deals: deals.map(formatAdvertiserDeal),
  };
}

async function getPublisherDashboard(user) {
  const [site, deals, stripeAccount] = await Promise.all([
    prisma.site.findFirst({ where: { publisherId: user.id }, orderBy: { createdAt: "asc" } }),
    prisma.deal.findMany({
      where: { publisherId: user.id },
      include: { slot: { include: { site: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.stripeAccount.findUnique({ where: { userId: user.id } }),
  ]);

  const formatted = deals.map(formatPublisherDeal);

  return {
    role: "publisher",
    user: { id: user.id, name: user.name, email: user.email },
    site: site ? { domain: site.domain, siteKey: site.siteKey } : null,
    payouts: {
      connected: !!stripeAccount,
      payoutsEnabled: stripeAccount ? stripeAccount.payoutsEnabled : false,
    },
    pendingApprovals: formatted.filter(function (deal) {
      return deal.status === "pending_approval";
    }),
    deals: formatted,
  };
}

async function getDashboardData(user) {
  if (user.role === "publisher") {
    return getPublisherDashboard(user);
  }
  return getAdvertiserDashboard(user);
}

module.exports = {
  getDashboardData: getDashboardData,
};
