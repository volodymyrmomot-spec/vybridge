const prisma = require("./prisma");
const { resolveFeeBps, calculatePlatformFeeCents } = require("./fees");

function dedupe(list) {
  const seen = [];
  list.forEach(function (item) {
    if (item && seen.indexOf(item) === -1) {
      seen.push(item);
    }
  });
  return seen;
}

// Catalog for advertisers: one card per blogger, aggregating all of their
// channels — an advertiser picks the specific channel to target inside the
// offer modal (see bloggers/bloggers.js), not from this listing directly.
// Includes the requesting advertiser's real fee tier for the same reason
// lib/slots.js does: what's previewed here is what createBloggerOffer
// actually charges, barring a tier change in between.
async function getAvailableBloggers({ advertiserLifetimeSpendCents }) {
  const [channels, feeBps] = await Promise.all([
    prisma.bloggerChannel.findMany({
      include: { user: true },
      orderBy: { createdAt: "desc" },
    }),
    resolveFeeBps(advertiserLifetimeSpendCents),
  ]);

  const byBlogger = new Map();
  channels.forEach(function (channel) {
    if (!byBlogger.has(channel.userId)) {
      byBlogger.set(channel.userId, { user: channel.user, channels: [] });
    }
    byBlogger.get(channel.userId).channels.push(channel);
  });

  const result = [];
  byBlogger.forEach(function (entry) {
    const channels = entry.channels.map(function (channel) {
      const platformFeeCents = calculatePlatformFeeCents(channel.pricePerPostCents, feeBps);
      return {
        channel_id: channel.id,
        platform: channel.platform,
        channel_handle: channel.channelHandle,
        channel_url: channel.channelUrl,
        followers_count: channel.followersCount,
        category: channel.contentCategory,
        price_per_post_cents: channel.pricePerPostCents,
        open_to_negotiation: channel.openToNegotiation,
        platform_fee_bps: feeBps,
        platform_fee_cents: platformFeeCents,
        total_cents: channel.pricePerPostCents + platformFeeCents,
      };
    });

    // The catalog card shows one price ("From €X") for the whole blogger —
    // tie the "Open to offers" tag to that same cheapest channel rather than
    // to "any channel", so the tag never implies something about a channel
    // whose price isn't even the one displayed.
    const cheapestChannel = channels.reduce(function (min, c) {
      return !min || c.price_per_post_cents < min.price_per_post_cents ? c : min;
    }, null);

    result.push({
      blogger_id: entry.user.id,
      name: entry.user.name,
      channels: channels,
      total_followers: channels.reduce(function (sum, c) {
        return sum + c.followers_count;
      }, 0),
      min_price_cents: cheapestChannel.price_per_post_cents,
      open_to_negotiation: cheapestChannel.open_to_negotiation,
      categories: dedupe(
        channels.map(function (c) {
          return c.category;
        })
      ),
      platforms: dedupe(
        channels.map(function (c) {
          return c.platform;
        })
      ),
    });
  });

  return result;
}

module.exports = {
  getAvailableBloggers: getAvailableBloggers,
};
