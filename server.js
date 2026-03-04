require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const express = require("express");
const { sendToGroup, generateMeetLink } = require("./services/telegramService");
const { startScheduler } = require("./services/schedulerService");
const { formatMeetingMessage } = require("./utils/formatter");
const { getMeetings } = require("./services/teamsService");

const app = express();
app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.send("Claw Meet Bot Running 🚀");
});

// Manual test broadcast
app.get("/test", (req, res) => {
  sendToGroup("🚀 ClawMeetBot test broadcast to group!");
  res.send("Sent!");
});

// Manually trigger a meeting link broadcast
app.get("/meet", (req, res) => {
  const link = generateMeetLink();
  const message = formatMeetingMessage(link);
  sendToGroup(message);
  res.json({ ok: true, link });
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