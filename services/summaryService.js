const { analyzeMeeting, generateMeetingSummary } = require("./aiSummaryService");
const fetch = require("node-fetch");
const { ClientSecretCredential } = require("@azure/identity");
const { saveSummary, hasReminderBeenSent, markReminderSent, saveTask } = require("./dbService");
const { sendToGroup, bot } = require("./telegramService");

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
    // Parse VTT preserving speaker names: "<v Speaker Name>text</v>"
    const lines = [];
    let currentSpeaker = "";
    for (const line of text.split("\n")) {
      if (line.includes("<v ")) {
        const speakerMatch = line.match(/<v ([^>]+)>/);
        if (speakerMatch) currentSpeaker = speakerMatch[1];
        const spoken = line.replace(/<[^>]+>/g, "").trim();
        if (spoken) lines.push(`${currentSpeaker}: ${spoken}`);
      } else if (line && !line.match(/^\d/) && !line.match(/-->/) && line !== "WEBVTT") {
        if (line.trim()) lines.push(line.trim());
      }
    }
    return lines.join("\n").substring(0, 4000);
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
  if (await hasReminderBeenSent(event.id, reminderType)) return;

  const subject = (event.subject || "Meeting").trim();
  const joinUrl = (event.onlineMeeting && event.onlineMeeting.joinUrl) || event.webLink;

  console.log(`📝 Meeting ended: ${subject} — generating summary...`);
  await markReminderSent(event.id, reminderType);

  const tz = process.env.TIMEZONE || "Asia/Kolkata";
  const endTime = new Date((event.end.dateTime || event.end.date).replace(/Z?$/, "Z"));
  const endStr = endTime.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: tz });

  // Try to fetch transcript and run Gemini analysis
  let analysis = null;
  if (joinUrl) {
    const transcript = await fetchTranscript(joinUrl);
    if (transcript) {
      analysis = await analyzeMeeting(transcript, subject);
      if (analysis) {
        // Build plain text summary for DB storage
        const summaryText = [
          analysis.keyPoints?.map((p) => `• ${p}`).join("\n") || "",
          analysis.tasks?.map((t) => `• ${t.person} → ${t.task}`).join("\n") || "",
        ].filter(Boolean).join("\n");
        await saveSummary(event.id, summaryText);

        // Save each task to DB
        if (analysis.tasks?.length) {
          for (const t of analysis.tasks) {
            await saveTask(event.id, subject, t.person, t.task, t.deadline);
          }
        }
      }
    }
  }

  if (analysis) {
    // ── Send summary message ───────────────────────────────────
    const summaryLines = [
      `📝 <b>Meeting Summary: ${subject}</b>`,
      `🕒 Ended at: ${endStr}`,
      ``,
    ];
    if (analysis.keyPoints?.length) {
      summaryLines.push(`<b>Key Points:</b>`);
      analysis.keyPoints.forEach((p) => summaryLines.push(`• ${p}`));
    }
    if (analysis.decisions?.length) {
      summaryLines.push(``, `<b>Decisions Made:</b>`);
      analysis.decisions.forEach((d) => summaryLines.push(`• ${d}`));
    }
    sendToGroup(summaryLines.join("\n"));

    // ── Send individual task assignment messages ───────────────
    if (analysis.tasks?.length) {
      // Small delay so summary arrives first
      setTimeout(() => {
        const taskLines = [
          `📌 <b>Task Assignments — ${subject}</b>`,
          ``,
        ];
        analysis.tasks.forEach((t, i) => {
          const deadline = t.deadline ? `\n   ⏳ Deadline: ${t.deadline}` : "";
          taskLines.push(`${i + 1}. <b>${t.person}</b>\n   📋 ${t.task}${deadline}`);
          taskLines.push(``);
        });
        taskLines.push(`<i>Reply /tasks to see all pending tasks</i>`);
        sendToGroup(taskLines.join("\n"));
      }, 3000);
    }
  } else {
    // No transcript — send basic ended message
    sendToGroup([
      `✅ <b>Meeting Ended: ${subject}</b>`,
      `🕒 Ended at: ${endStr}`,
      ``,
      `<i>Enable recording in Teams settings to get automatic AI summaries.</i>`,
    ].join("\n"));
  }

  // Feedback poll — sent 10 seconds after the end message
  setTimeout(() => {
    const groupId = process.env.TELEGRAM_GROUP_ID;
    if (!groupId) return;
    bot.sendPoll(
      groupId,
      `📊 How was the meeting: "${subject}"?`,
      ["👍 Great", "👌 OK", "👎 Could be better"],
      { is_anonymous: false }
    ).catch((e) => console.error("❌ Poll send failed:", e.message));
  }, 10000);
}

module.exports = { processMeetingEnd };
