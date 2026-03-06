const TelegramBot = require("node-telegram-bot-api");
const { getRecentMeetings, getPendingTasks, markTaskDone, getMeetingByKeyword, getTasksByPerson,
        saveTask, getMeetingStats, getTaskStats, addMeetingNote, getNotesByMeetingId,
        searchTasks, clearDoneTasks, editTask, getTaskById, saveAttendance, getAttendance } = require("./dbService");
const { getScheduledMeetings, createTeamsMeeting, deleteCalendarEvent } = require("./calendarService");

if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error("❌ ERROR: TELEGRAM_BOT_TOKEN is missing from .env");
  process.exit(1);
}

console.log("✅ Token loaded:", process.env.TELEGRAM_BOT_TOKEN.substring(0, 10) + "...");

// Use polling locally, webhook on Render (avoids 409 conflict with cloud)
const isProduction = !!process.env.RENDER_EXTERNAL_URL;
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, isProduction ? {} : { polling: true });
if (!isProduction) console.log("\uD83D\uDD04 Bot running in polling mode (local dev)");
else console.log("\uD83D\uDD17 Bot running in webhook mode (Render)");

// In-memory state for /meet wizard: chatId -> { step, data }
const meetSessions = new Map();
// In-memory state for /cancelmeeting: chatId -> { events: [...] }
const cancelSessions = new Map();

// ── Wizard parse helpers ─────────────────────────────────────────
function parseDateStr(input, tz) {
  const lower = input.trim().toLowerCase();
  const toYMD = (d) => d.toLocaleDateString("en-CA", { timeZone: tz });
  const today = new Date();
  if (lower === "today") return toYMD(today);
  if (lower === "tomorrow") return toYMD(new Date(today.getTime() + 86400000));
  const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  let m = lower.match(/^(\d{1,2})\s*([a-z]{3})/);
  if (m && months[m[2]]) {
    const yr = today.getFullYear();
    return `${yr}-${String(months[m[2]]).padStart(2,"0")}-${String(parseInt(m[1])).padStart(2,"0")}`;
  }
  m = lower.match(/^([a-z]{3})\s*(\d{1,2})/);
  if (m && months[m[1]]) {
    const yr = today.getFullYear();
    return `${yr}-${String(months[m[1]]).padStart(2,"0")}-${String(parseInt(m[2])).padStart(2,"0")}`;
  }
  m = lower.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const yr = today.getFullYear();
    return `${yr}-${String(parseInt(m[2])).padStart(2,"0")}-${String(parseInt(m[1])).padStart(2,"0")}`;
  }
  return null;
}

function parseTimeStr(input) {
  const s = input.trim().toLowerCase().replace(/\s/g, "");
  let m = s.match(/^(\d{1,2}):(\d{2})(am|pm)?$/);
  if (m) {
    let h = parseInt(m[1]); const min = m[2]; const mer = m[3];
    if (mer === "pm" && h < 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
    return `${String(h).padStart(2,"0")}:${min}`;
  }
  m = s.match(/^(\d{1,2})(am|pm)$/);
  if (m) {
    let h = parseInt(m[1]); const mer = m[2];
    if (mer === "pm" && h < 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
    return `${String(h).padStart(2,"0")}:00`;
  }
  return null;
}

function parseDurationMins(input) {
  const s = input.trim().toLowerCase();
  let m = s.match(/(\d+\.?\d*)\s*h/);
  if (m) return Math.round(parseFloat(m[1]) * 60);
  m = s.match(/(\d+)\s*m/);
  if (m) return parseInt(m[1]);
  m = s.match(/^(\d+)$/);
  if (m) return parseInt(m[1]);
  return null;
}

// Try to parse a single-line /meet command: "Title date time duration"
// Scans tokens right-to-left: duration → time → date → rest=title
function parseInlineMeet(text, tz) {
  const tokens = text.trim().split(/\s+/);
  if (tokens.length < 3) return null;

  let endIdx = tokens.length;

  // duration from last token
  const d = parseDurationMins(tokens[endIdx - 1]);
  if (!d || d < 5) return null;
  endIdx--;

  if (endIdx < 2) return null;

  // time from next-to-last
  const t = parseTimeStr(tokens[endIdx - 1]);
  if (!t) return null;
  endIdx--;

  if (endIdx < 1) return null;

  // date: try single token, then two tokens
  let date = parseDateStr(tokens[endIdx - 1], tz);
  if (date) {
    endIdx--;
  } else if (endIdx >= 2) {
    date = parseDateStr(tokens.slice(endIdx - 2, endIdx).join(" "), tz);
    if (date) endIdx -= 2;
  }
  if (!date) return null;

  const title = tokens.slice(0, endIdx).join(" ").trim();
  if (!title) return null;

  return { title, dateStr: date, timeStr: t, durationMins: d };
}
// ─────────────────────────────────────────────────────────────────

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
    "/week — Full week schedule grouped by day",
    "/upcoming — Next 5 meetings (7-day view)",
    "/history — Last 5 past meetings",
    "",
    "<b>✅ Task Commands</b>",
    "/tasks — Pending action items (tap to complete)",
    "/addtask — Manually add a task",
    "/done &lt;id&gt; — Mark a task complete (e.g. /done 3)",
    "/remind &lt;name&gt; — Tasks for a person (or 'all')",
    "/stats — Meeting and task statistics",
    "",
    "<b>🗓 Create / Cancel Meetings</b>",
    "/meet — Guided Teams meeting creator",
    "/meet Title date time duration — One-line shortcut",
    "/cancelmeeting — Cancel a scheduled Teams meeting",
    "/cancel — Abort any active wizard",
    "",
    "<b>📝 AI Meeting Minutes & Notes</b>",
    "/summary &lt;name&gt; — Re-show AI summary of a past meeting",
    "/notes &lt;name&gt; — View meeting notes",
    "/notes &lt;name&gt; | &lt;text&gt; — Add a note",
    "/remind &lt;name&gt; — Tasks for a person (or 'all')",
    "",
    "/help — Show this menu again",
    "",
    "<i>Meetings are auto-fetched from Outlook. Reminders sent 1 day, 1 hour, and 10 min before. AI summary + tasks posted after each meeting ends.</i>",
  ].join("\n");
  bot.sendMessage(msg.chat.id, welcome, { parse_mode: "HTML" });
});

// /cancel — abort any active wizard
bot.onText(/\/cancel/, (msg) => {
  const hadMeet = meetSessions.delete(msg.chat.id);
  const hadCancel = cancelSessions.delete(msg.chat.id);
  if (hadMeet || hadCancel) {
    bot.sendMessage(msg.chat.id, "❌ Operation cancelled.", { parse_mode: "HTML" });
  }
});

// /meet — inline shortcut or guided wizard
bot.onText(/\/meet(?:\s+([\s\S]+))?/, (msg, match) => {
  const tz = process.env.TIMEZONE || "Asia/Kolkata";
  const inlineText = match && match[1] ? match[1].trim() : "";

  if (inlineText) {
    const parsed = parseInlineMeet(inlineText, tz);
    if (parsed) {
      // All fields found — jump straight to attendees step
      meetSessions.set(msg.chat.id, { step: "attendees", data: parsed });
      const { title, dateStr, timeStr, durationMins } = parsed;
      const hrs = Math.floor(durationMins / 60);
      const mins = durationMins % 60;
      const hrMin = hrs > 0 && mins > 0 ? `${hrs}h ${mins}m` : hrs > 0 ? `${hrs}h` : `${mins}m`;
      return bot.sendMessage(
        msg.chat.id,
        `✅ Got it!\n\n📌 <b>${title}</b>\n📅 ${dateStr}  🕐 ${timeStr}  ⏱ ${hrMin}\n\n👥 <b>Attendees?</b> Enter emails comma-separated, or type <code>skip</code>:`,
        { parse_mode: "HTML" }
      );
    }
  }

  // Start guided wizard
  meetSessions.set(msg.chat.id, { step: "title", data: {} });
  bot.sendMessage(
    msg.chat.id,
    "🗓 <b>Create a Teams Meeting</b>\n\n<b>Step 1 of 4</b> — What's the <b>meeting title?</b>\n\n💡 <i>Tip: one-line shortcut:</i>\n<code>/meet Sprint Sync tomorrow 4pm 1h</code>\n\n<i>Type /cancel at any time to abort.</i>",
    { parse_mode: "HTML" }
  );
});

// Wizard step processor
async function handleMeetWizard(msg, session, text) {
  const chatId = msg.chat.id;
  const tz = process.env.TIMEZONE || "Asia/Kolkata";

  if (session.step === "title") {
    if (!text.trim()) return bot.sendMessage(chatId, "Please enter a meeting title.");
    session.data.title = text.trim();
    session.step = "date";
    meetSessions.set(chatId, session);
    return bot.sendMessage(chatId,
      "<b>Step 2 of 4</b> \u2014 \uD83D\uDCC5 <b>Date?</b>\n\nExamples: <code>today</code>  <code>tomorrow</code>  <code>7 Mar</code>  <code>DD/MM</code>",
      { parse_mode: "HTML" });
  }

  if (session.step === "date") {
    const dateStr = parseDateStr(text, tz);
    if (!dateStr) {
      return bot.sendMessage(chatId,
        "\u274c Couldn\u2019t understand that date. Try: <code>today</code>, <code>tomorrow</code>, <code>7 Mar</code>",
        { parse_mode: "HTML" });
    }
    session.data.dateStr = dateStr;
    session.step = "time";
    meetSessions.set(chatId, session);
    return bot.sendMessage(chatId,
      "<b>Step 3 of 4</b> \u2014 \uD83D\uDD50 <b>Start time?</b>\n\nExamples: <code>3pm</code>  <code>15:30</code>  <code>9:00 AM</code>",
      { parse_mode: "HTML" });
  }

  if (session.step === "time") {
    const timeStr = parseTimeStr(text);
    if (!timeStr) {
      return bot.sendMessage(chatId,
        "\u274c Couldn\u2019t understand that time. Try: <code>3pm</code>, <code>15:30</code>, <code>9:00 AM</code>",
        { parse_mode: "HTML" });
    }
    session.data.timeStr = timeStr;
    session.step = "duration";
    meetSessions.set(chatId, session);
    return bot.sendMessage(chatId,
      "<b>Step 4 of 4</b> \u2014 \u23F1 <b>Duration?</b>\n\nExamples: <code>30 min</code>  <code>1 hour</code>  <code>1.5h</code>  <code>90m</code>",
      { parse_mode: "HTML" });
  }

  if (session.step === "duration") {
    const durationMins = parseDurationMins(text);
    if (!durationMins || durationMins < 5) {
      return bot.sendMessage(chatId,
        "\u274c Couldn\u2019t understand that. Try: <code>30 min</code>, <code>1 hour</code>, <code>45m</code>",
        { parse_mode: "HTML" });
    }
    session.data.durationMins = durationMins;
    session.step = "attendees";
    meetSessions.set(chatId, session);
    return bot.sendMessage(chatId,
      "\uD83D\uDC65 <b>Attendees? (optional)</b>\n\nEnter email addresses separated by commas, or type <code>skip</code>:\n<code>alice@company.com, bob@company.com</code>",
      { parse_mode: "HTML" });
  }

  if (session.step === "attendees") {
    meetSessions.delete(chatId);
    const attendees = text.toLowerCase() === "skip"
      ? []
      : text.split(",").map((e) => e.trim()).filter((e) => e.includes("@"));

    bot.sendMessage(chatId, "\u23F3 Creating your Teams meeting...");

    try {
      const { title, dateStr, timeStr, durationMins } = session.data;
      const event = await createTeamsMeeting(title, dateStr, timeStr, durationMins, attendees, tz);

      const joinUrl = event.onlineMeeting?.joinUrl || event.webLink;
      const hrs = Math.floor(durationMins / 60);
      const mins = durationMins % 60;
      const hrMin = hrs > 0 && mins > 0 ? `${hrs}h ${mins}m` : hrs > 0 ? `${hrs}h` : `${mins}m`;

      const lines = [
        "\u2705 <b>Teams Meeting Created!</b>",
        "",
        `\uD83D\uDCCC <b>${title}</b>`,
        `\uD83D\uDCC5 ${dateStr}  \uD83D\uDD50 ${timeStr}  \u23F1 ${hrMin}`,
        attendees.length ? `\uD83D\uDC65 ${attendees.join(", ")}` : "",
        "",
        `\uD83D\uDD17 <a href="${joinUrl}">Join Meeting</a>`,
      ].filter((l) => l !== "");

      const message = lines.join("\n");
      bot.sendMessage(chatId, message, { parse_mode: "HTML", disable_web_page_preview: true });
      sendToGroup(message);
    } catch (err) {
      console.error("\u274c createTeamsMeeting error:", err.message);
      bot.sendMessage(chatId,
        `\u274c Failed to create meeting: <code>${err.message.substring(0, 300)}</code>`,
        { parse_mode: "HTML" });
    }
    return;
  }
}

// /cancelmeeting — cancel (delete) a scheduled Teams meeting
bot.onText(/\/cancelmeeting/, async (msg) => {
  try {
    const events = await getScheduledMeetings(0, 10080);
    if (!events.length) {
      return bot.sendMessage(msg.chat.id, "📭 No upcoming meetings to cancel.", { parse_mode: "HTML" });
    }
    const top10 = events.slice(0, 10);
    cancelSessions.set(msg.chat.id, { events: top10 });
    const tz = process.env.TIMEZONE || "Asia/Kolkata";
    const lines = ["<b>🗑 Which meeting to cancel?</b>", "", "Reply with the number:", ""];
    top10.forEach((e, i) => {
      const start = new Date(e.start.dateTime || e.start.date);
      const dateStr = start.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: tz });
      const timeStr = start.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: tz });
      lines.push(`${i + 1}. <b>${e.subject || "Meeting"}</b> — ${dateStr} ${timeStr}`);
    });
    lines.push("", "<i>Type /cancel to abort</i>");
    bot.sendMessage(msg.chat.id, lines.join("\n"), { parse_mode: "HTML" });
  } catch (err) {
    bot.sendMessage(msg.chat.id, "❌ Could not fetch meetings: " + err.message);
  }
});

// Handle /cancelmeeting number selection
async function handleCancelSelection(msg, session, text) {
  const chatId = msg.chat.id;
  const idx = parseInt(text) - 1;
  if (isNaN(idx) || idx < 0 || idx >= session.events.length) {
    return bot.sendMessage(chatId, `❌ Please reply with a number between 1 and ${session.events.length}.`);
  }
  const event = session.events[idx];
  cancelSessions.delete(chatId);
  bot.sendMessage(chatId, `⏳ Cancelling <b>${event.subject || "Meeting"}</b>...`, { parse_mode: "HTML" });
  try {
    await deleteCalendarEvent(event.id);
    const tz = process.env.TIMEZONE || "Asia/Kolkata";
    const start = new Date(event.start.dateTime || event.start.date);
    const dateStr = start.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: tz });
    const timeStr = start.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: tz });
    const message = [
      "🗑 <b>Meeting Cancelled</b>",
      "",
      `📌 <b>${event.subject || "Meeting"}</b>`,
      `📅 ${dateStr}  🕐 ${timeStr}`,
      "",
      "<i>Removed from Outlook calendar.</i>",
    ].join("\n");
    bot.sendMessage(chatId, message, { parse_mode: "HTML" });
    sendToGroup(message);
  } catch (err) {
    console.error("❌ deleteCalendarEvent error:", err.message);
    bot.sendMessage(chatId,
      `❌ Failed to cancel: <code>${err.message.substring(0, 200)}</code>`,
      { parse_mode: "HTML" });
  }
}

// /help — show available commands
bot.onText(/\/help/, (msg) => {
  const help = [
    "<b>🤖 ClawMeetBot Commands</b>",
    "",
    "<b>📅 Meetings</b>",
    "/current — Meeting happening right now",
    "/next — Next meeting + join link",
    "/today — All meetings today",
    "/week — Full week grouped by day",
    "/upcoming — Next 5 meetings (7 days)",
    "/history — Last 5 past meetings",
    "/summary &lt;name&gt; — Re-show AI summary of a past meeting",
    "/notes &lt;name&gt; — View or add notes to a meeting",
    "",
    "<b>✅ Tasks</b>",
    "/tasks — Show pending action items (tap to complete)",
    "/addtask — Manually add a task",
    "/done &lt;id&gt; — Mark a task done (e.g. /done 3)",
    "/remind &lt;name&gt; — Show tasks for a person (or 'all')",
    "/stats — Meeting and task statistics",
    "",
    "<b>🗓 Create / Cancel Meetings</b>",
    "/meet — Guided Teams meeting creator",
    "/meet Title date time duration — One-line shortcut",
    "/cancelmeeting — Cancel a scheduled Teams meeting",
    "/cancel — Abort any active wizard",
    "",
    "/help — Show this message",
  ].join("\n");
  bot.sendMessage(msg.chat.id, help, { parse_mode: "HTML" });
});

// /history — show recent meetings from DB
bot.onText(/\/history(?:\s+(\d+))?/, async (msg, match) => {
  const limit = Math.min(parseInt((match && match[1]) || "5", 10), 20);
  const meetings = await getRecentMeetings(limit);
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
  const message = ["<b>📋 Recent Meetings</b>", "", ...lines, "", "<i>✅ = AI summary available | use /summary &lt;name&gt; to view</i>"].join("\n");
  bot.sendMessage(msg.chat.id, message, { parse_mode: "HTML" });
});

// /summary <keyword> — re-show AI summary of a past meeting
bot.onText(/\/summary(?:\s+(.+))?/, async (msg, match) => {
  const keyword = match && match[1] ? match[1].trim() : null;
  if (!keyword) {
    return bot.sendMessage(msg.chat.id,
      "Usage: <code>/summary &lt;meeting name&gt;</code>\nExample: <code>/summary sprint planning</code>",
      { parse_mode: "HTML" });
  }
  const meetings = await getMeetingByKeyword(keyword);
  if (!meetings.length) {
    return bot.sendMessage(msg.chat.id,
      `📭 No meetings found matching "<b>${keyword}</b>". Try /history to see meeting names.`,
      { parse_mode: "HTML" });
  }
  const found = meetings.find((m) => m.summary) || meetings[0];
  if (!found.summary) {
    return bot.sendMessage(msg.chat.id,
      `📭 <b>${found.subject}</b> was found but has no AI summary yet.\n<i>Summaries are generated automatically after a meeting ends.</i>`,
      { parse_mode: "HTML" });
  }
  const tz = process.env.TIMEZONE || "Asia/Kolkata";
  const date = new Date(found.start_time.replace(/Z?$/, "Z"));
  const dateStr = date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: tz });
  bot.sendMessage(msg.chat.id,
    [`📝 <b>AI Summary: ${found.subject}</b>`, `<i>${dateStr}</i>`, "", found.summary].join("\n"),
    { parse_mode: "HTML" });
});

// /tasks — show pending action items from DB with inline ✅ buttons
bot.onText(/\/tasks/, async (msg) => {
  const tasks = await getPendingTasks();
  if (!tasks.length) {
    return bot.sendMessage(msg.chat.id, "✅ No pending tasks! All caught up.", { parse_mode: "HTML" });
  }
  const lines = ["<b>📋 Pending Tasks</b>", ""];
  const keyboard = [];
  tasks.forEach((t, i) => {
    const deadline = t.deadline ? ` ⏳ ${t.deadline}` : "";
    lines.push(`${i + 1}. <b>${t.person}</b> — ${t.task}${deadline}`);
    lines.push(`   <i>${t.meeting_subject}</i>`);
    lines.push("");
    keyboard.push([{ text: `✅ Done: ${t.task.substring(0, 35)}`, callback_data: `done_${t.id}` }]);
  });
  bot.sendMessage(msg.chat.id, lines.join("\n"), {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: keyboard },
  });
});

// Inline button: tap ✅ to mark a task done
bot.on("callback_query", async (query) => {
  const data = query.data || "";
  if (!data.startsWith("done_")) return;
  const id = parseInt(data.split("_")[1]);
  if (isNaN(id)) return;
  await markTaskDone(id);
  bot.answerCallbackQuery(query.id, { text: `✅ Task #${id} marked done!` });
  const remaining = (query.message.reply_markup?.inline_keyboard || [])
    .filter(row => !row.some(btn => btn.callback_data === data));
  bot.editMessageReplyMarkup(
    { inline_keyboard: remaining },
    { chat_id: query.message.chat.id, message_id: query.message.message_id }
  ).catch(() => {});
});

// /done <id> — mark a task as done
bot.onText(/\/done(?:\s+(\d+))?/, async (msg, match) => {
  const id = match && match[1] ? parseInt(match[1]) : null;
  if (!id) {
    return bot.sendMessage(msg.chat.id, "Usage: <code>/done &lt;task_id&gt;</code>\nGet IDs with /tasks", { parse_mode: "HTML" });
  }
  await markTaskDone(id);
  bot.sendMessage(msg.chat.id, `✅ Task #${id} marked as done!`, { parse_mode: "HTML" });
});

// /remind <name|all> — show pending tasks for a person or everyone
bot.onText(/\/remind(?:\s+(.+))?/, async (msg, match) => {
  const name = match && match[1] ? match[1].trim() : null;
  if (!name) {
    return bot.sendMessage(msg.chat.id,
      "Usage: <code>/remind &lt;person name&gt;</code> or <code>/remind all</code>",
      { parse_mode: "HTML" });
  }

  if (name.toLowerCase() === "all") {
    const tasks = await getPendingTasks();
    if (!tasks.length) return bot.sendMessage(msg.chat.id, "✅ No pending tasks for anyone!");
    const grouped = {};
    tasks.forEach((t) => { (grouped[t.person] = grouped[t.person] || []).push(t); });
    const lines = ["<b>📢 Pending Tasks — All Team</b>", ""];
    Object.entries(grouped).forEach(([person, ptasks]) => {
      lines.push(`<b>${person}:</b>`);
      ptasks.forEach((t) => {
        const deadline = t.deadline ? ` ⏳ ${t.deadline}` : "";
        lines.push(`  • ${t.task}${deadline}`);
      });
      lines.push("");
    });
    return bot.sendMessage(msg.chat.id, lines.join("\n"), { parse_mode: "HTML" });
  }

  const tasks = await getTasksByPerson(name);
  if (!tasks.length) {
    return bot.sendMessage(msg.chat.id,
      `✅ No pending tasks found for <b>${name}</b>.`,
      { parse_mode: "HTML" });
  }
  const lines = [
    `📢 <b>Hey ${name}!</b> You have ${tasks.length} pending task${tasks.length > 1 ? "s" : ""}:`,
    "",
  ];
  tasks.forEach((t, i) => {
    const deadline = t.deadline ? ` ⏳ ${t.deadline}` : "";
    lines.push(`${i + 1}. ${t.task}${deadline}`);
    lines.push(`   <i>from: ${t.meeting_subject}</i>  <code>/done ${t.id}</code>`);
  });
  bot.sendMessage(msg.chat.id, lines.join("\n"), { parse_mode: "HTML" });
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

// /addtask — manually add a task not tied to a meeting
// Format: /addtask Person | Task description | deadline (optional)
bot.onText(/\/addtask(?:\s+([\s\S]+))?/, async (msg, match) => {
  const input = match && match[1] ? match[1].trim() : "";
  if (!input) {
    return bot.sendMessage(msg.chat.id,
      "<b>➕ Add a Manual Task</b>\n\nFormat:\n<code>/addtask Person | Task description | deadline</code>\n\nExamples:\n<code>/addtask Vivin | Send report to client | by Friday</code>\n<code>/addtask Ashwin | Update docs</code>",
      { parse_mode: "HTML" });
  }
  const parts = input.split("|").map(s => s.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return bot.sendMessage(msg.chat.id,
      "❌ Use <code>|</code> to separate: <code>/addtask Person | Task | Deadline</code>",
      { parse_mode: "HTML" });
  }
  const [person, task, deadline = ""] = parts;
  await saveTask("manual", "Manual Task", person, task, deadline);
  bot.sendMessage(msg.chat.id,
    `✅ <b>Task added!</b>\n\n👤 <b>${person}</b>\n📋 ${task}${deadline ? `\n⏳ ${deadline}` : ""}`,
    { parse_mode: "HTML" });
});

// /week — all meetings grouped by day for the next 7 days
bot.onText(/\/week/, async (msg) => {
  try {
    const tz = process.env.TIMEZONE || "Asia/Kolkata";
    const events = await getScheduledMeetings(0, 10080);
    if (!events.length) {
      return bot.sendMessage(msg.chat.id, "📭 No meetings in the next 7 days.", { parse_mode: "HTML" });
    }
    const grouped = {};
    for (const e of events) {
      const start = new Date((e.start.dateTime || e.start.date).replace(/Z?$/, "Z"));
      const key = start.toLocaleDateString("en-CA", { timeZone: tz });
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(e);
    }
    const lines = ["<b>📆 Week Ahead</b>", ""];
    for (const [key, dayEvents] of Object.entries(grouped).sort()) {
      const label = new Date(key + "T12:00:00Z").toLocaleDateString("en-IN", {
        weekday: "long", day: "numeric", month: "short", timeZone: "UTC",
      });
      lines.push(`<b>📅 ${label}</b>`);
      dayEvents.forEach((e) => {
        const s  = new Date((e.start.dateTime || e.start.date).replace(/Z?$/, "Z"));
        const en = new Date((e.end.dateTime   || e.end.date).replace(/Z?$/, "Z"));
        const sStr  = s.toLocaleTimeString("en-IN",  { hour: "2-digit", minute: "2-digit", timeZone: tz });
        const eStr  = en.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: tz });
        const url   = e.onlineMeeting?.joinUrl || e.webLink;
        lines.push(`  • <b>${(e.subject || "Meeting").trim()}</b>  🕐 ${sStr}–${eStr}${url ? `  <a href="${url}">Join</a>` : ""}`);
      });
      lines.push("");
    }
    bot.sendMessage(msg.chat.id, lines.join("\n"), { parse_mode: "HTML", disable_web_page_preview: true });
  } catch (err) {
    bot.sendMessage(msg.chat.id, "❌ Could not fetch week schedule: " + err.message);
  }
});

// /notes — view or add notes to a meeting
// View: /notes sprint planning
// Add:  /notes sprint planning | Client wants feature X by Q2
bot.onText(/\/notes(?:\s+([\s\S]+))?/, async (msg, match) => {
  const input = match && match[1] ? match[1].trim() : "";
  if (!input) {
    return bot.sendMessage(msg.chat.id,
      "<b>📝 Meeting Notes</b>\n\n👁 View: <code>/notes &lt;meeting name&gt;</code>\n➕ Add:  <code>/notes &lt;meeting name&gt; | &lt;your note&gt;</code>\n\nExample:\n<code>/notes sprint | Client wants feature X by Q2</code>",
      { parse_mode: "HTML" });
  }
  const pipeIdx = input.indexOf("|");
  if (pipeIdx !== -1) {
    const keyword  = input.substring(0, pipeIdx).trim();
    const noteText = input.substring(pipeIdx + 1).trim();
    if (!keyword || !noteText) {
      return bot.sendMessage(msg.chat.id, "❌ Both meeting name and note text are required.", { parse_mode: "HTML" });
    }
    const meetings = await getMeetingByKeyword(keyword);
    if (!meetings.length) {
      return bot.sendMessage(msg.chat.id, `📭 No meeting found matching "<b>${keyword}</b>".`, { parse_mode: "HTML" });
    }
    await addMeetingNote(meetings[0].id, meetings[0].subject, noteText);
    bot.sendMessage(msg.chat.id,
      `✅ Note saved for <b>${meetings[0].subject}</b>:\n\n<i>"${noteText}"</i>`,
      { parse_mode: "HTML" });
  } else {
    const meetings = await getMeetingByKeyword(input);
    if (!meetings.length) {
      return bot.sendMessage(msg.chat.id, `📭 No meeting found matching "<b>${input}</b>".`, { parse_mode: "HTML" });
    }
    const meeting = meetings[0];
    const notes = await getNotesByMeetingId(meeting.id);
    if (!notes.length) {
      return bot.sendMessage(msg.chat.id,
        `📭 No notes yet for <b>${meeting.subject}</b>.\n\nAdd one:\n<code>/notes ${input} | your note here</code>`,
        { parse_mode: "HTML" });
    }
    const tz = process.env.TIMEZONE || "Asia/Kolkata";
    const lines = [`📝 <b>Notes: ${meeting.subject}</b>`, ""];
    notes.forEach((n, i) => {
      const ts = new Date(n.created_at.replace(/Z?$/, "Z")).toLocaleDateString("en-IN",
        { day: "numeric", month: "short", timeZone: tz });
      lines.push(`${i + 1}. ${n.note}`);
      lines.push(`   <i>${ts}</i>`, "");
    });
    bot.sendMessage(msg.chat.id, lines.join("\n"), { parse_mode: "HTML" });
  }
});

// /stats — meeting and task statistics
bot.onText(/\/stats/, async (msg) => {
  try {
    const [meet, tasks] = await Promise.all([getMeetingStats(), getTaskStats()]);
    bot.sendMessage(msg.chat.id, [
      "📊 <b>ClawMeetBot Stats</b>",
      "",
      "<b>📅 Meetings</b>",
      `• This week: <b>${meet.thisWeek}</b>`,
      `• All time tracked: <b>${meet.total}</b>`,
      "",
      "<b>✅ Tasks</b>",
      `• Pending: <b>${tasks.pending}</b>`,
      `• Completed this month: <b>${tasks.doneThisMonth}</b>`,
      `• Total tracked: <b>${tasks.total}</b>`,
    ].join("\n"), { parse_mode: "HTML" });
  } catch (err) {
    bot.sendMessage(msg.chat.id, "❌ Could not fetch stats: " + err.message);
  }
});

// /search <keyword> — search pending tasks by keyword
bot.onText(/\/search(?:\s+(.+))?/, async (msg, match) => {
  const keyword = match && match[1] ? match[1].trim() : "";
  if (!keyword) {
    return bot.sendMessage(msg.chat.id,
      "Usage: <code>/search &lt;keyword&gt;</code>\nExample: <code>/search login page</code>",
      { parse_mode: "HTML" });
  }
  const tasks = await searchTasks(keyword).catch(() => []);
  if (!tasks.length) {
    return bot.sendMessage(msg.chat.id,
      `🔍 No pending tasks match "<b>${keyword}</b>".`, { parse_mode: "HTML" });
  }
  const lines = [`🔍 <b>Tasks matching "${keyword}"</b>`, ""];
  tasks.forEach((t) => {
    const dl = t.deadline ? `  📅 ${t.deadline}` : "";
    lines.push(`• [#${t.id}] <b>${t.person}</b> — ${t.task}${dl}  <code>/done ${t.id}</code>`);
  });
  bot.sendMessage(msg.chat.id, lines.join("\n"), { parse_mode: "HTML" });
});

// /cleardone — remove all completed tasks
bot.onText(/\/cleardone/, async (msg) => {
  const count = await clearDoneTasks().catch(() => 0);
  if (count === 0) {
    return bot.sendMessage(msg.chat.id, "🗑 No completed tasks to clear.");
  }
  bot.sendMessage(msg.chat.id,
    `✅ Cleared <b>${count}</b> completed task${count !== 1 ? "s" : ""}. All done!`,
    { parse_mode: "HTML" });
});

// /edittask <id> <new text> | <new deadline>
bot.onText(/\/edittask(?:\s+(.+))?/, async (msg, match) => {
  const input = match && match[1] ? match[1].trim() : "";
  if (!input) {
    return bot.sendMessage(msg.chat.id,
      "<b>✏️ Edit a Task</b>\n\nUsage: <code>/edittask &lt;id&gt; &lt;new text&gt;</code>\nWith deadline: <code>/edittask &lt;id&gt; &lt;new text&gt; | &lt;new deadline&gt;</code>\n\nExample:\n<code>/edittask 3 Finish landing page | by Friday</code>",
      { parse_mode: "HTML" });
  }
  const firstSpace = input.indexOf(" ");
  if (firstSpace === -1) {
    return bot.sendMessage(msg.chat.id, "❌ Please provide task id and new text.", { parse_mode: "HTML" });
  }
  const idStr = input.substring(0, firstSpace).trim();
  const rest  = input.substring(firstSpace + 1).trim();
  const id    = parseInt(idStr, 10);
  if (isNaN(id)) {
    return bot.sendMessage(msg.chat.id, `❌ Invalid task id: <code>${idStr}</code>`, { parse_mode: "HTML" });
  }
  const existing = await getTaskById(id).catch(() => null);
  if (!existing) {
    return bot.sendMessage(msg.chat.id, `❌ No task found with id <b>${id}</b>.`, { parse_mode: "HTML" });
  }
  const pipeIdx     = rest.indexOf("|");
  const newTask     = pipeIdx !== -1 ? rest.substring(0, pipeIdx).trim() : rest.trim();
  const newDeadline = pipeIdx !== -1 ? rest.substring(pipeIdx + 1).trim() : existing.deadline;
  if (!newTask) {
    return bot.sendMessage(msg.chat.id, "❌ Task text cannot be empty.", { parse_mode: "HTML" });
  }
  await editTask(id, newTask, newDeadline);
  bot.sendMessage(msg.chat.id,
    `✅ Task <b>#${id}</b> updated:\n\n📝 ${newTask}${newDeadline ? `\n📅 Deadline: ${newDeadline}` : ""}`,
    { parse_mode: "HTML" });
});

// /export — export all pending tasks as plain text
bot.onText(/\/export/, async (msg) => {
  const tasks = await getPendingTasks().catch(() => []);
  if (!tasks.length) {
    return bot.sendMessage(msg.chat.id, "📭 No pending tasks to export.");
  }
  const lines = ["PENDING TASKS EXPORT", "=".repeat(30), ""];
  tasks.forEach((t) => {
    lines.push(`[#${t.id}] ${t.person}`);
    lines.push(`  Task: ${t.task}`);
    if (t.deadline) lines.push(`  Due:  ${t.deadline}`);
    lines.push(`  From: ${t.meeting_subject}`);
    lines.push("");
  });
  lines.push(`Total: ${tasks.length} task${tasks.length !== 1 ? "s" : ""}`);
  bot.sendMessage(msg.chat.id, `<pre>${lines.join("\n")}</pre>`, { parse_mode: "HTML" });
});

// /attendance — view or record meeting attendance
bot.onText(/\/attendance(?:\s+([\s\S]+))?/, async (msg, match) => {
  const input = match && match[1] ? match[1].trim() : "";
  if (!input) {
    return bot.sendMessage(msg.chat.id,
      "<b>👥 Meeting Attendance</b>\n\n👁 View:  <code>/attendance &lt;meeting name&gt;</code>\n➕ Add:   <code>/attendance &lt;meeting name&gt; | Person1, Person2, ...</code>\n\nExample:\n<code>/attendance sprint | Alice, Bob, Carol</code>",
      { parse_mode: "HTML" });
  }
  const pipeIdx = input.indexOf("|");
  if (pipeIdx !== -1) {
    // Add attendance
    const keyword = input.substring(0, pipeIdx).trim();
    const persons = input.substring(pipeIdx + 1).split(",").map((p) => p.trim()).filter(Boolean);
    if (!keyword || !persons.length) {
      return bot.sendMessage(msg.chat.id, "❌ Please provide a meeting name and at least one person.", { parse_mode: "HTML" });
    }
    const meetings = await getMeetingByKeyword(keyword).catch(() => []);
    const meetingId      = meetings.length ? String(meetings[0].id) : keyword;
    const meetingSubject = meetings.length ? meetings[0].subject : keyword;
    await saveAttendance(meetingId, meetingSubject, persons);
    bot.sendMessage(msg.chat.id,
      `✅ Recorded <b>${persons.length}</b> attendee${persons.length !== 1 ? "s" : ""} for <b>${meetingSubject}</b>:\n\n${persons.map((p) => `• ${p}`).join("\n")}`,
      { parse_mode: "HTML" });
  } else {
    // View attendance
    const meetings = await getMeetingByKeyword(input).catch(() => []);
    if (!meetings.length) {
      return bot.sendMessage(msg.chat.id,
        `📭 No meeting found matching "<b>${input}</b>".\n\nTo record attendance:\n<code>/attendance ${input} | Name1, Name2</code>`,
        { parse_mode: "HTML" });
    }
    const meetingId = String(meetings[0].id);
    const rows      = await getAttendance(meetingId).catch(() => []);
    if (!rows.length) {
      return bot.sendMessage(msg.chat.id,
        `📭 No attendance recorded for <b>${meetings[0].subject}</b>.\n\nAdd some:\n<code>/attendance ${input} | Name1, Name2</code>`,
        { parse_mode: "HTML" });
    }
    const lines = [`👥 <b>Attendance: ${meetings[0].subject}</b>`, ""];
    rows.forEach((r, i) => lines.push(`${i + 1}. ${r.person}`));
    lines.push("", `<i>Total: ${rows.length} attendee${rows.length !== 1 ? "s" : ""}</i>`);
    bot.sendMessage(msg.chat.id, lines.join("\n"), { parse_mode: "HTML" });
  }
});

// Message handler: route to active wizard, otherwise log
bot.on("message", (msg) => {
  const text = (msg.text || "").trim();
  if (!text || text.startsWith("/")) return;

  const meetSession = meetSessions.get(msg.chat.id);
  if (meetSession) { handleMeetWizard(msg, meetSession, text); return; }

  const cancelSession = cancelSessions.get(msg.chat.id);
  if (cancelSession) { handleCancelSelection(msg, cancelSession, text); return; }

  console.log(`[${msg.chat.type}] ${msg.from.username || msg.from.first_name}: ${text}`);
});

bot.on("polling_error", (err) => console.error("❌ Polling error:", err.message));

process.on("unhandledRejection", (reason) => console.error("❌ Unhandled Rejection:", reason));
process.on("uncaughtException", (err) => console.error("❌ Uncaught Exception:", err.message));

module.exports = { bot, sendToGroup };
