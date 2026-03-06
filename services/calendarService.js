const { ClientSecretCredential } = require("@azure/identity");
const fetch = require("node-fetch");

// Track already-notified event IDs to avoid sending duplicates
const notifiedEvents = new Set();

/**
 * Fetch upcoming calendar events from Microsoft Graph API.
 * Returns events starting within the next `windowMinutes` minutes.
 */
async function getUpcomingMeetings(windowMinutes = 15) {
  const tenantId = process.env.TEAMS_TENANT_ID;
  const clientId = process.env.TEAMS_APP_ID;
  const clientSecret = process.env.TEAMS_APP_PASSWORD;
  const userEmail = process.env.OUTLOOK_USER_EMAIL;

  if (!tenantId || !clientId || !clientSecret || !userEmail) {
    console.error("❌ Missing Graph API credentials in .env");
    return [];
  }

  try {
    // Get access token
    const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    const tokenResponse = await credential.getToken("https://graph.microsoft.com/.default");
    const accessToken = tokenResponse.token;

    // Build time range
    const now = new Date();
    const windowEnd = new Date(now.getTime() + windowMinutes * 60 * 1000);

    const startTime = now.toISOString();
    const endTime = windowEnd.toISOString();

    const url = `https://graph.microsoft.com/v1.0/users/${userEmail}/calendarView?startDateTime=${startTime}&endDateTime=${endTime}&$select=id,subject,start,end,onlineMeeting,webLink&$orderby=start/dateTime`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("❌ Graph API error:", err);
      return [];
    }

    const data = await response.json();
    const events = data.value || [];

    // Filter only new events we haven't notified about yet
    const newEvents = events.filter((e) => !notifiedEvents.has(e.id));
    newEvents.forEach((e) => notifiedEvents.add(e.id));

    return newEvents;
  } catch (err) {
    console.error("❌ Calendar fetch error:", err.message);
    return [];
  }
}

/**
 * Fetch ALL calendar events in a time range (used by smart reminder scheduler).
 * Does NOT filter by already-seen events.
 */
async function getScheduledMeetings(fromMinutes = -30, toMinutes = 1500) {
  const tenantId = process.env.TEAMS_TENANT_ID;
  const clientId = process.env.TEAMS_APP_ID;
  const clientSecret = process.env.TEAMS_APP_PASSWORD;
  const userEmail = process.env.OUTLOOK_USER_EMAIL;

  if (!tenantId || !clientId || !clientSecret || !userEmail) return [];

  try {
    const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    const tokenResponse = await credential.getToken("https://graph.microsoft.com/.default");
    const accessToken = tokenResponse.token;

    const now = new Date();
    const startTime = new Date(now.getTime() + fromMinutes * 60 * 1000).toISOString();
    const endTime   = new Date(now.getTime() + toMinutes   * 60 * 1000).toISOString();

    const url = `https://graph.microsoft.com/v1.0/users/${userEmail}/calendarView?startDateTime=${startTime}&endDateTime=${endTime}&$select=id,subject,start,end,onlineMeeting,webLink,organizer&$orderby=start/dateTime&$top=20`;

    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) return [];

    const data = await response.json();
    return data.value || [];
  } catch (err) {
    console.error("❌ Calendar fetch error:", err.message);
    return [];
  }
}

/**
 * Create a real Teams online meeting via Graph API.
 * dateStr: "YYYY-MM-DD", timeStr: "HH:MM", durationMins: number
 */
async function createTeamsMeeting(subject, dateStr, timeStr, durationMins, attendeeEmails = [], tz = "Asia/Kolkata") {
  const tenantId = process.env.TEAMS_TENANT_ID;
  const clientId = process.env.TEAMS_APP_ID;
  const clientSecret = process.env.TEAMS_APP_PASSWORD;
  const userEmail = process.env.OUTLOOK_USER_EMAIL;

  if (!tenantId || !clientId || !clientSecret || !userEmail) {
    throw new Error("Missing Graph API credentials in environment variables");
  }

  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  const tokenResponse = await credential.getToken("https://graph.microsoft.com/.default");
  const accessToken = tokenResponse.token;

  // Compute end datetime
  const [h, m] = timeStr.split(":").map(Number);
  const totalMins = h * 60 + m + durationMins;
  const endH = Math.floor(totalMins / 60) % 24;
  const endM = totalMins % 60;
  let endDateStr = dateStr;
  if (totalMins >= 1440) {
    const [y, mo, d] = dateStr.split("-").map(Number);
    const next = new Date(Date.UTC(y, mo - 1, d + 1));
    endDateStr = next.toISOString().substring(0, 10);
  }
  const endTimeStr = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;

  const body = {
    subject,
    start: { dateTime: `${dateStr}T${timeStr}:00`, timeZone: tz },
    end:   { dateTime: `${endDateStr}T${endTimeStr}:00`, timeZone: tz },
    isOnlineMeeting: true,
    onlineMeetingProvider: "teamsForBusiness",
    attendees: attendeeEmails.map((email) => ({
      emailAddress: { address: email.trim() },
      type: "required",
    })),
  };

  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${userEmail}/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(errText);
  }

  return await response.json();
}

module.exports = { getUpcomingMeetings, getScheduledMeetings, createTeamsMeeting };
