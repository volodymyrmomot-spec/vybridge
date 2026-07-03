const prisma = require("./prisma");
const { PLATFORM_CURRENCY } = require("./currency");

function formatMoney(cents, currency) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency || PLATFORM_CURRENCY).toUpperCase(),
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

function formatSlot(slot) {
  return {
    id: slot.id,
    label: slot.label,
    format: slot.format,
    price: formatMoney(slot.priceCents, slot.currency),
    durationDays: slot.durationDays,
    status: slot.status,
    domSelector: slot.domSelector,
    createdAt: slot.createdAt,
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
  const [site, deals, stripeAccount, slots] = await Promise.all([
    prisma.site.findFirst({ where: { publisherId: user.id }, orderBy: { createdAt: "asc" } }),
    prisma.deal.findMany({
      where: { publisherId: user.id },
      include: { slot: { include: { site: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.stripeAccount.findUnique({ where: { userId: user.id } }),
    prisma.slot.findMany({ where: { publisherId: user.id }, orderBy: { createdAt: "desc" } }),
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
    slots: slots.map(formatSlot),
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
