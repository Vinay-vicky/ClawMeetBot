require("isomorphic-fetch");
const { Client } = require("@microsoft/microsoft-graph-client");
const { ClientSecretCredential } = require("@azure/identity");

const credential = new ClientSecretCredential(
  process.env.TEAMS_TENANT_ID,
  process.env.TEAMS_APP_ID,
  process.env.TEAMS_APP_PASSWORD
);

async function getAccessToken() {
  const token = await credential.getToken("https://graph.microsoft.com/.default");
  return token.token;
}

async function getMeetings() {
  const token = await getAccessToken();

  const client = Client.init({
    authProvider: (done) => {
      done(null, token);
    },
  });

  const now = new Date().toISOString();
  const thirtyDaysOut = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const events = await client
    .api(`/users/${process.env.OUTLOOK_USER_EMAIL}/calendarView`)
    .query({
      startDateTime: now,
      endDateTime: thirtyDaysOut,
      $orderby: "start/dateTime",
      $top: 10,
    })
    .get();

  return events.value;
}

module.exports = { getMeetings };