const prisma = require("./prisma");
const { SITE_CATEGORIES } = require("./sites");

const PLATFORMS = ["instagram", "tiktok", "youtube"];

const PLATFORM_HOST_PATTERNS = {
  instagram: /instagram\.com/i,
  tiktok: /tiktok\.com/i,
  youtube: /(youtube\.com|youtu\.be)/i,
};

// Best-effort display handle, parsed once at creation time — never re-derived
// or trusted for anything beyond showing "@name" next to a channel. Covers
// the common URL shapes (instagram.com/name, tiktok.com/@name,
// youtube.com/@name, youtube.com/c/name, youtube.com/channel/ID) and simply
// returns null for anything else rather than guessing.
function parseChannelHandle(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    return null;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (!segments.length) {
    return null;
  }

  const first = segments[0];
  if (first === "channel" || first === "c") {
    return segments[1] || null;
  }
  const handle = first.startsWith("@") ? first : "@" + first;
  return handle;
}

function validateChannelUrl(platform, url) {
  if (!/^https?:\/\//i.test(url)) {
    return "Must start with http:// or https://";
  }
  if (!PLATFORM_HOST_PATTERNS[platform].test(url)) {
    return "Doesn't look like a " + platform + " URL";
  }
  return null;
}

// Parses the register form's per-platform channel rows. Each of the 3
// platforms is optional on its own, but at least one must be filled in with
// a valid URL — a blogger account with zero channels has nothing to offer
// advertisers.
function validateChannels(rawChannels) {
  const errors = {};
  const channels = [];
  const list = Array.isArray(rawChannels) ? rawChannels : [];

  list.forEach(function (raw, index) {
    const platform = raw && raw.platform ? String(raw.platform).trim().toLowerCase() : "";
    const url = raw && raw.channelUrl ? String(raw.channelUrl).trim() : "";
    const followersRaw = raw && raw.followersCount !== undefined ? raw.followersCount : "";
    const category = raw && raw.contentCategory ? String(raw.contentCategory).trim() : "";
    const priceRaw = raw && raw.pricePerPostEuros !== undefined ? raw.pricePerPostEuros : "";

    // A row where the URL was simply left blank is just "this platform not
    // used" — only rows with something typed in get validated/collected.
    if (!url) {
      return;
    }

    if (!PLATFORMS.includes(platform)) {
      errors["channel" + index] = "Unknown platform";
      return;
    }

    const urlError = validateChannelUrl(platform, url);
    if (urlError) {
      errors["channel" + index + "Url"] = urlError;
      return;
    }

    const followersCount = Number(followersRaw);
    if (!Number.isFinite(followersCount) || followersCount < 0) {
      errors["channel" + index + "Followers"] = "Enter a follower count of 0 or more";
      return;
    }

    if (category && !SITE_CATEGORIES.includes(category)) {
      errors["channel" + index + "Category"] = "Choose a valid category";
      return;
    }

    const priceEuros = Number(priceRaw);
    if (!Number.isFinite(priceEuros) || priceEuros <= 0) {
      errors["channel" + index + "Price"] = "Enter a price greater than 0";
      return;
    }

    channels.push({
      platform: platform,
      channelUrl: url,
      channelHandle: parseChannelHandle(url),
      followersCount: Math.round(followersCount),
      contentCategory: category || null,
      pricePerPostCents: Math.round(priceEuros * 100),
    });
  });

  if (!Object.keys(errors).length && !channels.length) {
    errors.channels = "Add at least one channel (Instagram, TikTok, or YouTube)";
  }

  return { errors: errors, channels: channels };
}

function publicChannel(channel) {
  return {
    id: channel.id,
    platform: channel.platform,
    channelUrl: channel.channelUrl,
    channelHandle: channel.channelHandle,
    followersCount: channel.followersCount,
    contentCategory: channel.contentCategory,
    pricePerPostCents: channel.pricePerPostCents,
  };
}

function getChannelsForUser(userId) {
  return prisma.bloggerChannel.findMany({ where: { userId: userId }, orderBy: { createdAt: "asc" } });
}

module.exports = {
  PLATFORMS: PLATFORMS,
  validateChannels: validateChannels,
  publicChannel: publicChannel,
  getChannelsForUser: getChannelsForUser,
};
