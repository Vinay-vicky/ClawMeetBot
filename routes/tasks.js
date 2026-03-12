"use strict";
const express = require("express");
const router  = express.Router();
const {
  getPendingTasks, markTaskDone, saveTeamTask,
  getPersonalTasks, donePersonalTask, deletePersonalTask, addPersonalTask,
  searchTasks,
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

// ── Team tasks ─────────────────────────────────────────────────────────────────

// GET /api/tasks — all pending team tasks
router.get("/", apiAuth, async (req, res) => {
  try {
    const tasks = await getPendingTasks();
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tasks/search?q= — search tasks
router.get("/search", apiAuth, async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "q param required" });
  try {
    const tasks = await searchTasks(q);
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks — create a team task
// Body: { person, task, deadline? }
router.post("/", apiAuth, async (req, res) => {
  const { person, task, deadline } = req.body || {};
  if (!task) return res.status(400).json({ error: "task is required" });
  try {
    await saveTeamTask(person || "Team", task, deadline);
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/tasks/:id/done — mark team task done
router.patch("/:id/done", apiAuth, async (req, res) => {
  try {
    await markTaskDone(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Personal tasks ─────────────────────────────────────────────────────────────

// GET /api/tasks/personal/:telegramId — get pending personal tasks
router.get("/personal/:telegramId", apiAuth, async (req, res) => {
  try {
    const tasks = await getPersonalTasks(req.params.telegramId);
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks/personal/:telegramId — add personal task
router.post("/personal/:telegramId", apiAuth, async (req, res) => {
  const { task, deadline } = req.body || {};
  if (!task) return res.status(400).json({ error: "task is required" });
  try {
    await addPersonalTask(req.params.telegramId, task, deadline);
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/tasks/personal/:telegramId/:id/done
router.patch("/personal/:telegramId/:id/done", apiAuth, async (req, res) => {
  try {
    const affected = await donePersonalTask(req.params.id, req.params.telegramId);
    if (!affected) return res.status(404).json({ error: "Task not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tasks/personal/:telegramId/:id
router.delete("/personal/:telegramId/:id", apiAuth, async (req, res) => {
  try {
    const affected = await deletePersonalTask(req.params.id, req.params.telegramId);
    if (!affected) return res.status(404).json({ error: "Task not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
