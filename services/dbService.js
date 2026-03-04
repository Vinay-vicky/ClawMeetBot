const Database = require("better-sqlite3");
const path = require("path");

// Store DB in project root
const db = new Database(path.join(__dirname, "../meetings.db"));

// Initialize tables
db.exec(`
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
`);

/** Save a Graph API event to DB (ignores duplicates) */
function saveMeeting(event) {
  const joinUrl =
    (event.onlineMeeting && event.onlineMeeting.joinUrl) ||
    event.webLink ||
    null;
  db.prepare(`
    INSERT OR IGNORE INTO meetings (id, subject, start_time, end_time, join_url, organizer)
    VALUES (@id, @subject, @start_time, @end_time, @join_url, @organizer)
  `).run({
    id: event.id,
    subject: (event.subject || "Meeting").trim(),
    start_time: event.start.dateTime || event.start.date,
    end_time:   event.end.dateTime   || event.end.date,
    join_url:   joinUrl,
    organizer:  event.organizer?.emailAddress?.name || null,
  });
}

/** Check if a reminder type has been sent for a meeting */
function hasReminderBeenSent(meetingId, type) {
  return !!db.prepare(
    "SELECT 1 FROM reminders WHERE meeting_id = ? AND type = ?"
  ).get(meetingId, type);
}

/** Mark a reminder as sent */
function markReminderSent(meetingId, type) {
  db.prepare(
    "INSERT OR IGNORE INTO reminders (meeting_id, type) VALUES (?, ?)"
  ).run(meetingId, type);
}

/** Save AI-generated summary for a meeting */
function saveSummary(meetingId, summary) {
  db.prepare("UPDATE meetings SET summary = ? WHERE id = ?").run(summary, meetingId);
}

/** Fetch the last N meetings from DB */
function getRecentMeetings(limit = 10) {
  return db.prepare(`
    SELECT * FROM meetings ORDER BY start_time DESC LIMIT ?
  `).all(limit);
}

module.exports = { saveMeeting, hasReminderBeenSent, markReminderSent, saveSummary, getRecentMeetings };
