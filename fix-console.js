const fs = require("fs");

function fixFile(filePath, replacements) {
  let c = fs.readFileSync(filePath, "utf8");
  for (const [from, to] of replacements) {
    if (c.includes(from)) {
      c = c.split(from).join(to);
    } else {
      console.warn("NOT FOUND:", from.substring(0, 60));
    }
  }
  fs.writeFileSync(filePath, c, "utf8");
  console.log("Fixed:", filePath);
}

// ── telegramService.js ───────────────────────────────────────────────────────
fixFile("services/telegramService.js", [
  ['console.error("❌ TELEGRAM_GROUP_ID not set in .env");',
   'logger.error("TELEGRAM_GROUP_ID not set in .env");'],
  ['.then(() => console.log("✅ Message sent to group"))',
   '.then(() => logger.info("Message sent to group"))'],
  ['.catch((err) => console.error("❌ Send error:", err.message));',
   '.catch((err) => logger.error("Send error:", err));'],
  ['console.error("❌ createTeamsMeeting error:", err.message);',
   'logger.error("createTeamsMeeting error:", err);'],
  ['console.error("❌ deleteCalendarEvent error:", err.message);',
   'logger.error("deleteCalendarEvent error:", err);'],
  ['bot.on("polling_error", (err) => console.error("❌ Polling error:", err.message));',
   'bot.on("polling_error", (err) => logger.error("Polling error:", err));'],
  ['process.on("unhandledRejection", (reason) => console.error("❌ Unhandled Rejection:", reason));',
   'process.on("unhandledRejection", (reason) => logger.error("Unhandled Rejection:", reason));'],
  ['process.on("uncaughtException", (err) => console.error("❌ Uncaught Exception:", err.message));',
   'process.on("uncaughtException", (err) => logger.error("Uncaught Exception:", err));'],
]);

// ── schedulerService.js ──────────────────────────────────────────────────────
fixFile("services/schedulerService.js", [
  ['const cron = require("node-cron");',
   'const cron = require("node-cron");\nconst logger = require("../utils/logger");'],
  ['console.log(`🔔 1-day reminder sent: ${event.subject}`);',
   'logger.info(`1-day reminder sent: ${event.subject}`);'],
  ['console.log(`⏰ 1-hour reminder sent: ${event.subject}`);',
   'logger.info(`1-hour reminder sent: ${event.subject}`);'],
  ['console.log(`🚨 10-min reminder sent: ${event.subject}`);',
   'logger.info(`10-min reminder sent: ${event.subject}`);'],
  ['processMeetingEnd(event).catch((e) => console.error("Summary error:", e.message));',
   'processMeetingEnd(event).catch((e) => logger.error("Summary error:", e));'],
  ['console.log("✅ Scheduler started — smart reminders active (10min / 1hr / 1day) + daily digest + overdue alerts at 9 AM");',
   'logger.info("Scheduler started — smart reminders active (10min / 1hr / 1day) + daily digest + overdue alerts at 9 AM");'],
]);

// ── calendarService.js ───────────────────────────────────────────────────────
fixFile("services/calendarService.js", [
  ['const { ClientSecretCredential } = require("@azure/identity");',
   'const { ClientSecretCredential } = require("@azure/identity");\nconst logger = require("../utils/logger");'],
  ['console.error("❌ Missing Graph API credentials in .env");',
   'logger.error("Missing Graph API credentials in .env");'],
  ['console.error("❌ Graph API error:", err);',
   'logger.error("Graph API error:", err);'],
]);

// calendarService may have 2x Calendar fetch error lines — replace all
let cal = fs.readFileSync("services/calendarService.js", "utf8");
cal = cal.split('console.error("❌ Calendar fetch error:", err.message);').join('logger.error("Calendar fetch error:", err);');
cal = cal.split('console.log(`🔴 Auto-recording enabled for: ${subject}`)').join('logger.info(`Auto-recording enabled for: ${subject}`)');
cal = cal.split('console.warn("⚠ Could not enable auto-recording:", err.message);').join('logger.warn("Could not enable auto-recording:", err);');
fs.writeFileSync("services/calendarService.js", cal, "utf8");
console.log("Fixed: services/calendarService.js (multi-replace)");

// ── dbService.js ─────────────────────────────────────────────────────────────
fixFile("services/dbService.js", [
  ['const { createClient } = require("@libsql/client");',
   'const { createClient } = require("@libsql/client");\nconst logger = require("../utils/logger");'],
  ['console.log("✅ Database ready" + (process.env.TURSO_DATABASE_URL ? " (Turso cloud)" : " (local SQLite)"));',
   'logger.info("Database ready" + (process.env.TURSO_DATABASE_URL ? " (Turso cloud)" : " (local SQLite)"));'],
]);

// ── summaryService.js ────────────────────────────────────────────────────────
fixFile("services/summaryService.js", [
  ['const { analyzeMeeting, generateMeetingSummary } = require("./aiSummaryService");',
   'const { analyzeMeeting, generateMeetingSummary } = require("./aiSummaryService");\nconst logger = require("../utils/logger");'],
  ['console.error("⚠ Transcript fetch failed:", err.message);',
   'logger.error("Transcript fetch failed:", err);'],
  ['console.log(`📝 Meeting ended: ${subject} — generating summary...`);',
   'logger.info(`Meeting ended: ${subject} — generating summary...`);'],
  [').catch((e) => console.error("❌ Poll send failed:", e.message));',
   ').catch((e) => logger.error("Poll send failed:", e));'],
]);

// ── aiSummaryService.js ──────────────────────────────────────────────────────
fixFile("services/aiSummaryService.js", [
  ['const { GoogleGenerativeAI } = require("@google/generative-ai");',
   'const { GoogleGenerativeAI } = require("@google/generative-ai");\nconst logger = require("../utils/logger");'],
  ['console.error("❌ Gemini analyze error:", err.message);',
   'logger.error("Gemini analyze error:", err);'],
]);

console.log("\nAll done!");
