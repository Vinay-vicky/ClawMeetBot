require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const express = require("express");
const { sendToGroup, bot } = require("./services/telegramService");
const { startScheduler } = require("./services/schedulerService");
const { getMeetings } = require("./services/teamsService");
const { generateMeetingSummary } = require("./services/aiSummaryService");

const app = express();
app.use(express.json());

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
    console.error(err);
    res.send("Error fetching meetings");
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
    console.error(err);
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
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Meeting history from DB
app.get("/history", (req, res) => {
  const { getRecentMeetings } = require("./services/dbService");
  const limit = parseInt(req.query.limit) || 10;
  res.json(getRecentMeetings(limit));
});

// Pending tasks from DB
app.get("/tasks", (req, res) => {
  const { getPendingTasks } = require("./services/dbService");
  res.json(getPendingTasks());
});

// Mark a task done: POST /done { id: 1 }
app.post("/done", (req, res) => {
  const { markTaskDone } = require("./services/dbService");
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "id required" });
  markTaskDone(id);
  res.json({ ok: true, message: `Task ${id} marked done` });
});

// Telegram webhook endpoint (used on Render instead of polling)
app.post(`/webhook/telegram/${process.env.TELEGRAM_BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Microsoft Teams webhook → forward meeting info to Telegram
app.post("/webhook/teams", (req, res) => {
  try {
    const activity = req.body;
    console.log("Teams activity received:", activity.type);

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
    console.error("Teams webhook error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startScheduler();

  const appUrl = process.env.RENDER_EXTERNAL_URL;
  if (appUrl) {
    // Set Telegram webhook so Render receives updates instead of polling
    const webhookUrl = `${appUrl}/webhook/telegram/${process.env.TELEGRAM_BOT_TOKEN}`;
    bot.setWebHook(webhookUrl)
      .then(() => console.log(`✅ Telegram webhook set: ${webhookUrl}`))
      .catch((err) => console.error("\u274c Failed to set webhook:", err.message));

    // Keep-alive: ping self every 14 minutes so Render free tier doesn't spin down
    const https = require("https");
    setInterval(() => {
      https.get(appUrl, (res) => {
        console.log(`♻️  Keep-alive ping → ${res.statusCode}`);
      }).on("error", (e) => console.error("Keep-alive error:", e.message));
    }, 14 * 60 * 1000);
    console.log(`♻️  Keep-alive enabled → ${appUrl}`);
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`❌ Port ${PORT} busy — trying ${PORT + 1}`);
    app.listen(PORT + 1, () => {
      console.log(`Server running on port ${PORT + 1}`);
      startScheduler();
    });
  }
});