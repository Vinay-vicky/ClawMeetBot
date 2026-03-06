const TelegramBot = require("node-telegram-bot-api");
const { formatMeetingMessage } = require("../utils/formatter");
const { getRecentMeetings, getPendingTasks, markTaskDone } = require("./dbService");
const { getScheduledMeetings } = require("./calendarService");

if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error("❌ ERROR: TELEGRAM_BOT_TOKEN is missing from .env");
  process.exit(1);
}

console.log("✅ Token loaded:", process.env.TELEGRAM_BOT_TOKEN.substring(0, 10) + "...");

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Generate a unique meeting link
function generateMeetLink() {
  const base = process.env.MEET_LINK_BASE_URL || "https://meet.google.com";
  const roomId = Math.random().toString(36).substring(2, 10);
  return `${base}/${roomId}`;
}

// Send a message to the group
function sendToGroup(message) {
  const groupId = process.env.TELEGRAM_GROUP_ID;
  if (!groupId) {
    console.error("❌ TELEGRAM_GROUP_ID not set in .env");
    return;
  }
  bot.sendMessage(groupId, message, { parse_mode: "HTML" })
    .then(() => console.log("✅ Message sent to group"))
    .catch((err) => console.error("❌ Send error:", err.message));
}

// /start — welcome message
bot.onText(/\/start/, (msg) => {
  const name = msg.from.first_name || "there";
  const welcome = [
    `👋 <b>Hey ${name}! Welcome to ClawMeetBot</b>`,
    "",
    "I keep your team in sync with Teams/Outlook meetings — reminders, live join links, AI summaries, and task assignments, all right here in Telegram.",
    "",
    "<b>📅 Meeting Commands</b>",
    "/current — Meeting happening right now",
    "/next — Next scheduled meeting + join link",
    "/today — All meetings scheduled today",
    "/upcoming — Next 5 meetings (7-day view)",
    "/history — Last 5 past meetings",
    "",
    "<b>✅ Task Commands</b>",
    "/tasks — Pending action items from meetings",
    "/done &lt;id&gt; — Mark a task complete (e.g. /done 3)",
    "",
    "<b>🔗 Other</b>",
    "/meet — Generate an instant meeting link",
    "/help — Show this menu again",
    "",
    "<i>Meetings are auto-fetched from Outlook. Reminders sent 1 day, 1 hour, and 10 min before. AI summary + tasks posted after each meeting ends.</i>",
  ].join("\n");
  bot.sendMessage(msg.chat.id, welcome, { parse_mode: "HTML" });
});

// /meet — generate and broadcast a meeting link
bot.onText(/\/meet/, (msg) => {
  const link = generateMeetLink();
  const message = formatMeetingMessage(link);
  sendToGroup(message);
  // Also reply in the chat where command was sent
  bot.sendMessage(msg.chat.id, message, { parse_mode: "HTML" });
});

// /help — show available commands
bot.onText(/\/help/, (msg) => {
  const help = [
    "<b>🤖 ClawMeetBot Commands</b>",
    "",
    "<b>📅 Meetings</b>",
    "/current — Show meeting happening right now",
    "/next — Show next scheduled meeting",
    "/today — Show all meetings today",
    "/upcoming — Show next 5 meetings",
    "/history — Show last 5 past meetings",
    "",
    "<b>✅ Tasks</b>",
    "/tasks — Show pending action items",
    "/done &lt;id&gt; — Mark a task as done (e.g. /done 3)",
    "",
    "<b>🔗 Other</b>",
    "/meet — Generate an instant meeting link",
    "/help — Show this message",
  ].join("\n");
  bot.sendMessage(msg.chat.id, help, { parse_mode: "HTML" });
});

// /history — show recent meetings from DB
bot.onText(/\/history/, (msg) => {
  const meetings = getRecentMeetings(5);
  if (!meetings.length) {
    return bot.sendMessage(msg.chat.id, "No meeting history yet.");
  }
  const lines = meetings.map((m, i) => {
    const date = new Date(m.start_time.replace(/Z?$/, "Z"));
    const dateStr = date.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: process.env.TIMEZONE || "Asia/Kolkata" });
    const timeStr = date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: process.env.TIMEZONE || "Asia/Kolkata" });
    const summary = m.summary ? " ✅" : "";
    return `${i + 1}. <b>${m.subject}</b> — ${dateStr} ${timeStr}${summary}`;
  });
  const message = ["<b>📋 Recent Meetings</b>", "", ...lines, "", "<i>✅ = AI summary available</i>"].join("\n");
  bot.sendMessage(msg.chat.id, message, { parse_mode: "HTML" });
});

// /tasks — show pending action items from DB
bot.onText(/\/tasks/, (msg) => {
  const tasks = getPendingTasks();
  if (!tasks.length) {
    return bot.sendMessage(msg.chat.id, "✅ No pending tasks! All caught up.", { parse_mode: "HTML" });
  }
  const lines = ["<b>📋 Pending Tasks</b>", ""];
  tasks.forEach((t, i) => {
    const deadline = t.deadline ? `\n   ⏳ ${t.deadline}` : "";
    lines.push(`${i + 1}. <b>${t.person}</b> — ${t.task}${deadline}`);
    lines.push(`   <i>from: ${t.meeting_subject}</i>`);
    lines.push("");
  });
  bot.sendMessage(msg.chat.id, lines.join("\n"), { parse_mode: "HTML" });
});

// /done <id> — mark a task as done
bot.onText(/\/done(?:\s+(\d+))?/, (msg, match) => {
  const id = match && match[1] ? parseInt(match[1]) : null;
  if (!id) {
    return bot.sendMessage(msg.chat.id, "Usage: <code>/done &lt;task_id&gt;</code>\nGet IDs with /tasks", { parse_mode: "HTML" });
  }
  markTaskDone(id);
  bot.sendMessage(msg.chat.id, `✅ Task #${id} marked as done!`, { parse_mode: "HTML" });
});

// Helper: format a calendar event into a readable message block
function formatEvent(e, index) {
  const tz = process.env.TIMEZONE || "Asia/Kolkata";
  const start = new Date(e.start.dateTime || e.start.date);
  const end   = new Date(e.end.dateTime   || e.end.date);
  const dateStr = start.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: tz });
  const startTime = start.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  const endTime   = end.toLocaleTimeString("en-IN",   { hour: "2-digit", minute: "2-digit", timeZone: tz });
  const joinUrl = e.onlineMeeting?.joinUrl || e.webLink || null;
  const organizer = e.organizer?.emailAddress?.name || null;

  const lines = [];
  if (index != null) lines.push(`<b>${index}. ${e.subject || "Meeting"}</b>`);
  else lines.push(`<b>${e.subject || "Meeting"}</b>`);
  lines.push(`🗓 ${dateStr}  🕐 ${startTime} – ${endTime}`);
  if (organizer) lines.push(`👤 Organizer: ${organizer}`);
  if (joinUrl) lines.push(`🔗 <a href="${joinUrl}">Join Meeting</a>`);
  return lines.join("\n");
}

// /current — meeting happening right now
bot.onText(/\/current/, async (msg) => {
  try {
    const now = new Date();
    // Fetch meetings that started up to 8 hrs ago and haven't ended yet
    const events = await getScheduledMeetings(-480, 0);
    const ongoing = events.filter((e) => {
      const start = new Date(e.start.dateTime || e.start.date);
      const end   = new Date(e.end.dateTime   || e.end.date);
      return start <= now && end >= now;
    });
    if (!ongoing.length) {
      return bot.sendMessage(msg.chat.id, "📭 No meeting is currently ongoing.", { parse_mode: "HTML" });
    }
    const blocks = ongoing.map((e) => formatEvent(e, null));
    const text = ["<b>🔴 Current Meeting</b>", "", ...blocks].join("\n");
    bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML", disable_web_page_preview: true });
  } catch (err) {
    bot.sendMessage(msg.chat.id, "❌ Could not fetch current meeting: " + err.message);
  }
});

// /next — next upcoming meeting
bot.onText(/\/next/, async (msg) => {
  try {
    const events = await getScheduledMeetings(0, 1500); // next ~25 hrs
    if (!events.length) {
      return bot.sendMessage(msg.chat.id, "📭 No upcoming meetings found.", { parse_mode: "HTML" });
    }
    const next = events[0];
    const tz = process.env.TIMEZONE || "Asia/Kolkata";
    const start = new Date(next.start.dateTime || next.start.date);
    const now = new Date();
    const diffMin = Math.round((start - now) / 60000);
    const inText = diffMin < 60
      ? `in ${diffMin} min`
      : diffMin < 1440
        ? `in ${Math.round(diffMin / 60)} hr ${diffMin % 60} min`
        : `in ${Math.round(diffMin / 1440)} day(s)`;

    const block = formatEvent(next, null);
    const text = [`<b>⏭ Next Meeting</b>  <i>(${inText})</i>`, "", block].join("\n");
    bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML", disable_web_page_preview: true });
  } catch (err) {
    bot.sendMessage(msg.chat.id, "❌ Could not fetch next meeting: " + err.message);
  }
});

// /today — all meetings today
bot.onText(/\/today/, async (msg) => {
  try {
    const tz = process.env.TIMEZONE || "Asia/Kolkata";
    const now = new Date();
    // Minutes until midnight in local timezone
    const todayEnd = new Date(now.toLocaleDateString("en-CA", { timeZone: tz }) + "T23:59:59");
    const msToMidnight = todayEnd - now;
    const minsToMidnight = Math.ceil(msToMidnight / 60000);

    // Also include meetings that started earlier today (from midnight)
    const startOfDay = new Date(now.toLocaleDateString("en-CA", { timeZone: tz }) + "T00:00:00");
    const minsFromMidnight = Math.ceil((now - startOfDay) / 60000);

    const events = await getScheduledMeetings(-minsFromMidnight, minsToMidnight);
    if (!events.length) {
      return bot.sendMessage(msg.chat.id, "📭 No meetings scheduled for today.", { parse_mode: "HTML" });
    }
    const blocks = events.map((e, i) => formatEvent(e, i + 1));
    const dateLabel = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: tz });
    const text = [`<b>📅 Meetings — ${dateLabel}</b>`, "", ...blocks.join("\n\n").split("\n")].join("\n");
    bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML", disable_web_page_preview: true });
  } catch (err) {
    bot.sendMessage(msg.chat.id, "❌ Could not fetch today's meetings: " + err.message);
  }
});

// /upcoming — next 5 meetings within the next 7 days
bot.onText(/\/upcoming/, async (msg) => {
  try {
    const events = await getScheduledMeetings(0, 10080); // next 7 days
    if (!events.length) {
      return bot.sendMessage(msg.chat.id, "📭 No upcoming meetings in the next 7 days.", { parse_mode: "HTML" });
    }
    const top5 = events.slice(0, 5);
    const blocks = top5.map((e, i) => formatEvent(e, i + 1));
    const text = ["<b>📆 Upcoming Meetings</b>", "", blocks.join("\n\n")].join("\n");
    bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML", disable_web_page_preview: true });
  } catch (err) {
    bot.sendMessage(msg.chat.id, "❌ Could not fetch upcoming meetings: " + err.message);
  }
});

// Log all incoming messages
bot.on("message", (msg) => {
  if (msg.text && !msg.text.startsWith("/")) {
    console.log(`[${msg.chat.type}] ${msg.from.username || msg.from.first_name}: ${msg.text}`);
  }
});

bot.on("polling_error", (err) => console.error("❌ Polling error:", err.message));

process.on("unhandledRejection", (reason) => console.error("❌ Unhandled Rejection:", reason));
process.on("uncaughtException", (err) => console.error("❌ Uncaught Exception:", err.message));

module.exports = { bot, sendToGroup, generateMeetLink };
