const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "campaign-requests.json");

function validateBody(body) {
  const errors = [];
  const fields = {
    name: "Імʼя",
    email: "Email",
    phone: "Телефон",
    advertise: "Що ви хочете рекламувати?",
    budget: "Бюджет",
  };

  if (!body || typeof body !== "object") {
    return ["Invalid request body"];
  }

  Object.keys(fields).forEach(function (key) {
    const value = body[key];
    if (!value || !String(value).trim()) {
      errors.push(fields[key] + " is required");
    }
  });

  const email = String(body.email || "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("Email is invalid");
  }

  return errors;
}

function readRequests() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("[campaign-requests] Could not read data file:", err.message);
    return [];
  }
}

function saveToFile(record) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const requests = readRequests();
  requests.push(record);
  fs.writeFileSync(DATA_FILE, JSON.stringify(requests, null, 2), "utf8");
}

function handleCampaignRequest(body) {
  const errors = validateBody(body);
  if (errors.length) {
    return {
      status: 400,
      body: { ok: false, errors: errors },
    };
  }

  const record = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    name: String(body.name).trim(),
    email: String(body.email).trim(),
    phone: String(body.phone).trim(),
    advertise: String(body.advertise).trim(),
    budget: String(body.budget).trim(),
  };

  console.log("[campaign-requests] New submission:", JSON.stringify(record, null, 2));

  try {
    saveToFile(record);
    console.log("[campaign-requests] Saved to", DATA_FILE);
  } catch (err) {
    console.warn("[campaign-requests] File save failed (logged above):", err.message);
  }

  // TODO: Send email notification to admin (e.g. Resend, SendGrid, SMTP).
  // Example: await sendAdminEmail({ to: process.env.ADMIN_EMAIL, subject: 'New campaign request', ... });

  return {
    status: 201,
    body: { ok: true, id: record.id },
  };
}

module.exports = {
  handleCampaignRequest: handleCampaignRequest,
  validateBody: validateBody,
};
