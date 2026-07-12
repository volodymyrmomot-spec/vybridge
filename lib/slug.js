// Shared slug generation — Site.slug (from domain), Slot.slug (from label +
// site domain), and Listing.slug (from title) all go through this. Slugs
// are generated once and never regenerated, so an already-shared public URL
// never breaks even if the source domain/label/title changes later.

function slugify(text) {
  return (
    String(text || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "") // strip accents, e.g. "café" -> "cafe"
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 200) || "listing"
  );
}

// isTaken: async (candidate) => boolean. Tries the plain slug first, then
// "-2", "-3", ... until one is free.
async function generateUniqueSlug(base, isTaken) {
  const root = slugify(base);
  let candidate = root;
  let suffix = 2;
  while (await isTaken(candidate)) {
    candidate = root + "-" + suffix;
    suffix++;
  }
  return candidate;
}

module.exports = {
  slugify: slugify,
  generateUniqueSlug: generateUniqueSlug,
};
