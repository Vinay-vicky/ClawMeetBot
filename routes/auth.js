"use strict";
const express = require("express");
const router  = express.Router();
const { getUserByTelegramId, getUserByLinkToken, generateLinkToken, upsertUser } = require("../services/dbService");
const logger  = require("../utils/logger");

// ── Simple API auth ────────────────────────────────────────────────────────────
function apiAuth(req, res, next) {
  const token = process.env.DASHBOARD_TOKEN;
  if (!token) return next();
  const provided = req.query.token || req.headers["x-dashboard-token"] || req.headers["authorization"]?.replace("Bearer ", "");
  if (provided === token) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

// GET /auth/user/:telegramId — get user profile
router.get("/user/:telegramId", apiAuth, async (req, res) => {
  try {
    const user = await getUserByTelegramId(req.params.telegramId);
    if (!user) return res.status(404).json({ error: "User not found" });
    const { link_token, ...safe } = user; // don't expose link token
    res.json(safe);
  } catch (err) {
    logger.error("GET /auth/user error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /auth/link-token — generate a link token for a telegram user
// Body: { telegram_id, name?, username? }
router.post("/link-token", apiAuth, async (req, res) => {
  const { telegram_id, name, username } = req.body || {};
  if (!telegram_id) return res.status(400).json({ error: "telegram_id required" });
  try {
    await upsertUser(telegram_id, name, username);
    const token = await generateLinkToken(telegram_id);
    const base  = process.env.RENDER_EXTERNAL_URL || "http://localhost:" + (process.env.PORT || 3000);
    res.json({ link_token: token, link_url: `${base}/dashboard?link=${token}` });
  } catch (err) {
    logger.error("POST /auth/link-token error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /auth/verify/:token — verify a link token and return the user
router.get("/verify/:token", apiAuth, async (req, res) => {
  try {
    const user = await getUserByLinkToken(req.params.token);
    if (!user) return res.status(404).json({ error: "Invalid or expired link token" });
    const { link_token, ...safe } = user;
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
