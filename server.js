require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const express = require("express");
const crypto = require("crypto");
const Sentry = require("@sentry/node");
const rateLimit = require("express-rate-limit");
const logger = require("./utils/logger");
const { sendToGroup, bot } = require("./services/telegramService");
const { startScheduler } = require("./services/schedulerService");
const { getMeetings } = require("./services/teamsService");
const { generateMeetingSummary } = require("./services/aiSummaryService");
const { initDb, getRecentMeetings, getPendingTasks, markTaskDone } = require("./services/dbService");
const dashboardRouter = require("./routes/dashboard");

// ── Sentry (error monitoring) ─────────────────────────────────────────────────
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "production",
    tracesSampleRate: 0.1,
  });
  logger.info("Sentry initialised");
}

const app = express();
app.set("trust proxy", 1); // Render / other reverse proxies forward X-Forwarded-For

// Sentry request handler must be first middleware
if (process.env.SENTRY_DSN) app.use(Sentry.Handlers.requestHandler());

app.use(express.json());

// ── Rate limiting ─────────────────────────────────────────────────────────────
const defaultLimiter = rateLimit({
  windowMs: 60 * 1000,        // 1 minute window
  max: 60,                    // max 60 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, slow down." },
});

// Stricter limit on the Telegram/Teams webhook endpoints
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,                   // Telegram can burst; Teams is low-volume
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/webhook", webhookLimiter);
app.use(defaultLimiter);

// ── Dashboard ─────────────────────────────────────────────────────────────────
app.use("/dashboard", dashboardRouter);

// ── Telegram webhook secret verification ─────────────────────────────────────
function verifyTelegramSecret(req, res, next) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return next(); // skip if not configured yet
  const headerToken = req.headers["x-telegram-bot-api-secret-token"];
  if (!headerToken || headerToken !== secret) {
    logger.warn("Rejected Telegram webhook: invalid secret token");
    return res.sendStatus(403);
  }
  next();
}

// ── Teams webhook HMAC verification ──────────────────────────────────────────
function verifyTeamsWebhook(req, res, next) {
  const secret = process.env.TEAMS_WEBHOOK_SECRET;
  if (!secret) return next(); // skip if not configured
  const authHeader = req.headers["authorization"] || "";
  const buf = Buffer.from(JSON.stringify(req.body));
  const hmac = crypto.createHmac("sha256", Buffer.from(secret, "base64")).update(buf).digest("base64");
  const expected = `HMAC ${hmac}`;
  if (authHeader !== expected) {
    logger.warn("Rejected Teams webhook: invalid HMAC");
    return res.sendStatus(403);
  }
  next();
}

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Test Gemini AI summary with a sample transcript
app.get("/ai-test", async (req, res) => {
  const sampleTranscript = `
    Vignesh explained the ClawMeetBot deployment on Render.
    Ashwin will test the Teams integration by Thursday.
    The team agreed to enable meeting recordings for transcript capture.
    LakshmiPriya will follow up with the client about the new automation.
    Vivin will update the documentation by end of week.
  `;
  const summary = await generateMeetingSummary(sampleTranscript, "Weekly Team Meeting");
  if (!summary) {
    return res.status(500).send("Gemini not configured. Add GEMINI_API_KEY to .env on Render.");
  }
  // Also send to Telegram group
  sendToGroup([
    `🧠 <b>AI Summary Test</b>`,
    ``,
    summary,
  ].join("\n"));
  res.type("text").send(summary);
});

// Health check
app.get("/", (req, res) => {
  res.send("Claw Meet Bot Running 🚀");
});

// Manual test broadcast
app.get("/test", (req, res) => {
  sendToGroup("🚀 ClawMeetBot test broadcast to group!");
  res.send("Sent!");
});

// Fetch meetings from Microsoft Teams/Outlook calendar
app.get("/meetings", async (req, res) => {
  try {
    const meetings = await getMeetings();
    res.json(meetings);
  } catch (err) {
    logger.error("Error fetching meetings:", err);
    res.status(500).send("Error fetching meetings");
  }
});

// Force-check Outlook now and broadcast any meetings in the next 60 minutes
app.get("/force-check", async (req, res) => {
  try {
    const { getUpcomingMeetings } = require("./services/calendarService");
    const meetings = await getUpcomingMeetings(60); // next 60 min window
    if (meetings.length === 0) {
      return res.json({ ok: true, sent: 0, message: "No meetings in the next 60 minutes" });
    }
    for (const event of meetings) {
      const start = new Date(event.start.dateTime || event.start.date);
      const timeStr = start.toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: process.env.TIMEZONE || "Asia/Kolkata",
      });
      const joinUrl =
        (event.onlineMeeting && event.onlineMeeting.joinUrl) ||
        event.webLink ||
        "(no link)";
      const message = [
        `📅 *Upcoming Meeting: ${event.subject || "Meeting"}*`,
        ``,
        `⏰ Time: ${timeStr}`,
        ``,
        `🔗 Join: ${joinUrl}`,
        ``,
        `_Auto-fetched from Outlook Calendar_`,
      ].join("\n");
      sendToGroup(message);
    }
    res.json({ ok: true, sent: meetings.length, meetings: meetings.map((e) => e.subject) });
  } catch (err) {
    logger.error("force-check error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Test broadcast — sends the next meeting from Outlook to the Telegram group regardless of timing
app.get("/test-broadcast", async (req, res) => {
  try {
    const allMeetings = await getMeetings();
    const now = new Date();
    // Find next upcoming event
    const next = allMeetings
      .filter((e) => new Date(e.start.dateTime || e.start.date) > now)
      .sort((a, b) => new Date(a.start.dateTime) - new Date(b.start.dateTime))[0];

    if (!next) return res.json({ ok: false, message: "No upcoming meetings found in calendar" });

    const start = new Date((next.start.dateTime || next.start.date).replace(/Z?$/, "Z"));
    const dateStr = start.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: process.env.TIMEZONE || "Asia/Kolkata" });
    const timeStr = start.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: process.env.TIMEZONE || "Asia/Kolkata" });
    const joinUrl = (next.onlineMeeting && next.onlineMeeting.joinUrl) || next.webLink || "(no link)";

    const message = [
      `📅 <b>Upcoming Meeting: ${(next.subject || "Meeting").trim()}</b>`,
      ``,
      `📆 Date: ${dateStr}`,
      `⏰ Time: ${timeStr}`,
      ``,
      `🔗 Join: ${joinUrl}`,
      ``,
      `<i>Auto-fetched from Outlook Calendar</i>`,
    ].join("\n");

    sendToGroup(message);
    res.json({ ok: true, subject: next.subject, time: timeStr, date: dateStr });
  } catch (err) {
    logger.error("test-broadcast error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Meeting history from DB
app.get("/history", async (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  res.json(await getRecentMeetings(limit));
});

// Pending tasks from DB
app.get("/tasks", async (req, res) => {
  res.json(await getPendingTasks());
});

// Mark a task done: POST /done { id: 1 }
app.post("/done", async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "id required" });
  await markTaskDone(id);
  res.json({ ok: true, message: `Task ${id} marked done` });
});

// Telegram webhook endpoint (used on Render instead of polling)
app.post(`/webhook/telegram/${process.env.TELEGRAM_BOT_TOKEN}`, verifyTelegramSecret, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Microsoft Teams webhook → forward meeting info to Telegram
app.post("/webhook/teams", verifyTeamsWebhook, (req, res) => {
  try {
    const activity = req.body;
    logger.info(`Teams activity received: ${activity.type}`);

    if (activity.type === "message" && activity.text) {
      const text = activity.text.toLowerCase().trim();
      if (
        text.includes("meet.google.com") ||
        text.includes("teams.microsoft.com") ||
        text.includes("zoom.us")
      ) {
        const message = [
          "📣 *Meeting Link from Teams*",
          "",
          activity.text,
          "",
          `_Forwarded at ${new Date().toUTCString()}_`,
        ].join("\n");
        sendToGroup(message);
      }
    }

    res.status(200).json({ status: "ok" });
  } catch (err) {
    logger.error("Teams webhook error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Sentry error handler must be before any other error-handling middleware
if (process.env.SENTRY_DSN) app.use(Sentry.Handlers.errorHandler());

// Generic error handler
app.use((err, req, res, _next) => {
  logger.error("Unhandled request error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Start server
const PORT = process.env.PORT || 3000;

// Initialize DB tables, then start the server
initDb().then(() => {
  const server = app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
    startScheduler();

    // Register bot commands so they appear in the Telegram / menu
    bot.setMyCommands([
      { command: "start",         description: "Welcome and command list" },
      { command: "current",       description: "Meeting happening right now" },
      { command: "next",          description: "Next scheduled meeting + join link" },
      { command: "today",         description: "All meetings today" },
      { command: "upcoming",      description: "Next 5 meetings (7-day view)" },
      { command: "week",          description: "Full week schedule grouped by day" },
      { command: "meet",          description: "Create a Teams meeting" },
      { command: "cancelmeeting", description: "Cancel a scheduled meeting" },
      { command: "addmember",    description: "Save a team member email for meeting invites" },
      { command: "members",      description: "List saved team members" },
      { command: "removemember", description: "Remove a team member" },
      { command: "history",       description: "Last N past meetings (e.g. /history 10)" },
      { command: "summary",       description: "AI summary of a past meeting" },
      { command: "pdf",           description: "Export meeting minutes as PDF" },
      { command: "notes",         description: "View or add notes to a meeting" },
      { command: "tasks",         description: "Pending action items" },
      { command: "addtask",       description: "Manually add a task" },
      { command: "done",          description: "Mark a task done (e.g. /done 3)" },
      { command: "remind",        description: "Tasks for a person or all" },
      { command: "stats",         description: "Meeting and task statistics" },
      { command: "search",        description: "Search tasks by keyword" },
      { command: "cleardone",     description: "Remove all completed tasks" },
      { command: "edittask",      description: "Edit a task text or deadline" },
      { command: "export",        description: "Export all pending tasks as text" },
      { command: "ask",           description: "AI chat with meeting history" },
      { command: "dashboard",      description: "Open the web analytics dashboard" },
      { command: "intelligence",  description: "Advanced meeting analytics" },
      { command: "recordings",    description: "Find a meeting recording" },
      { command: "attendance",    description: "View or record meeting attendance" },
      { command: "mytask",        description: "Add a private personal task" },
      { command: "mytasks",       description: "List your personal tasks (private)" },
      { command: "mydonetask",    description: "Mark a personal task done (/mydonetask #id)" },
      { command: "mydeltask",     description: "Delete a personal task (/mydeltask #id)" },
      { command: "note",          description: "Save a private note" },
      { command: "mynotes",       description: "List your personal notes (private)" },
      { command: "mydelnote",     description: "Delete a personal note (/mydelnote #id)" },
      { command: "cancel",        description: "Abort active wizard" },
      { command: "help",          description: "Show all commands" },
    ])
      .then(() => logger.info("Bot commands registered with Telegram"))
      .catch((e) => logger.error("setMyCommands failed:", e));

    const appUrl = process.env.RENDER_EXTERNAL_URL;
    if (appUrl) {
      // Set Telegram webhook (optionally with a secret token for verification)
      const webhookUrl = `${appUrl}/webhook/telegram/${process.env.TELEGRAM_BOT_TOKEN}`;
      const webhookOptions = process.env.TELEGRAM_WEBHOOK_SECRET
        ? { secret_token: process.env.TELEGRAM_WEBHOOK_SECRET }
        : {};
      bot.setWebHook(webhookUrl, webhookOptions)
        .then(() => logger.info(`Telegram webhook set: ${webhookUrl}`))
        .catch((err) => logger.error("Failed to set webhook:", err));

      // Keep-alive: ping self every 14 minutes so Render free tier doesn't spin down
      const https = require("https");
      setInterval(() => {
        https.get(appUrl, (r) => {
          logger.info(`Keep-alive ping → ${r.statusCode}`);
        }).on("error", (e) => logger.warn(`Keep-alive error: ${e.message}`));
      }, 14 * 60 * 1000);
      logger.info(`Keep-alive enabled → ${appUrl}`);
    }
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      logger.warn(`Port ${PORT} busy — trying ${PORT + 1}`);
      app.listen(PORT + 1, () => {
        logger.info(`Server running on port ${PORT + 1}`);
        startScheduler();
      });
    }
  });
}).catch((err) => {
  logger.error("Failed to initialise database:", err);
  process.exit(1);
});