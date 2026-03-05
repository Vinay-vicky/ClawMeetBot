const { generateMeetingSummary } = require("./aiSummaryService");
const fetch = require("node-fetch");
const { ClientSecretCredential } = require("@azure/identity");
const { saveSummary, hasReminderBeenSent, markReminderSent } = require("./dbService");
const { sendToGroup } = require("./telegramService");

/** Get a Graph API access token */
async function getToken() {
  const credential = new ClientSecretCredential(
    process.env.TEAMS_TENANT_ID,
    process.env.TEAMS_APP_ID,
    process.env.TEAMS_APP_PASSWORD
  );
  const res = await credential.getToken("https://graph.microsoft.com/.default");
  return res.token;
}

/** Try to fetch the transcript text for a meeting via Graph API */
async function fetchTranscript(joinUrl) {
  try {
    const token = await getToken();
    const userEmail = process.env.OUTLOOK_USER_EMAIL;

    // Step 1: Find the online meeting by joinWebUrl
    const filterUrl = `https://graph.microsoft.com/v1.0/users/${userEmail}/onlineMeetings?$filter=JoinWebUrl eq '${encodeURIComponent(joinUrl)}'`;
    const meetingRes = await fetch(filterUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meetingData = await meetingRes.json();
    const meeting = meetingData.value && meetingData.value[0];
    if (!meeting) return null;

    // Step 2: Get transcripts list
    const transRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${userEmail}/onlineMeetings/${meeting.id}/transcripts`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const transData = await transRes.json();
    const transcript = transData.value && transData.value[0];
    if (!transcript) return null;

    // Step 3: Get transcript content
    const contentRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${userEmail}/onlineMeetings/${meeting.id}/transcripts/${transcript.id}/content?$format=text/vtt`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const text = await contentRes.text();
    // Strip VTT timestamps — keep just spoken content
    return text
      .split("\n")
      .filter((l) => l && !l.match(/^\d/) && !l.match(/-->/) && l !== "WEBVTT")
      .join(" ")
      .substring(0, 4000); // OpenAI token limit safety
  } catch (err) {
    console.error("⚠ Transcript fetch failed:", err.message);
    return null;
  }
}

/** Generate an AI summary using Gemini */
async function generateSummary(subject, transcriptText) {
  return await generateMeetingSummary(transcriptText, subject);
}

/**
 * Check if any tracked meetings have just ended and post a summary.
 * Called by the scheduler after meeting end time passes.
 */
async function processMeetingEnd(event) {
  const reminderType = "summary";
  if (hasReminderBeenSent(event.id, reminderType)) return;

  const subject = (event.subject || "Meeting").trim();
  const joinUrl = (event.onlineMeeting && event.onlineMeeting.joinUrl) || event.webLink;

  console.log(`📝 Meeting ended: ${subject} — generating summary...`);
  markReminderSent(event.id, reminderType);

  // Try to get transcript
  let summaryText = null;
  if (joinUrl) {
    const transcript = await fetchTranscript(joinUrl);
    if (transcript) {
      summaryText = await generateSummary(subject, transcript);
      saveSummary(event.id, summaryText);
    }
  }

  const tz = process.env.TIMEZONE || "Asia/Kolkata";
  const endTime = new Date((event.end.dateTime || event.end.date).replace(/Z?$/, "Z"));
  const endStr = endTime.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: tz });

  const message = summaryText
    ? [
        `📝 <b>Meeting Summary: ${subject}</b>`,
        ``,
        `🕒 Ended at: ${endStr}`,
        ``,
        summaryText
          .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
          .replace(/^[-•] /gm, "• "),
      ].join("\n")
    : [
        `✅ <b>Meeting Ended: ${subject}</b>`,
        ``,
        `🕒 Ended at: ${endStr}`,
        ``,
        `<i>No transcript available. Enable recording in Teams to get AI summaries.</i>`,
      ].join("\n");

  sendToGroup(message);
}

module.exports = { processMeetingEnd };
