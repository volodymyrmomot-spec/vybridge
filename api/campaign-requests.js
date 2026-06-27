const { handleCampaignRequest } = require("../lib/campaign-requests");

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const result = handleCampaignRequest(req.body || {});
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error("[campaign-requests] Handler error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
};
