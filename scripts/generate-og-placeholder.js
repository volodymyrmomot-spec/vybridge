// One-off: renders assets/listing-placeholder.png (1200x630), the generic
// og:image used by any Listing without its own coverImageUrl (all of them
// in Stage 1 — no upload UI exists yet). Built from SVG rather than hand-
// drawn, so it's reproducible and easy to re-run if the design changes.
//
// Usage: node scripts/generate-og-placeholder.js
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const WIDTH = 1200;
const HEIGHT = 630;
const OUTPUT_PATH = path.join(__dirname, "..", "assets", "listing-placeholder.png");

const svg = `
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#6366F1"/>
      <stop offset="50%" stop-color="#818CF8"/>
      <stop offset="100%" stop-color="#67E8F9"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <text x="50%" y="47%" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
        font-size="96" font-weight="800" fill="#ffffff">vybridge</text>
  <text x="50%" y="60%" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
        font-size="28" font-weight="500" fill="#ffffff" opacity="0.9">Advertising marketplace</text>
</svg>
`;

async function main() {
  await sharp(Buffer.from(svg)).png().toFile(OUTPUT_PATH);
  console.log("Wrote " + OUTPUT_PATH);
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
