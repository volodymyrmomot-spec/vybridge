const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const en = fs.readFileSync(path.join(root, "components/footer.en.html"), "utf8");
const uk = fs.readFileSync(path.join(root, "components/footer.uk.html"), "utf8");
const out =
  "window.__VYBRIDGE_FOOTER_TEMPLATES=" +
  JSON.stringify({ en, uk }) +
  ";\n";

fs.writeFileSync(path.join(root, "assets/footer-templates.js"), out);
console.log("Synced assets/footer-templates.js from components/footer.*.html");
