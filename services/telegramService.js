const TelegramBot = require("node-telegram-bot-api");
const { formatMeetingMessage } = require("../utils/formatter");
const { getRecentMeetings } = require("./dbService");

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
    "<b>ClawMeetBot Commands</b>",
    "",
    "/meet — Generate a random meeting link",
    "/next — Show next scheduled meeting",
    "/history — Show last 5 meetings",
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
