"use strict";
const express = require("express");
const router  = express.Router();
const {
  getNotesByMeetingId, addMeetingNote,
  getPersonalNotes, addPersonalNote, deletePersonalNote,
  getTranscriptsByMeeting, saveTranscript,
} = require("../services/dbService");
const logger = require("../utils/logger");

// ── Auth ───────────────────────────────────────────────────────────────────────
function apiAuth(req, res, next) {
  const token = process.env.DASHBOARD_TOKEN;
  if (!token) return next();
  const provided = req.query.token || req.headers["x-dashboard-token"] || req.headers["authorization"]?.replace("Bearer ", "");
  if (provided === token) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

// ── Meeting notes ──────────────────────────────────────────────────────────────

// GET /api/notes/meeting/:meetingId
router.get("/meeting/:meetingId", apiAuth, async (req, res) => {
  try {
    const notes = await getNotesByMeetingId(req.params.meetingId);
    res.json(notes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notes/meeting/:meetingId
// Body: { note, meeting_subject? }
router.post("/meeting/:meetingId", apiAuth, async (req, res) => {
  const { note, meeting_subject } = req.body || {};
  if (!note) return res.status(400).json({ error: "note is required" });
  try {
    await addMeetingNote(req.params.meetingId, meeting_subject || "", note);
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Transcripts ────────────────────────────────────────────────────────────────

// GET /api/notes/transcript/:meetingId
router.get("/transcript/:meetingId", apiAuth, async (req, res) => {
  try {
    const transcripts = await getTranscriptsByMeeting(req.params.meetingId);
    res.json(transcripts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notes/transcript/:meetingId
// Body: { content, visibility? }
router.post("/transcript/:meetingId", apiAuth, async (req, res) => {
  const { content, visibility } = req.body || {};
  if (!content) return res.status(400).json({ error: "content is required" });
  try {
    await saveTranscript(req.params.meetingId, content, visibility || "team");
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Personal notes ─────────────────────────────────────────────────────────────

// GET /api/notes/personal/:telegramId
router.get("/personal/:telegramId", apiAuth, async (req, res) => {
  try {
    const notes = await getPersonalNotes(req.params.telegramId);
    res.json(notes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notes/personal/:telegramId
router.post("/personal/:telegramId", apiAuth, async (req, res) => {
  const { note } = req.body || {};
  if (!note) return res.status(400).json({ error: "note is required" });
  try {
    await addPersonalNote(req.params.telegramId, note);
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/notes/personal/:telegramId/:id
router.delete("/personal/:telegramId/:id", apiAuth, async (req, res) => {
  try {
    const affected = await deletePersonalNote(req.params.id, req.params.telegramId);
    if (!affected) return res.status(404).json({ error: "Note not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
