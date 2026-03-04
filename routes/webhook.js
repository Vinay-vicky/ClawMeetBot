const express = require('express');
const router = express.Router();
const telegramService = require('../services/telegramService');
const teamsService = require('../services/teamsService');

// Telegram webhook
router.post('/telegram', async (req, res) => {
  try {
    const update = req.body;
    await telegramService.handleUpdate(update);
    res.sendStatus(200);
  } catch (err) {
    console.error('Telegram webhook error:', err);
    res.sendStatus(500);
  }
});

// Microsoft Teams webhook / activity handler
router.post('/teams', async (req, res) => {
  try {
    const activity = req.body;
    const response = await teamsService.handleActivity(activity);
    res.status(200).json(response);
  } catch (err) {
    console.error('Teams webhook error:', err);
    res.sendStatus(500);
  }
});

module.exports = router;
