const { createClient } = require("@libsql/client");
const logger = require("../utils/logger");

// If TURSO_DATABASE_URL is set → use cloud Turso DB (persistent on Render)
// Otherwise → fall back to local file (dev only, wiped on Render redeploy)
const db = createClient(
  process.env.TURSO_DATABASE_URL
    ? {
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
      }
    : { url: "file:meetings.db" }
);

/** Run DDL once on startup */
async function initDb() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS meetings (
      id          TEXT PRIMARY KEY,
      subject     TEXT,
      start_time  TEXT,
      end_time    TEXT,
      join_url    TEXT,
      organizer   TEXT,
      detected_at TEXT DEFAULT (datetime('now')),
      summary     TEXT
    );

    CREATE TABLE IF NOT EXISTS reminders (
      meeting_id TEXT,
      type       TEXT,
      sent_at    TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (meeting_id, type)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id      TEXT,
      meeting_subject TEXT,
      person          TEXT,
      task            TEXT,
      deadline        TEXT,
      done            INTEGER DEFAULT 0,
      created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id      TEXT,
      meeting_subject TEXT,
      note            TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id      TEXT,
      meeting_subject TEXT,
      person          TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      email      TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  logger.info("Database ready" + (process.env.TURSO_DATABASE_URL ? " (Turso cloud)" : " (local SQLite)"));
}

/** Save a Graph API event to DB (ignores duplicates) */
async function saveMeeting(event) {
  const joinUrl =
    (event.onlineMeeting && event.onlineMeeting.joinUrl) ||
    event.webLink ||
    null;
  await db.execute({
    sql: `INSERT OR IGNORE INTO meetings (id, subject, start_time, end_time, join_url, organizer)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      event.id,
      (event.subject || "Meeting").trim(),
      event.start.dateTime || event.start.date,
      event.end.dateTime   || event.end.date,
      joinUrl,
      event.organizer?.emailAddress?.name || null,
    ],
  });
}

/** Check if a reminder type has been sent for a meeting */
async function hasReminderBeenSent(meetingId, type) {
  const res = await db.execute({
    sql: "SELECT 1 FROM reminders WHERE meeting_id = ? AND type = ?",
    args: [meetingId, type],
  });
  return res.rows.length > 0;
}

/** Mark a reminder as sent */
async function markReminderSent(meetingId, type) {
  await db.execute({
    sql: "INSERT OR IGNORE INTO reminders (meeting_id, type) VALUES (?, ?)",
    args: [meetingId, type],
  });
}

/** Save AI-generated summary for a meeting */
async function saveSummary(meetingId, summary) {
  await db.execute({
    sql: "UPDATE meetings SET summary = ? WHERE id = ?",
    args: [summary, meetingId],
  });
}

/** Fetch the last N meetings from DB */
async function getRecentMeetings(limit = 10) {
  const res = await db.execute({
    sql: "SELECT * FROM meetings ORDER BY start_time DESC LIMIT ?",
    args: [limit],
  });
  return res.rows;
}

/** Save an extracted task */
async function saveTask(meetingId, meetingSubject, person, task, deadline) {
  await db.execute({
    sql: `INSERT INTO tasks (meeting_id, meeting_subject, person, task, deadline)
          VALUES (?, ?, ?, ?, ?)`,
    args: [meetingId, meetingSubject, person, task, deadline || ""],
  });
}

/** Get all pending (not done) tasks */
async function getPendingTasks() {
  const res = await db.execute(
    "SELECT * FROM tasks WHERE done = 0 ORDER BY created_at DESC"
  );
  return res.rows;
}

/** Mark a task as done by ID */
async function markTaskDone(id) {
  await db.execute({
    sql: "UPDATE tasks SET done = 1 WHERE id = ?",
    args: [id],
  });
}

/** Search past meetings by keyword in subject */
async function getMeetingByKeyword(keyword) {
  const res = await db.execute({
    sql: "SELECT * FROM meetings WHERE LOWER(subject) LIKE LOWER(?) ORDER BY start_time DESC LIMIT 5",
    args: [`%${keyword}%`],
  });
  return res.rows;
}

/** Get pending tasks assigned to a specific person (case-insensitive) */
async function getTasksByPerson(person) {
  const res = await db.execute({
    sql: "SELECT * FROM tasks WHERE done = 0 AND LOWER(person) LIKE LOWER(?) ORDER BY created_at DESC",
    args: [`%${person}%`],
  });
  return res.rows;
}

/** Meeting count stats */
async function getMeetingStats() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [thisWeek, total] = await Promise.all([
    db.execute({ sql: "SELECT COUNT(*) as count FROM meetings WHERE start_time >= ?", args: [weekAgo] }),
    db.execute("SELECT COUNT(*) as count FROM meetings"),
  ]);
  return { thisWeek: thisWeek.rows[0].count, total: total.rows[0].count };
}

/** Task count stats */
async function getTaskStats() {
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [pending, doneThisMonth, total] = await Promise.all([
    db.execute("SELECT COUNT(*) as count FROM tasks WHERE done = 0"),
    db.execute({ sql: "SELECT COUNT(*) as count FROM tasks WHERE done = 1 AND created_at >= ?", args: [monthAgo] }),
    db.execute("SELECT COUNT(*) as count FROM tasks"),
  ]);
  return {
    pending: pending.rows[0].count,
    doneThisMonth: doneThisMonth.rows[0].count,
    total: total.rows[0].count,
  };
}

/** Add a manual note to a meeting */
async function addMeetingNote(meetingId, meetingSubject, note) {
  await db.execute({
    sql: "INSERT INTO notes (meeting_id, meeting_subject, note) VALUES (?, ?, ?)",
    args: [meetingId, meetingSubject, note],
  });
}

/** Fetch all notes for a meeting */
async function getNotesByMeetingId(meetingId) {
  const res = await db.execute({
    sql: "SELECT * FROM notes WHERE meeting_id = ? ORDER BY created_at DESC",
    args: [meetingId],
  });
  return res.rows;
}

/** Search tasks by keyword (person name or task text) */
async function searchTasks(keyword) {
  const res = await db.execute({
    sql: `SELECT * FROM tasks WHERE done = 0 AND (
            LOWER(task) LIKE LOWER(?) OR LOWER(person) LIKE LOWER(?) OR LOWER(meeting_subject) LIKE LOWER(?)
          ) ORDER BY created_at DESC`,
    args: [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`],
  });
  return res.rows;
}

/** Delete all completed tasks, return count removed */
async function clearDoneTasks() {
  const count = await db.execute("SELECT COUNT(*) as count FROM tasks WHERE done = 1");
  await db.execute("DELETE FROM tasks WHERE done = 1");
  return count.rows[0].count;
}

/** Update task text and/or deadline */
async function editTask(id, newTask, newDeadline) {
  await db.execute({
    sql: "UPDATE tasks SET task = ?, deadline = ? WHERE id = ?",
    args: [newTask, newDeadline || "", id],
  });
}

/** Get a single task by id */
async function getTaskById(id) {
  const res = await db.execute({
    sql: "SELECT * FROM tasks WHERE id = ?",
    args: [id],
  });
  return res.rows[0] || null;
}

/** Get all tasks with a non-empty deadline that are still pending */
async function getTasksWithDeadlines() {
  const res = await db.execute(
    "SELECT * FROM tasks WHERE done = 0 AND deadline != '' ORDER BY created_at ASC"
  );
  return res.rows;
}

/** Save attendance for a meeting */
async function saveAttendance(meetingId, meetingSubject, persons) {
  for (const person of persons) {
    await db.execute({
      sql: "INSERT INTO attendance (meeting_id, meeting_subject, person) VALUES (?, ?, ?)",
      args: [meetingId, meetingSubject, person.trim()],
    });
  }
}

/** Get attendance for a meeting */
async function getAttendance(meetingId) {
  const res = await db.execute({
    sql: "SELECT * FROM attendance WHERE meeting_id = ? ORDER BY created_at ASC",
    args: [meetingId],
  });
  return res.rows;
}

// ── Team Members ──────────────────────────────────────────────────────────────

/** Add a team member (name + email). Silently updates email if name already exists. */
async function addTeamMember(name, email) {
  await db.execute({
    sql: `INSERT INTO team_members (name, email) VALUES (?, ?)
          ON CONFLICT(email) DO UPDATE SET name = excluded.name`,
    args: [name.trim(), email.trim().toLowerCase()],
  });
}

/** Get all team members ordered by name */
async function getAllMembers() {
  const res = await db.execute("SELECT * FROM team_members ORDER BY name ASC");
  return res.rows;
}

/** Remove a team member by name (case-insensitive) */
async function removeMemberByName(name) {
  const res = await db.execute({
    sql: "DELETE FROM team_members WHERE lower(name) = lower(?)",
    args: [name.trim()],
  });
  return res.rowsAffected;
}

/** Advanced analytics for the dashboard and /intelligence command */
async function getMeetingAnalytics() {
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const now = new Date();

  // Meetings per week for the last 4 weeks (start_time is ISO string)
  const weeks = [];
  for (let i = 0; i < 4; i++) {
    const from = new Date(now - (i + 1) * weekMs).toISOString();
    const to   = new Date(now - i * weekMs).toISOString();
    const r = await db.execute({
      sql: "SELECT COUNT(*) as cnt FROM meetings WHERE start_time >= ? AND start_time < ?",
      args: [from, to],
    });
    const label = i === 0 ? "This wk" : i === 1 ? "Last wk" : `${i + 1}w ago`;
    weeks.push({ week: label, count: Number(r.rows[0].cnt) });
  }
  weeks.reverse();

  // Task completion breakdown
  const taskRows = await db.execute("SELECT done, COUNT(*) as cnt FROM tasks GROUP BY done");
  let doneTasks = 0;
  let pendingTasksCount = 0;
  for (const row of taskRows.rows) {
    if (Number(row.done)) doneTasks += Number(row.cnt);
    else pendingTasksCount += Number(row.cnt);
  }

  // Top assignees (across all tasks)
  const assigneeRows = await db.execute(
    "SELECT person, COUNT(*) as cnt FROM tasks GROUP BY person ORDER BY cnt DESC LIMIT 5"
  );

  // Busiest days of week (0=Sun … 6=Sat)
  const dayRows = await db.execute(
    "SELECT strftime('%w', start_time) as dow, COUNT(*) as cnt FROM meetings GROUP BY dow ORDER BY cnt DESC LIMIT 3"
  );
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const totalRow = await db.execute("SELECT COUNT(*) as cnt FROM meetings");

  return {
    weeks,
    doneTasks,
    pendingTasks: pendingTasksCount,
    completionRate:
      doneTasks + pendingTasksCount > 0
        ? Math.round((doneTasks / (doneTasks + pendingTasksCount)) * 100)
        : 0,
    topAssignees: assigneeRows.rows.map((r) => ({ person: r.person, count: Number(r.cnt) })),
    busiestDays: dayRows.rows.map((r) => ({
      day: dayNames[Number(r.dow)] || r.dow,
      count: Number(r.cnt),
    })),
    totalMeetings: Number(totalRow.rows[0].cnt),
  };
}

module.exports = {
  initDb,
  saveMeeting, hasReminderBeenSent, markReminderSent, saveSummary,
  getRecentMeetings, saveTask, getPendingTasks, markTaskDone,
  getMeetingByKeyword, getTasksByPerson,
  getMeetingStats, getTaskStats, addMeetingNote, getNotesByMeetingId,
  searchTasks, clearDoneTasks, editTask, getTaskById, getTasksWithDeadlines,
  saveAttendance, getAttendance,
  addTeamMember, getAllMembers, removeMemberByName,
  getMeetingAnalytics,
};

