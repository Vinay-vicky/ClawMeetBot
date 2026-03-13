const TelegramBot = require("node-telegram-bot-api");
const logger = require("../utils/logger");
const { getRecentMeetings, getPendingTasks, markTaskDone, getMeetingByKeyword, getTasksByPerson,
        saveTask, getMeetingStats, getTaskStats, addMeetingNote, getNotesByMeetingId,
        searchTasks, clearDoneTasks, editTask, getTaskById, saveAttendance, getAttendance,
        addTeamMember, getAllMembers, removeMemberByName, getMeetingAnalytics,
        addPersonalTask, getPersonalTasks, donePersonalTask, deletePersonalTask,
        addPersonalNote, getPersonalNotes, deletePersonalNote,
        upsertUser, generateLinkToken, saveTeamTask } = require("./dbService");
const { getScheduledMeetings, createTeamsMeeting, deleteCalendarEvent, getMeetingRecordings } = require("./calendarService");
const { parseNaturalLanguageCommand } = require("./aiSummaryService");
const { convertPdf, cleanup } = require("./pdfLLMService");
const { indexText, askKnowledge } = require("./ragService");
const { enqueue } = require("../utils/messageQueue");

if (!process.env.TELEGRAM_BOT_TOKEN) {
  logger.error("TELEGRAM_BOT_TOKEN is missing from .env");
  process.exit(1);
}

logger.info("Token loaded: " + process.env.TELEGRAM_BOT_TOKEN.substring(0, 10) + "...");

// Use polling locally, webhook on Render (avoids 409 conflict with cloud)
const isProduction = !!process.env.RENDER_EXTERNAL_URL;
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, isProduction ? {} : { polling: true });
if (!isProduction) logger.info("Bot running in polling mode (local dev)");
else logger.info("Bot running in webhook mode (Render)");

// In-memory state for /meet wizard: chatId -> { step, data }
const meetSessions = new Map();
// In-memory state for /cancelmeeting: chatId -> { events: [...] }
const cancelSessions = new Map();
// In-memory state for /addtask wizard: chatId -> { step, person, task }
const addTaskSessions = new Map();
// In-memory state for /addmember wizard: chatId -> true
const addMemberSessions = new Map();

// Page size for /tasks pagination
const TASKS_PAGE_SIZE = 5;

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
    logger.error("TELEGRAM_GROUP_ID not set in .env");
    return;
  }
  enqueue(() => bot.sendMessage(groupId, message, { parse_mode: "HTML" }))
    .then(() => logger.info("Message sent to group"))
    .catch((err) => logger.error("Send error:", err));
}

async function getTelegramProfilePhotoFileUrl(telegramId) {
  try {
    const numericId = Number(telegramId);
    const userId = Number.isFinite(numericId) ? numericId : String(telegramId);
    const profilePhotos = await bot.getUserProfilePhotos(userId, { limit: 1 });
    const photoSizes = profilePhotos?.photos?.[0];
    if (!photoSizes || !photoSizes.length) return null;

    const bestPhoto = photoSizes[photoSizes.length - 1];
    const file = await bot.getFile(bestPhoto.file_id);
    if (!file?.file_path) return null;

    return `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  } catch (err) {
    logger.warn(`Telegram profile photo lookup failed for ${telegramId}: ${err.message}`);
    return null;
  }
}

// /start — welcome message
bot.onText(/\/start/, (msg) => {
  const name = msg.from.first_name || "there";
  const welcome = [
    `👋 <b>Hey ${name}! Welcome to ClawMeetBot</b>`,
    "",
    "I keep your team in sync with Teams/Outlook meetings — reminders, live join links, AI summaries, and task tracking, all right here in Telegram.",
    "",
    "<b>📅 Meetings</b>",
    "/current — Meeting happening right now",
    "/next — Next scheduled meeting + join link",
    "/today — All meetings today",
    "/week — Full week grouped by day",
    "/upcoming — Next 5 meetings (7-day view)",
    "/history [n] — Last N past meetings (default 5)",
    "/summary &lt;name&gt; — AI summary of a past meeting",
    "/pdf &lt;name&gt; — Export meeting minutes as PDF",
    "/notes &lt;name&gt; — View or add notes to a meeting",
    "/attendance &lt;name&gt; — View or record attendees",
    "",
    "<b>✅ Team Tasks</b>",
    "/tasks — Pending action items (tap ✅ to complete)",
    "/addtask — Manually add a task",
    "/done &lt;id&gt; — Mark a task done",
    "/remind &lt;name&gt; — Tasks for a person (or 'all')",
    "/search &lt;keyword&gt; — Search pending tasks",
    "/edittask &lt;id&gt; &lt;text&gt; | &lt;deadline&gt; — Edit a task",
    "/cleardone — Remove all completed tasks",
    "/export — Export all pending tasks as text",
    "/stats — Meeting and task statistics",
    "",
    "<b>🗓 Create / Cancel Meetings</b>",
    "/meet — Guided Teams meeting creator",
    "/meet Title date time duration — One-line shortcut",
    "/cancelmeeting — Cancel a scheduled Teams meeting",
    "/addmember Name | email — Save a team member",
    "/members — List saved team members",
    "/removemember &lt;name&gt; — Remove a member",
    "/cancel — Abort any active wizard",
    "",
    "<b>🤖 AI</b>",
    "/ask &lt;question&gt; — Chat with your meeting history",
    "/intelligence — Advanced meeting analytics",
    "/recordings &lt;name&gt; — Find a meeting recording",
    "",
    "<b>📊 Dashboard</b>",
    "/dashboard — Open the team dashboard",
    "",
    "/help — Show this menu again",
    "",
    "🔐 <b>Personal workspace commands</b> (sent privately to you — use in DM with me):",
    "<i>/myprofile · /mytasks · /mytask · /mynotes · /note · /mydonetask · /mydeltask · /mydelnote</i>",
    "",
    "<i>Reminders: 1 day / 1 hr / 10 min + 30 min prep briefing. AI summary + task assignments auto-posted after meetings. Task deadline alerts at 8 AM. Overdue alerts at 9 AM.</i>",
  ].join("\n");
  bot.sendMessage(msg.chat.id, welcome, { parse_mode: "HTML" });
});

// /cancel — abort any active wizard
bot.onText(/\/cancel/, (msg) => {
  const hadMeet      = meetSessions.delete(msg.chat.id);
  const hadCancel    = cancelSessions.delete(msg.chat.id);
  const hadAddTask   = addTaskSessions.delete(msg.chat.id);
  const hadAddMember = addMemberSessions.delete(msg.chat.id);
  if (hadMeet || hadCancel || hadAddTask || hadAddMember) {
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

// Build and send the attendee picker (inline keyboard of saved members)
async function showAttendeePicker(chatId, title, dateStr, timeStr, hrMin, selectedEmails) {
  const members = await getAllMembers().catch(() => []);
  const lines = [`✅ <b>${title}</b>\n📅 ${dateStr}  🕐 ${timeStr}  ⏱ ${hrMin}\n\n👥 <b>Select attendees:</b>`];
  const keyboard = [];

  members.forEach((m) => {
    const selected = selectedEmails.includes(m.email);
    keyboard.push([{ text: `${selected ? "✅" : "◻️"} ${m.name}`, callback_data: `ma_toggle_${m.id}_${m.email}` }]);
  });

  const actionRow = [];
  if (members.length) actionRow.push({ text: "✏️ Add manually", callback_data: "ma_manual" });
  actionRow.push({ text: "⏭ Skip", callback_data: "ma_skip" });
  actionRow.push({ text: "✅ Confirm", callback_data: "ma_confirm" });
  keyboard.push(actionRow);

  if (!members.length) {
    lines.push("\n<i>No saved members yet. Tap \"Add manually\" to enter emails, or use /addmember to save the team first.</i>");
  }

  return bot.sendMessage(chatId, lines.join("\n"), {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: keyboard },
  });
}

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
    session.selectedEmails = session.selectedEmails || [];
    meetSessions.set(chatId, session);
    const hrs2 = Math.floor(durationMins / 60);
    const mins2 = durationMins % 60;
    const hrMin2 = hrs2 > 0 && mins2 > 0 ? `${hrs2}h ${mins2}m` : hrs2 > 0 ? `${hrs2}h` : `${mins2}m`;
    return showAttendeePicker(chatId, session.data.title, session.data.dateStr, session.data.timeStr, hrMin2, session.selectedEmails);
  }

  if (session.step === "attendees_manual") {
    // User typed extra emails to add on top of selected members
    const typed = text.toLowerCase() === "skip"
      ? []
      : text.split(",").map((e) => e.trim()).filter((e) => e.includes("@"));
    const allAttendees = [...new Set([...(session.selectedEmails || []), ...typed])];
    session.step = "attendees";
    session.selectedEmails = allAttendees;
    meetSessions.set(chatId, session);
    const { title, dateStr, timeStr, durationMins } = session.data;
    const hrs = Math.floor(durationMins / 60); const mins = durationMins % 60;
    const hrMin = hrs > 0 && mins > 0 ? `${hrs}h ${mins}m` : hrs > 0 ? `${hrs}h` : `${mins}m`;
    return showAttendeePicker(chatId, title, dateStr, timeStr, hrMin, allAttendees);
  }

  if (session.step === "attendees") {
    meetSessions.delete(chatId);
    const typed = text.toLowerCase() === "skip" ? [] : text.split(",").map((e) => e.trim()).filter((e) => e.includes("@"));
    const attendees = [...new Set([...(session.selectedEmails || []), ...typed])];
    await finishMeetingCreation(chatId, session, attendees);
    return;
  }
}

// Shared final step: create the meeting and announce it
async function finishMeetingCreation(chatId, session, attendees) {
  const tz = process.env.TIMEZONE || "Asia/Kolkata";
  const { title, dateStr, timeStr, durationMins } = session.data;

  // ── Conflict detection ────────────────────────────────────────────────────
  try {
    const existing = await getScheduledMeetings(0, 10080);
    const newStart = new Date(`${dateStr}T${timeStr}:00`).getTime();
    const newEnd   = newStart + durationMins * 60000;

    const conflicts = existing.filter((e) => {
      const s = new Date((e.start.dateTime || e.start.date).replace(/Z?$/, "Z")).getTime();
      const en = new Date((e.end.dateTime   || e.end.date).replace(/Z?$/, "Z")).getTime();
      return s < newEnd && en > newStart;           // overlap
    });

    if (conflicts.length) {
      const conflictLines = conflicts.map((e) => {
        const s = new Date((e.start.dateTime || e.start.date).replace(/Z?$/, "Z"));
        const eEnd = new Date((e.end.dateTime || e.end.date).replace(/Z?$/, "Z"));
        const sStr = s.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: tz });
        const eStr = eEnd.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: tz });
        return `⚠️ <b>${(e.subject || "Meeting").trim()}</b> (${sStr}–${eStr})`;
      });
      await bot.sendMessage(chatId, [
        `⚠️ <b>Time Conflict Detected!</b>`,
        ``,
        `The new meeting overlaps with:`,
        ...conflictLines,
        ``,
        `Creating it anyway — please adjust if needed.`,
      ].join("\n"), { parse_mode: "HTML" });
    }
  } catch (_) { /* non-fatal */ }

  bot.sendMessage(chatId, "⏳ Creating your Teams meeting...");
  try {
    const event = await createTeamsMeeting(title, dateStr, timeStr, durationMins, attendees, tz, session.createdBy);
    const joinUrl = event.onlineMeeting?.joinUrl || event.webLink;
    const hrs = Math.floor(durationMins / 60);
    const mins = durationMins % 60;
    const hrMin = hrs > 0 && mins > 0 ? `${hrs}h ${mins}m` : hrs > 0 ? `${hrs}h` : `${mins}m`;
    const lines = [
      "✅ <b>Teams Meeting Created!</b>",
      "",
      `📌 <b>${title}</b>`,
      `📅 ${dateStr}  🕐 ${timeStr}  ⏱ ${hrMin}`,
      attendees.length ? `👥 Attendees: ${attendees.join(", ")}` : "",
      `👤 Created by: <b>${session.createdBy || "Team"}</b>`,
      "",
      `🔗 <a href="${joinUrl}">Join Meeting</a>`,
      "",
      "🔴 <b>Auto-recording is enabled</b> — AI summary will be posted when the meeting ends.",
    ].filter((l) => l !== "");
    const message = lines.join("\n");
    bot.sendMessage(chatId, message, { parse_mode: "HTML", disable_web_page_preview: true });
    sendToGroup(message);
  } catch (err) {
    logger.error("createTeamsMeeting error:", err);
    bot.sendMessage(chatId,
      `❌ Failed to create meeting: <code>${err.message.substring(0, 300)}</code>`,
      { parse_mode: "HTML" });
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
    logger.error("deleteCalendarEvent error:", err);
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
    "/history [n] — Last N past meetings (default 5)",
    "/summary &lt;name&gt; — AI summary of a past meeting",
    "/pdf &lt;name&gt; — Export meeting minutes as PDF",
    "/notes &lt;name&gt; — View or add notes",
    "/notes &lt;name&gt; | &lt;text&gt; — Add a note",
    "/attendance &lt;name&gt; — View attendees",
    "/attendance &lt;name&gt; | P1, P2 — Record attendees",
    "",
    "<b>✅ Team Tasks</b>",
    "/tasks — Pending items (tap ✅ to complete)",
    "/addtask — Manually add a task",
    "/done &lt;id&gt; — Mark a task done",
    "/remind &lt;name&gt; — Tasks for a person (or 'all')",
    "/search &lt;keyword&gt; — Search pending tasks",
    "/edittask &lt;id&gt; &lt;text&gt; | &lt;deadline&gt; — Edit a task",
    "/cleardone — Remove all completed tasks",
    "/export — Export all pending tasks as text",
    "/stats — Meeting and task statistics",
    "",
    "<b>🗓 Create / Cancel Meetings</b>",
    "/meet — Guided Teams meeting creator",
    "/meet Title date time duration — One-line shortcut",
    "/cancelmeeting — Cancel a scheduled Teams meeting",
    "/addmember Name | email — Save a team member",
    "/members — List saved team members",
    "/removemember &lt;name&gt; — Remove a member",
    "/cancel — Abort any active wizard",
    "",
    "<b>🤖 AI</b>",
    "/ask &lt;question&gt; — Chat with your meeting history",
    "/intelligence — Advanced meeting analytics",
    "/recordings &lt;name&gt; — Find a meeting recording",
    "",
    "<b>📊 Dashboard</b>",
    "/dashboard — Open the team dashboard",
    "",
    "🔐 <b>Personal workspace</b> (replies sent privately to you):",
    "<i>/myprofile · /mytasks · /mytask · /mynotes · /note · /mydonetask · /mydeltask · /mydelnote</i>",
    "",
    "/help — Show this message",
  ].join("\n");
  bot.sendMessage(msg.chat.id, help, { parse_mode: "HTML" });
});

// /ask <question> — AI chat over meeting history and summaries
bot.onText(/\/ask(?:\s+([\s\S]+))?/, async (msg, match) => {
  const question = match && match[1] ? match[1].trim() : "";
  if (!question) {
    return bot.sendMessage(msg.chat.id,
      "Usage: <code>/ask what was decided about deployment?</code>\nAsk anything about past meetings.",
      { parse_mode: "HTML" });
  }

  const hasKey = process.env.KIMI_API_KEY || process.env.OPENAI_API_KEY ||
    (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "your_gemini_api_key_here");
  if (!hasKey) {
    return bot.sendMessage(msg.chat.id, "❌ No AI API key configured (KIMI_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY).", { parse_mode: "HTML" });
  }

  bot.sendMessage(msg.chat.id, "🔍 Searching meeting history...");

  // Gather context: last 10 meetings with summaries + their tasks
  const meetings = await getRecentMeetings(10);
  const tasks = await getPendingTasks();

  const context = meetings.map((m) => {
    const taskList = tasks
      .filter((t) => t.meeting_id === m.id)
      .map((t) => `  - ${t.person}: ${t.task}${t.deadline ? ` (by ${t.deadline})` : ""}`)
      .join("\n");
    return [
      `Meeting: ${m.subject} (${m.start_time})`,
      m.summary ? `Summary: ${m.summary}` : "",
      taskList ? `Tasks:\n${taskList}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n\n---\n\n");

  const { callAI } = require("./aiSummaryService");
  const systemPrompt = "You are a meeting assistant. Answer questions based only on the meeting history provided. Be concise. Use bullet points for lists. If the answer is not in the data, say so clearly.";
  const userPrompt = `Meeting history:\n${context.substring(0, 5000)}\n\nQuestion: ${question}`;

  try {
    const answer = await callAI(systemPrompt, userPrompt);
    if (!answer) throw new Error("No response from AI");
    bot.sendMessage(msg.chat.id,
      `🤖 <b>Answer:</b>\n\n${answer}`,
      { parse_mode: "HTML" });
  } catch (err) {
    logger.error("AI ask error:", err);
    bot.sendMessage(msg.chat.id, "❌ AI search failed. Try again later.");
  }
});

// /dashboard — send link to the web dashboard
bot.onText(/\/dashboard/, (msg) => {
  const base = process.env.RENDER_EXTERNAL_URL || "http://localhost:" + (process.env.PORT || 3000);
  const dashUrl = `${base}/dashboard`;
  bot.sendMessage(
    msg.chat.id,
    `📊 <b>Web Dashboard</b>\n\nOpen your live meeting analytics:\n<a href="${dashUrl}">${dashUrl}</a>`,
    { parse_mode: "HTML", disable_web_page_preview: false }
  );
});

// /intelligence — advanced meeting analytics
bot.onText(/\/intelligence/, async (msg) => {
  bot.sendMessage(msg.chat.id, "📊 Crunching meeting data...");
  try {
    const a = await getMeetingAnalytics();
    const weekLine = a.weeks.map((w) => `${w.week}: <b>${w.count}</b>`).join("  |  ");
    const assigneeLines = a.topAssignees.length
      ? a.topAssignees.map((x, i) => `  ${i + 1}. ${x.person} — ${x.count} task${x.count !== 1 ? "s" : ""}`).join("\n")
      : "  No data yet";
    const dayLines = a.busiestDays.length
      ? a.busiestDays.map((d) => `  ${d.day}: ${d.count} meeting${d.count !== 1 ? "s" : ""}`).join("\n")
      : "  No data yet";
    const dashUrl = process.env.RENDER_EXTERNAL_URL
      ? `${process.env.RENDER_EXTERNAL_URL}/dashboard` : "/dashboard";
    const lines = [
      "📊 <b>Meeting Intelligence</b>",
      "",
      "📅 <b>Meetings per week:</b>",
      weekLine,
      "",
      `🗂 <b>Total recorded:</b> ${a.totalMeetings} meeting${a.totalMeetings !== 1 ? "s" : ""}`,
      "",
      "✅ <b>Task Completion:</b>",
      `  Done: ${a.doneTasks}  |  Pending: ${a.pendingTasks}  |  Rate: <b>${a.completionRate}%</b>`,
      "",
      "👤 <b>Top Assignees:</b>",
      assigneeLines,
      "",
      "📆 <b>Busiest Days:</b>",
      dayLines,
      "",
      `<i>🌐 Full dashboard: <a href="${dashUrl}">${dashUrl}</a></i>`,
    ];
    bot.sendMessage(msg.chat.id, lines.join("\n"), { parse_mode: "HTML", disable_web_page_preview: true });
  } catch (err) {
    logger.error("/intelligence error:", err);
    bot.sendMessage(msg.chat.id, "❌ Could not load analytics. Try again later.");
  }
});

// /recordings [keyword] — find and show recording for a past meeting
bot.onText(/\/recordings(?:\s+(.+))?/, async (msg, match) => {
  const keyword = match && match[1] ? match[1].trim() : null;
  if (!keyword) {
    return bot.sendMessage(msg.chat.id,
      "Usage: <code>/recordings &lt;meeting name&gt;</code>\nExample: <code>/recordings sprint planning</code>",
      { parse_mode: "HTML" });
  }
  bot.sendMessage(msg.chat.id, "🔍 Looking up recordings...");
  try {
    const meetings = await getMeetingByKeyword(keyword);
    if (!meetings.length) {
      return bot.sendMessage(msg.chat.id,
        `📭 No meetings found matching "<b>${keyword}</b>". Try /history to see meeting names.`,
        { parse_mode: "HTML" });
    }
    const meeting = meetings[0];
    const tz = process.env.TIMEZONE || "Asia/Kolkata";
    const dateStr = new Date(meeting.start_time.replace(/Z?$/, "Z"))
      .toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: tz });
    const lines = [
      `📹 <b>Recordings: ${meeting.subject}</b>`,
      `<i>${dateStr}${meeting.organizer ? " · " + meeting.organizer : ""}</i>`,
      "",
    ];
    const recordings = meeting.join_url ? await getMeetingRecordings(meeting.join_url) : null;
    if (recordings === null) {
      lines.push(
        "⚠️ Recording access unavailable.",
        "<i>Grant <code>OnlineMeetingRecording.Read.All</code> permission to the Azure app to enable this feature.</i>",
      );
    } else if (recordings.length === 0) {
      lines.push(
        "📭 No recordings found for this meeting.",
        "<i>Either it wasn\u2019t recorded or the recording is still processing.</i>",
      );
    } else {
      recordings.forEach((r, i) => {
        const created = r.createdDateTime
          ? new Date(r.createdDateTime).toLocaleDateString("en-IN", { timeZone: tz, day: "numeric", month: "short" })
          : "";
        lines.push(`🎬 <b>Recording ${i + 1}</b>${created ? " — " + created : ""}`);
        if (r.recordingContentUrl) {
          lines.push(`   <a href="${r.recordingContentUrl}">▶️ Watch Recording</a>`);
        }
      });
    }
    if (meeting.summary) {
      lines.push("", `📝 AI summary available — <code>/summary ${keyword}</code>`);
    }
    bot.sendMessage(msg.chat.id, lines.join("\n"), { parse_mode: "HTML", disable_web_page_preview: true });
  } catch (err) {
    logger.error("/recordings error:", err);
    bot.sendMessage(msg.chat.id, "❌ Could not fetch recordings. Try again later.");
  }
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

// /pdf <keyword> — generate PDF meeting minutes and send as document
bot.onText(/\/pdf(?:\s+(.+))?/, async (msg, match) => {
  const keyword = match && match[1] ? match[1].trim() : null;
  if (!keyword) {
    return bot.sendMessage(msg.chat.id,
      "Usage: <code>/pdf &lt;meeting name&gt;</code>\nExample: <code>/pdf sprint planning</code>",
      { parse_mode: "HTML" });
  }
  const meetings = await getMeetingByKeyword(keyword);
  if (!meetings.length) {
    return bot.sendMessage(msg.chat.id,
      `📭 No meetings found matching "<b>${keyword}</b>".`,
      { parse_mode: "HTML" });
  }
  const found = meetings[0];
  const tasks = (await getPendingTasks()).filter((t) => t.meeting_id === found.id);
  const notes = await getNotesByMeetingId(found.id);
  const attendance = await getAttendance(found.id);

  bot.sendMessage(msg.chat.id, "📄 Generating PDF...");

  const PDFDocument = require("pdfkit");
  const { PassThrough } = require("stream");
  const tz = process.env.TIMEZONE || "Asia/Kolkata";
  const date = new Date(found.start_time.replace(/Z?$/, "Z"));
  const dateStr = date.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: tz });
  const timeStr = date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: tz });

  const doc = new PDFDocument({ margin: 50 });
  const stream = new PassThrough();
  const chunks = [];
  stream.on("data", (c) => chunks.push(c));
  doc.pipe(stream);

  // ── Header ──────────────────────────────────────────────────────
  doc.fontSize(20).font("Helvetica-Bold").text("Meeting Minutes", { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(16).font("Helvetica-Bold").text(found.subject, { align: "center" });
  doc.fontSize(11).font("Helvetica").fillColor("#555555")
     .text(`${dateStr}  ·  ${timeStr}`, { align: "center" });
  doc.moveDown();
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke("#cccccc").moveDown();

  // ── Attendees ────────────────────────────────────────────────────
  if (attendance.length) {
    doc.fontSize(13).font("Helvetica-Bold").fillColor("#000000").text("Attendees");
    doc.fontSize(11).font("Helvetica").text(attendance.map((a) => a.person).join(", "));
    doc.moveDown();
  }

  // ── AI Summary ───────────────────────────────────────────────────
  if (found.summary) {
    doc.fontSize(13).font("Helvetica-Bold").text("AI Summary");
    doc.fontSize(11).font("Helvetica").text(found.summary, { lineGap: 3 });
    doc.moveDown();
  }

  // ── Notes ────────────────────────────────────────────────────────
  if (notes.length) {
    doc.fontSize(13).font("Helvetica-Bold").text("Notes");
    notes.forEach((n) => doc.fontSize(11).font("Helvetica").text(`• ${n.note}`, { lineGap: 2 }));
    doc.moveDown();
  }

  // ── Action Items ─────────────────────────────────────────────────
  if (tasks.length) {
    doc.fontSize(13).font("Helvetica-Bold").text("Action Items");
    tasks.forEach((t) => {
      const deadline = t.deadline ? `  [by ${t.deadline}]` : "";
      doc.fontSize(11).font("Helvetica-Bold").text(`${t.person}`, { continued: true })
         .font("Helvetica").text(` — ${t.task}${deadline}`, { lineGap: 3 });
    });
    doc.moveDown();
  }

  // ── Footer ───────────────────────────────────────────────────────
  doc.fontSize(9).fillColor("#aaaaaa")
     .text(`Generated by ClawMeetBot · ${new Date().toLocaleDateString("en-IN", { timeZone: tz })}`, { align: "center" });

  doc.end();

  await new Promise((resolve) => stream.on("end", resolve));
  const pdfBuffer = Buffer.concat(chunks);
  const filename = `${found.subject.replace(/[^a-z0-9]/gi, "_").substring(0, 40)}_minutes.pdf`;

  bot.sendDocument(msg.chat.id, pdfBuffer, {}, {
    filename,
    contentType: "application/pdf",
  });
});
async function buildTasksPage(page) {
  const tasks = await getPendingTasks();
  if (!tasks.length) return null;
  const totalPages = Math.ceil(tasks.length / TASKS_PAGE_SIZE);
  const p = Math.max(0, Math.min(page, totalPages - 1));
  const slice = tasks.slice(p * TASKS_PAGE_SIZE, (p + 1) * TASKS_PAGE_SIZE);
  const lines = [`<b>📋 Pending Tasks</b>  <i>(${tasks.length} total • page ${p + 1}/${totalPages})</i>`, ""];
  const keyboard = [];
  slice.forEach((t, i) => {
    const num = p * TASKS_PAGE_SIZE + i + 1;
    const deadline = t.deadline ? `  📅 <i>${t.deadline}</i>` : "";
    lines.push(`${num}. <b>${t.person}</b> — ${t.task}${deadline}`);
    lines.push(`   <i>${t.meeting_subject}</i>  <code>/done ${t.id}</code>`);
    lines.push("");
    keyboard.push([{ text: `✅ Done: ${t.task.substring(0, 35)}`, callback_data: `done_${t.id}` }]);
  });
  const navRow = [];
  if (p > 0)              navRow.push({ text: "◀ Prev", callback_data: `tp_${p - 1}` });
  if (totalPages > 1)     navRow.push({ text: `${p + 1} / ${totalPages}`, callback_data: "tp_noop" });
  if (p < totalPages - 1) navRow.push({ text: "Next ►", callback_data: `tp_${p + 1}` });
  if (navRow.length) keyboard.push(navRow);
  return { text: lines.join("\n"), keyboard };
}

// /tasks — show pending action items from DB with inline ✅ buttons
bot.onText(/\/tasks/, async (msg) => {
  const result = await buildTasksPage(0);
  if (!result) {
    return bot.sendMessage(msg.chat.id, "✅ No pending tasks! All caught up.", { parse_mode: "HTML" });
  }
  bot.sendMessage(msg.chat.id, result.text, {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: result.keyboard },
  });
});

// Inline button: tap ✅ to mark a task done, or navigate task pages, or pick meeting attendees
bot.on("callback_query", async (query) => {
  const data = query.data || "";
  const chatId = query.message.chat.id;

  // ── Meeting attendee picker ────────────────────────────────────────────────
  if (data === "ma_skip") {
    const session = meetSessions.get(chatId);
    if (!session) return bot.answerCallbackQuery(query.id);
    meetSessions.delete(chatId);
    bot.answerCallbackQuery(query.id);
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id }).catch(() => {});
    await finishMeetingCreation(chatId, session, session.selectedEmails || []);
    return;
  }
  if (data === "ma_confirm") {
    const session = meetSessions.get(chatId);
    if (!session) return bot.answerCallbackQuery(query.id);
    meetSessions.delete(chatId);
    bot.answerCallbackQuery(query.id);
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id }).catch(() => {});
    await finishMeetingCreation(chatId, session, session.selectedEmails || []);
    return;
  }
  if (data === "ma_manual") {
    const session = meetSessions.get(chatId);
    if (!session) return bot.answerCallbackQuery(query.id);
    session.step = "attendees_manual";
    meetSessions.set(chatId, session);
    bot.answerCallbackQuery(query.id);
    bot.sendMessage(chatId,
      "✏️ Type extra email addresses (comma-separated) for people not in the team list:\n<code>guest@example.com, partner@agency.com</code>\n\nOr type <code>skip</code> to skip.",
      { parse_mode: "HTML" });
    return;
  }
  if (data.startsWith("ma_toggle_")) {
    const session = meetSessions.get(chatId);
    if (!session) return bot.answerCallbackQuery(query.id);
    // format: ma_toggle_<id>_<email>
    const parts = data.slice("ma_toggle_".length).split("_");
    const email = parts.slice(1).join("_"); // email may contain underscores
    session.selectedEmails = session.selectedEmails || [];
    if (session.selectedEmails.includes(email)) {
      session.selectedEmails = session.selectedEmails.filter((e) => e !== email);
    } else {
      session.selectedEmails.push(email);
    }
    meetSessions.set(chatId, session);
    bot.answerCallbackQuery(query.id);
    // Rebuild the picker in-place
    const members = await getAllMembers().catch(() => []);
    const { title, dateStr, timeStr, durationMins } = session.data;
    const hrs = Math.floor(durationMins / 60); const mins = durationMins % 60;
    const hrMin = hrs > 0 && mins > 0 ? `${hrs}h ${mins}m` : hrs > 0 ? `${hrs}h` : `${mins}m`;
    const keyboard = [];
    members.forEach((m) => {
      const selected = session.selectedEmails.includes(m.email);
      keyboard.push([{ text: `${selected ? "✅" : "▫️"} ${m.name}`, callback_data: `ma_toggle_${m.id}_${m.email}` }]);
    });
    const actionRow = [];
    actionRow.push({ text: "✏️ Add manually", callback_data: "ma_manual" });
    actionRow.push({ text: "⏭ Skip", callback_data: "ma_skip" });
    actionRow.push({ text: "✅ Confirm", callback_data: "ma_confirm" });
    keyboard.push(actionRow);
    bot.editMessageReplyMarkup({ inline_keyboard: keyboard },
      { chat_id: chatId, message_id: query.message.message_id }).catch(() => {});
    return;
  }

  // Task page navigation
  if (data === "tp_noop") {
    return bot.answerCallbackQuery(query.id);
  }
  if (data.startsWith("tp_")) {
    const page = parseInt(data.slice(3), 10);
    if (isNaN(page)) return bot.answerCallbackQuery(query.id);
    const result = await buildTasksPage(page);
    bot.answerCallbackQuery(query.id);
    if (!result) {
      return bot.editMessageText("✅ No pending tasks! All caught up.", {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: "HTML",
      }).catch(() => {});
    }
    return bot.editMessageText(result.text, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: result.keyboard },
    }).catch(() => {});
  }

  // Mark task done
  if (!data.startsWith("done_")) return;
  const id = parseInt(data.split("_")[1]);
  if (isNaN(id)) return;
  await markTaskDone(id);
  bot.answerCallbackQuery(query.id, { text: `✅ Task #${id} marked done!` });
  // Refresh the page with updated task list
  const currentText = query.message.text || "";
  const pageMatch = currentText.match(/page (\d+)\/(\d+)/);
  const currentPage = pageMatch ? parseInt(pageMatch[1], 10) - 1 : 0;
  const result = await buildTasksPage(currentPage);
  if (!result) {
    bot.editMessageText("✅ All tasks done! Great work.", {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: "HTML",
    }).catch(() => {});
    return;
  }
  bot.editMessageText(result.text, {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: result.keyboard },
  }).catch(() => {});
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
        const deadline = t.deadline ? `  📅 <i>${t.deadline}</i>` : "";
        lines.push(`  • ${t.task}${deadline}  <code>/done ${t.id}</code>`);
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
    const deadline = t.deadline ? `  📅 <i>${t.deadline}</i>` : "";
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

// /addtask — start multi-step wizard, or one-liner: Person | Task | Deadline
bot.onText(/\/addtask(?:\s+([\s\S]+))?/, async (msg, match) => {
  const input = match && match[1] ? match[1].trim() : "";
  if (!input) {
    // Start interactive wizard
    addTaskSessions.set(msg.chat.id, { step: "person" });
    return bot.sendMessage(msg.chat.id,
      "➕ <b>New Task — Step 1/3</b>\n\n<b>Who is this task for?</b>\n<i>Type the person's name, or /cancel to abort.</i>",
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
    `✅ <b>Task added!</b>\n\n👤 <b>${person}</b>\n📋 ${task}${deadline ? `\n📅 ${deadline}` : ""}`,
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
    const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: tz });
    for (const [key, dayEvents] of Object.entries(grouped).sort()) {
      const isToday = key === todayKey;
      const label = new Date(key + "T12:00:00Z").toLocaleDateString("en-IN", {
        weekday: "long", day: "numeric", month: "short", timeZone: "UTC",
      });
      lines.push(isToday ? `<b>📍 ${label} — Today</b>` : `<b>📅 ${label}</b>`);
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
    // Auto-index into RAG (non-blocking)
    indexText(noteText, "meeting_note", meetings[0].id, meetings[0].subject).catch(() => {});
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

// /addmember <name> | <email> — save a team member's email for meeting invites
bot.onText(/\/addmember(?:\s+([\s\S]+))?/, async (msg, match) => {
  const input = match && match[1] ? match[1].trim() : "";
  if (!input || !input.includes("|")) {
    // Start wizard — wait for next message
    addMemberSessions.set(msg.chat.id, true);
    return bot.sendMessage(msg.chat.id,
      "<b>👤 Add Team Member</b>\n\nReply with:\n<code>Name | email@company.com</code>\n\nExample:\n<code>Alice | alice@zunoverse.org</code>\n\n<i>Type /cancel to abort.</i>",
      { parse_mode: "HTML" });
  }
  const [name, email] = input.split("|").map((s) => s.trim());
  if (!name || !email || !email.includes("@")) {
    return bot.sendMessage(msg.chat.id, "❌ Invalid format. Use: <code>/addmember Name | email@company.com</code>", { parse_mode: "HTML" });
  }
  await addTeamMember(name, email);
  bot.sendMessage(msg.chat.id,
    `✅ <b>${name}</b> (<code>${email}</code>) saved to team.\n\nThey'll appear in the attendee picker when you use /meet.`,
    { parse_mode: "HTML" });
});

// /members — list all saved team members
bot.onText(/\/members/, async (msg) => {
  const members = await getAllMembers().catch(() => []);
  if (!members.length) {
    return bot.sendMessage(msg.chat.id,
      "📭 No team members saved yet.\n\nAdd one:\n<code>/addmember Name | email@company.com</code>",
      { parse_mode: "HTML" });
  }
  const lines = ["<b>👥 Team Members</b>", ""];
  members.forEach((m, i) => lines.push(`${i + 1}. <b>${m.name}</b> — <code>${m.email}</code>`));
  lines.push("", "<i>Remove with /removemember &lt;name&gt;</i>");
  bot.sendMessage(msg.chat.id, lines.join("\n"), { parse_mode: "HTML" });
});

// /removemember <name> — remove a saved team member
bot.onText(/\/removemember(?:\s+(.+))?/, async (msg, match) => {
  const name = match && match[1] ? match[1].trim() : "";
  if (!name) {
    return bot.sendMessage(msg.chat.id, "Usage: <code>/removemember &lt;name&gt;</code>", { parse_mode: "HTML" });
  }
  const count = await removeMemberByName(name).catch(() => 0);
  if (!count) {
    return bot.sendMessage(msg.chat.id, `❌ No member found with name "<b>${name}</b>". Check /members for exact names.`, { parse_mode: "HTML" });
  }
  bot.sendMessage(msg.chat.id, `✅ <b>${name}</b> removed from team.`, { parse_mode: "HTML" });
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

// /addtask wizard step handler
function handleAddTaskWizard(msg, session, text) {
  const chatId = msg.chat.id;
  if (session.step === "person") {
    session.person = text.trim();
    session.step = "task";
    return bot.sendMessage(chatId,
      `👤 <b>${session.person}</b>\n\n➕ <b>Step 2/3 — What's the task?</b>\n<i>Describe what needs to be done.</i>`,
      { parse_mode: "HTML" });
  }
  if (session.step === "task") {
    session.task = text.trim();
    session.step = "deadline";
    return bot.sendMessage(chatId,
      `📋 <b>${session.task}</b>\n\n➕ <b>Step 3/3 — Deadline?</b>\n<i>e.g. "by Friday", "10 Mar", or type <code>none</code> to skip.</i>`,
      { parse_mode: "HTML" });
  }
  if (session.step === "deadline") {
    const deadline = /^(none|skip|-)$/i.test(text.trim()) ? "" : text.trim();
    addTaskSessions.delete(chatId);
    saveTask("manual", "Manual Task", session.person, session.task, deadline)
      .then(() => bot.sendMessage(chatId,
        `✅ <b>Task saved!</b>\n\n👤 <b>${session.person}</b>\n📋 ${session.task}${deadline ? `\n📅 ${deadline}` : ""}\n\n<i>View all tasks with /tasks</i>`,
        { parse_mode: "HTML" }))
      .catch((err) => bot.sendMessage(chatId, "❌ Failed to save task: " + err.message));
  }
}

// Message handler: route to active wizard, otherwise log
// ── PDF → RAG docs handler ───────────────────────────────────────────────────
bot.on("message", async (msg) => {
  if (msg.document && msg.document.mime_type === "application/pdf") {
    const chatId = msg.chat.id;
    const fileName = msg.document.file_name || "document.pdf";
    bot.sendMessage(chatId, `📄 <b>Processing <code>${fileName}</code>…</b>\nExtracting text and generating RAG-ready docs. This may take a moment.`, { parse_mode: "HTML" });
    try {
      const fileLink = await bot.getFileLink(msg.document.file_id);
      const https = require("https");
      const http  = require("http");
      const fileBuffer = await new Promise((resolve, reject) => {
        const chunks = [];
        const lib = fileLink.startsWith("https") ? https : http;
        lib.get(fileLink, (res) => {
          res.on("data", (c) => chunks.push(c));
          res.on("end",  () => resolve(Buffer.concat(chunks)));
          res.on("error", reject);
        }).on("error", reject);
      });
      const { zipPath, meta } = await convertPdf(fileBuffer, fileName);
      await bot.sendDocument(chatId, zipPath, {
        caption: [
          `✅ <b>RAG Docs ready</b> — <code>${fileName}</code>`,
          `📑 ${meta.pages} page${meta.pages !== 1 ? "s" : ""}  |  🧩 ${meta.chunks} chunks  |  📝 ${meta.chars.toLocaleString()} chars`,
          "",
          "<b>Inside the ZIP:</b>",
          "• <code>llms-full.txt</code> — complete text",
          "• <code>llms-medium.txt</code> — first 4 000 chars",
          "• <code>llms-small.txt</code> — first 1 000 chars",
          "• <code>chunks/</code> — 800-char overlapping chunks for vector ingestion",
          "• <code>metadata.json</code> + <code>README.md</code>",
        ].join("\n"),
        parse_mode: "HTML",
      });
      cleanup(zipPath);
    } catch (err) {
      logger.error("PDF LLM conversion error:", err);
      bot.sendMessage(chatId, `❌ Could not process PDF: ${err.message}`);
    }
    return;
  }
});

bot.on("message", async (msg) => {
  const text = (msg.text || "").trim();
  if (!text || text.startsWith("/")) return;

  const meetSession = meetSessions.get(msg.chat.id);
  if (meetSession) { handleMeetWizard(msg, meetSession, text); return; }

  const cancelSession = cancelSessions.get(msg.chat.id);
  if (cancelSession) { handleCancelSelection(msg, cancelSession, text); return; }

  const addTaskSession = addTaskSessions.get(msg.chat.id);
  if (addTaskSession) { handleAddTaskWizard(msg, addTaskSession, text); return; }

  if (addMemberSessions.has(msg.chat.id)) {
    addMemberSessions.delete(msg.chat.id);
    if (!text.includes("|")) {
      return bot.sendMessage(msg.chat.id,
        "❌ Invalid format. Expected: <code>Name | email@company.com</code>\n\nTry /addmember again.",
        { parse_mode: "HTML" });
    }
    const [name, email] = text.split("|").map((s) => s.trim());
    if (!name || !email || !email.includes("@")) {
      return bot.sendMessage(msg.chat.id,
        "❌ Invalid format. Expected: <code>Name | email@company.com</code>\n\nTry /addmember again.",
        { parse_mode: "HTML" });
    }
    await addTeamMember(name, email);
    return bot.sendMessage(msg.chat.id,
      `✅ <b>${name}</b> (<code>${email}</code>) saved to team.\n\nThey'll appear in the attendee picker when you use /meet.`,
      { parse_mode: "HTML" });
  }

  // Natural-language routing — activates for non-command messages in private chats
  if (msg.chat.type === "private") {
    try {
      const nl = await parseNaturalLanguageCommand(text);
      if (nl && nl.command && nl.confidence >= 0.65) {
        await bot.sendMessage(msg.chat.id,
          `💡 <b>Got it!</b> Running: <code>${nl.command}${nl.args ? " " + nl.args : ""}</code>`,
          { parse_mode: "HTML" });
        bot.emit("message", { ...msg, text: nl.command + (nl.args ? " " + nl.args : "") });
        return;
      }
    } catch (_) { /* Gemini unavailable — fall through */ }
    bot.sendMessage(msg.chat.id,
      "🤔 I didn\u2019t catch that. Try /help to see all commands, or /ask to chat about meetings.",
      { parse_mode: "HTML" });
    return;
  }

  logger.info(`[${msg.chat.type}] ${msg.from.username || msg.from.first_name}: ${text}`);
});

// ══════════════════════════════════════════════════════════════════════════════
// TEAM WORKSPACE — team tasks (visible to all)
// ══════════════════════════════════════════════════════════════════════════════

// /teamtask [person |] task [| deadline] — save a team task
bot.onText(/\/teamtask(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const input = match && match[1] ? match[1].trim() : null;
  if (!input) {
    return bot.sendMessage(chatId,
      "👥 <b>Add a team task:</b>\n<code>/teamtask Task text</code>\n<code>/teamtask Person | Task text | deadline</code>\n\nExamples:\n• <code>/teamtask Prepare demo slides</code>\n• <code>/teamtask Alice | Update API docs | 2026-03-20</code>",
      { parse_mode: "HTML" });
  }
  const parts = input.split("|").map((s) => s.trim());
  let person = "Team", task, deadline = "";
  if (parts.length >= 3) {
    [person, task, deadline] = parts;
  } else if (parts.length === 2) {
    // Could be "person | task" or "task | deadline" — if 2nd part looks like a date, treat as deadline
    if (/^\d{4}-\d{2}-\d{2}$/.test(parts[1])) {
      task = parts[0]; deadline = parts[1];
    } else {
      person = parts[0]; task = parts[1];
    }
  } else {
    task = parts[0];
  }
  if (!task) {
    return bot.sendMessage(chatId, "❌ Task text is required.");
  }
  await saveTeamTask(person, task, deadline);
  // Auto-index into RAG knowledge base (non-blocking)
  const chunkText = `Team task — ${person}: ${task}${deadline ? ` (due ${deadline})` : ""}`;
  indexText(chunkText, "team_task", `manual_${Date.now()}`, `Team Task`).catch(() => {});
  bot.sendMessage(chatId,
    `👥 <b>Team task saved</b>\n\n👤 Assigned to: <b>${person}</b>\n📋 ${task}${deadline ? `\n📅 Due: <b>${deadline}</b>` : ""}\n\n<i>Visible to the whole team. Use /tasks to view.</i>`,
    { parse_mode: "HTML" });
});

// /teamtasks — alias for /tasks showing all pending team tasks
bot.onText(/\/teamtasks/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const tasks = await getPendingTasks();
    if (!tasks.length) {
      return bot.sendMessage(chatId, "👥 <b>Team Tasks</b>\n\nNo pending team tasks! 🎉", { parse_mode: "HTML" });
    }
    const lines = tasks.slice(0, 20).map((t, i) =>
      `${i + 1}. <b>${t.person}</b>: ${t.task}${t.deadline ? ` — 📅 <i>${t.deadline}</i>` : ""} <code>[#${t.id}]</code>`
    );
    bot.sendMessage(chatId,
      `👥 <b>Team Tasks</b>  (${tasks.length} pending)\n\n${lines.join("\n")}\n\n✅ Mark done: <code>/done #id</code>`,
      { parse_mode: "HTML" });
  } catch (err) {
    logger.error("/teamtasks error:", err);
    bot.sendMessage(chatId, "❌ Could not load team tasks.");
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PRIVATE MESSAGE HELPER — sends sensitive replies via DM, not in group chat
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Send a message privately (DM). If the command was used in a group:
 *  - Try to DM the user
 *  - Post a brief notice in the group
 *  - If DM fails (user never started the bot), show a "please start the bot" notice instead
 */
async function sendPrivate(userId, groupChatId, firstName, text, opts = {}) {
  const isGroup = String(groupChatId) !== String(userId);
  if (!isGroup) {
    return bot.sendMessage(userId, text, opts);
  }
  try {
    await bot.sendMessage(userId, text, opts);
    bot.sendMessage(groupChatId,
      `🔐 <b>${firstName}</b>, I've sent your details privately — check your DM with me.`,
      { parse_mode: "HTML" });
  } catch (_) {
    const botUsername = process.env.TELEGRAM_BOT_USERNAME || "ClawMeetBot";
    bot.sendMessage(groupChatId,
      `⚠️ <b>${firstName}</b>, I can't message you privately yet.\n` +
      `Please start the bot first and then run the command again:\n` +
      `<a href="https://t.me/${botUsername}">t.me/${botUsername}</a>`,
      { parse_mode: "HTML", disable_web_page_preview: true });
  }
}

// /myprofile — show your personal profile and dashboard link
bot.onText(/\/myprofile/, async (msg) => {
  const chatId = msg.chat.id;
  const from = msg.from;
  try {
    await upsertUser(from.id, from.first_name + (from.last_name ? " " + from.last_name : ""), from.username);
    const token = await generateLinkToken(from.id);
    const base = process.env.RENDER_EXTERNAL_URL || "http://localhost:" + (process.env.PORT || 3000);
    const loginUrl = `${base}/dashboard/login?token=${encodeURIComponent(token)}`;
    const text =
      `👤 <b>My Profile</b>\n\n` +
      `🙋 ${from.first_name}${from.username ? ` (@${from.username})` : ""}\n` +
      `🆔 Telegram ID: <code>${from.id}</code>\n\n` +
      `🔑 <b>Dashboard Login Token:</b>\n<code>${token}</code>\n\n` +
      `🔗 <b>One-click login:</b>\n<a href="${loginUrl}">${base}/dashboard/login</a>\n\n` +
      `<i>Tap the link above to go directly to your personal dashboard.</i>`;
    await sendPrivate(from.id, chatId, from.first_name, text,
      { parse_mode: "HTML", disable_web_page_preview: true });
  } catch (err) {
    logger.error("/myprofile error:", err);
    bot.sendMessage(chatId, "❌ Could not load profile.");
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// PERSONAL WORKSPACE
// ══════════════════════════════════════════════════════════════════════════════

// /mytask <text> [| deadline] — save a private task
bot.onText(/\/mytask(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const from = msg.from;
  const telegramId = from.id;
  const input = match && match[1] ? match[1].trim() : null;
  if (!input) {
    return bot.sendMessage(chatId,
      "📝 <b>Add a personal task:</b>\n<code>/mytask Task text | optional deadline</code>\n\nExamples:\n• <code>/mytask Review proposal</code>\n• <code>/mytask Submit report | 2026-03-15</code>",
      { parse_mode: "HTML" });
  }
  const parts = input.split("|");
  const task = parts[0].trim();
  const deadline = parts[1] ? parts[1].trim() : "";
  await addPersonalTask(telegramId, task, deadline);
  await sendPrivate(telegramId, chatId, from.first_name,
    `✅ <b>Personal task saved</b> 🔒\n\n📋 ${task}${deadline ? `\n📅 Due: <b>${deadline}</b>` : ""}\n\n<i>Only you can see this. Use /mytasks to view all.</i>`,
    { parse_mode: "HTML" });
});

// /mytasks — list your pending personal tasks
bot.onText(/\/mytasks/, async (msg) => {
  const chatId = msg.chat.id;
  const from = msg.from;
  const telegramId = from.id;
  try {
    const tasks = await getPersonalTasks(telegramId);
    const text = !tasks.length
      ? "📋 <b>My Tasks</b> 🔒\n\nNo pending personal tasks.\n\nAdd one with /mytask"
      : `📋 <b>My Tasks</b> 🔒  (${tasks.length} pending)\n\n` +
        tasks.map((t, i) => `${i + 1}. ${t.task}${t.deadline ? ` — 📅 <i>${t.deadline}</i>` : ""} <code>[#${t.id}]</code>`).join("\n") +
        "\n\n✅ Mark done: <code>/mydonetask #id</code>\n🗑 Delete: <code>/mydeltask #id</code>";
    await sendPrivate(telegramId, chatId, from.first_name, text, { parse_mode: "HTML" });
  } catch (err) {
    logger.error("/mytasks error:", err);
    bot.sendMessage(chatId, "❌ Could not load personal tasks.");
  }
});

// /mydonetask <id> — mark a personal task done
bot.onText(/\/mydonetask\s+#?(\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const from = msg.from;
  const id = parseInt(match[1], 10);
  const affected = await donePersonalTask(id, from.id);
  const text = affected
    ? `✅ Personal task <b>#${id}</b> marked done.`
    : `❌ Task #${id} not found or doesn't belong to you.`;
  await sendPrivate(from.id, chatId, from.first_name, text, { parse_mode: "HTML" });
});

// /mydeltask <id> — delete a personal task
bot.onText(/\/mydeltask\s+#?(\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const from = msg.from;
  const id = parseInt(match[1], 10);
  const affected = await deletePersonalTask(id, from.id);
  const text = affected
    ? `🗑 Personal task <b>#${id}</b> deleted.`
    : `❌ Task #${id} not found or doesn't belong to you.`;
  await sendPrivate(from.id, chatId, from.first_name, text, { parse_mode: "HTML" });
});

// /note <text> — save a private note
bot.onText(/\/note(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const from = msg.from;
  const telegramId = from.id;
  const input = match && match[1] ? match[1].trim() : null;
  if (!input) {
    return bot.sendMessage(chatId,
      "🗒 <b>Save a personal note:</b>\n<code>/note Your note text here</code>\n\nExample:\n• <code>/note AI automation idea for onboarding workflow</code>",
      { parse_mode: "HTML" });
  }
  await addPersonalNote(telegramId, input);
  // Auto-index into RAG knowledge base (non-blocking)
  indexText(input, "personal_note", String(telegramId), `User ${telegramId} note`).catch(() => {});
  await sendPrivate(telegramId, chatId, from.first_name,
    `🗒 <b>Note saved</b> 🔒\n\n"${input}"\n\n<i>Only you can see this. Use /mynotes to view all.</i>`,
    { parse_mode: "HTML" });
});

// /mynotes — list your personal notes
bot.onText(/\/mynotes/, async (msg) => {
  const chatId = msg.chat.id;
  const from = msg.from;
  const telegramId = from.id;
  try {
    const notes = await getPersonalNotes(telegramId);
    const text = !notes.length
      ? "🗒 <b>My Notes</b> 🔒\n\nNo notes saved yet.\n\nAdd one with /note"
      : `🗒 <b>My Notes</b> 🔒  (${notes.length})\n\n` +
        notes.map((n, i) => {
          const date = n.created_at ? n.created_at.substring(0, 10) : "";
          return `${i + 1}. ${n.note}${date ? ` <i>(${date})</i>` : ""} <code>[#${n.id}]</code>`;
        }).join("\n\n") +
        "\n\n🗑 Delete: <code>/mydelnote #id</code>";
    await sendPrivate(telegramId, chatId, from.first_name, text, { parse_mode: "HTML" });
  } catch (err) {
    logger.error("/mynotes error:", err);
    bot.sendMessage(chatId, "❌ Could not load notes.");
  }
});

// /mydelnote <id> — delete a personal note
bot.onText(/\/mydelnote\s+#?(\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const from = msg.from;
  const id = parseInt(match[1], 10);
  const affected = await deletePersonalNote(id, from.id);
  const text = affected
    ? `🗑 Note <b>#${id}</b> deleted.`
    : `❌ Note #${id} not found or doesn't belong to you.`;
  await sendPrivate(from.id, chatId, from.first_name, text, { parse_mode: "HTML" });
});

// ══════════════════════════════════════════════════════════════════════════════
// RAG KNOWLEDGE WORKSPACE
// ══════════════════════════════════════════════════════════════════════════════

// /ask <question> — query the knowledge base with RAG
bot.onText(/\/ask(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const question = match && match[1] ? match[1].trim() : null;
  if (!question) {
    return bot.sendMessage(chatId,
      "🔍 <b>Ask the Knowledge Base</b>\n\n" +
      "<code>/ask What was decided about the Q4 budget?</code>\n" +
      "<code>/ask Who is handling the product demo?</code>\n" +
      "<code>/ask What does the contract say about payments?</code>\n\n" +
      "<i>Searches across all meeting notes, transcripts, personal notes, team tasks, and uploaded PDFs.</i>\n\n" +
      "💡 For semantic search, set <code>HF_TOKEN</code> in settings. Currently using keyword search.",
      { parse_mode: "HTML" });
  }

  // Show typing indicator
  bot.sendChatAction(chatId, "typing");

  try {
    const { answer, sources, semantic } = await askKnowledge(question);

    const sourceList = sources.length
      ? `\n\n📎 <b>Sources:</b>\n${sources.map((s) => `• ${s}`).join("\n")}`
      : "";
    const mode = semantic ? "🧠 <i>Semantic search</i>" : "🔤 <i>Keyword search</i>";

    bot.sendMessage(chatId,
      `🔍 <b>Knowledge Base Answer</b>\n${mode}\n\n${answer}${sourceList}`,
      { parse_mode: "HTML" });
  } catch (err) {
    logger.error("/ask error:", err);
    bot.sendMessage(chatId, "❌ Could not query the knowledge base.");
  }
});

// /askstats — show knowledge base statistics
bot.onText(/\/askstats/, async (msg) => {
  const chatId = msg.chat.id;
  try {
    const { getAllChunks } = require("./dbService");
    const chunks = await getAllChunks();
    if (chunks.length === 0) {
      return bot.sendMessage(chatId,
        "📚 <b>Knowledge Base</b>\n\nEmpty — no content indexed yet.\n\nContent is auto-indexed when you save notes, tasks, and transcripts.",
        { parse_mode: "HTML" });
    }
    const byType = {};
    for (const c of chunks) {
      byType[c.source_type] = (byType[c.source_type] || 0) + 1;
    }
    const breakdown = Object.entries(byType)
      .map(([type, count]) => `• ${type}: <b>${count}</b> chunks`)
      .join("\n");
    const hasEmbeddings = chunks.some((c) => c.embedding);
    bot.sendMessage(chatId,
      `📚 <b>Knowledge Base Stats</b>\n\nTotal chunks: <b>${chunks.length}</b>\n${breakdown}\n\n` +
      `Search mode: ${hasEmbeddings ? "🧠 Semantic (HF embeddings)" : "🔤 Keyword fallback"}\n\n` +
      `Use <code>/ask your question</code> to query.`,
      { parse_mode: "HTML" });
  } catch (err) {
    logger.error("/askstats error:", err);
    bot.sendMessage(chatId, "❌ Could not load knowledge base stats.");
  }
});

bot.on("polling_error", (err) => logger.error("Polling error:", err));

process.on("unhandledRejection", (reason) => logger.error("Unhandled Rejection:", reason));
process.on("uncaughtException", (err) => logger.error("Uncaught Exception:", err));

module.exports = { bot, sendToGroup, getTelegramProfilePhotoFileUrl };
