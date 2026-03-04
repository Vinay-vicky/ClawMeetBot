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

module.exports = { getUpcomingMeetings, getScheduledMeetings };
