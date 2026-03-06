const cron = require("node-cron");
const { sendToGroup } = require("./telegramService");
const { getScheduledMeetings } = require("./calendarService");
const { saveMeeting, hasReminderBeenSent, markReminderSent } = require("./dbService");
const { processMeetingEnd } = require("./summaryService");

const TZ = () => process.env.TIMEZONE || "Asia/Kolkata";

/** Format a time string in local timezone */
function fmtTime(dateStr) {
  return new Date(dateStr.replace(/Z?$/, "Z")).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ(),
  });
}

function fmtDate(dateStr) {
  return new Date(dateStr.replace(/Z?$/, "Z")).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: TZ(),
  });
}

function joinUrl(event) {
  return (event.onlineMeeting && event.onlineMeeting.joinUrl) || event.webLink || "(no link)";
}

/** Build reminder message */
function buildReminderMessage(event, label, emoji) {
  const subject = (event.subject || "Meeting").trim();
  const start   = event.start.dateTime || event.start.date;
  return [
    `${emoji} <b>${label}</b>`,
    ``,
    `📅 <b>${subject}</b>`,
    `📆 ${fmtDate(start)}`,
    `⏰ ${fmtTime(start)}`,
    ``,
    `🔗 Join: ${joinUrl(event)}`,
  ].join("\n");
}

/**
 * Send whichever reminder is due for a single event.
 * Windows:
 *   1day  → 23h 45min .. 24h 15min before start
 *   1hour → 50min .. 70min before start
 *   10min → 7min  .. 13min before start
 */
async function checkReminders(event, nowMs) {
  const startMs = new Date((event.start.dateTime || event.start.date).replace(/Z?$/, "Z")).getTime();
  const endMs   = new Date((event.end.dateTime   || event.end.date  ).replace(/Z?$/, "Z")).getTime();
  const diffMin = (startMs - nowMs) / 60000;

  if (diffMin >= 1425 && diffMin <= 1455 && !(await hasReminderBeenSent(event.id, "1day"))) {
    sendToGroup(buildReminderMessage(event, "Meeting Tomorrow", "🔔"));
    await markReminderSent(event.id, "1day");
    console.log(`🔔 1-day reminder sent: ${event.subject}`);
  }

  if (diffMin >= 50 && diffMin <= 70 && !(await hasReminderBeenSent(event.id, "1hour"))) {
    sendToGroup(buildReminderMessage(event, "Meeting in 1 Hour", "⏰"));
    await markReminderSent(event.id, "1hour");
    console.log(`⏰ 1-hour reminder sent: ${event.subject}`);
  }

  if (diffMin >= 7 && diffMin <= 13 && !(await hasReminderBeenSent(event.id, "10min"))) {
    sendToGroup(buildReminderMessage(event, "Meeting Starts in 10 Minutes!", "🚨"));
    await markReminderSent(event.id, "10min");
    console.log(`🚨 10-min reminder sent: ${event.subject}`);
  }

  // Post-meeting: trigger summary 5-30 minutes after meeting ends
  const minutesSinceEnd = (nowMs - endMs) / 60000;
  if (minutesSinceEnd >= 5 && minutesSinceEnd <= 30) {
    processMeetingEnd(event).catch((e) => console.error("Summary error:", e.message));
  }
}

function startScheduler() {
  // Run every minute — fetch 30 min past → 25 hours ahead
  cron.schedule("* * * * *", async () => {
    const events = await getScheduledMeetings(-30, 1500);
    for (const event of events) {
      await saveMeeting(event);
      await checkReminders(event, Date.now());
    }
  });

  console.log("✅ Scheduler started — smart reminders active (10min / 1hr / 1day)");
}

module.exports = { startScheduler };
