"use strict";
const express = require("express");
const router = express.Router();
const {
  getRecentMeetings, getPendingTasks, getMeetingStats, getTaskStats, getMeetingAnalytics,
} = require("../services/dbService");
const { getScheduledMeetings } = require("../services/calendarService");
const logger = require("../utils/logger");

// ── Auth middleware ────────────────────────────────────────────────────────────
function authCheck(req, res, next) {
  const token = process.env.DASHBOARD_TOKEN;
  if (!token) return next();                          // no auth configured → open access
  const provided = req.query.token || req.headers["x-dashboard-token"];
  if (provided === token) return next();
  res.status(401).send(
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>ClawMeet Dashboard</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:sans-serif;background:#0f1117;color:#e1e4e8;display:flex;align-items:center;justify-content:center;min-height:100vh}.box{text-align:center;padding:40px;background:#161b22;border:1px solid #30363d;border-radius:12px;min-width:300px}h2{color:#58a6ff;margin-bottom:20px;font-size:18px}input{padding:10px 14px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e1e4e8;font-size:14px;width:220px;display:block;margin:0 auto 12px}button{padding:10px 24px;background:#238636;border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:14px}button:hover{background:#2ea043}</style></head>
<body><div class="box"><h2>🔒 ClawMeet Dashboard</h2><form method="GET"><input name="token" type="password" placeholder="Access token" required><button type="submit">Enter</button></form></div></body></html>`
  );
}

// ── Main route ─────────────────────────────────────────────────────────────────
router.get("/", authCheck, async (req, res) => {
  try {
    const tokenParam = process.env.DASHBOARD_TOKEN && req.query.token
      ? `?token=${encodeURIComponent(req.query.token)}` : "";

    const [meetings, tasks, meetStats, taskStats, analytics] = await Promise.all([
      getRecentMeetings(20),
      getPendingTasks(),
      getMeetingStats(),
      getTaskStats(),
      getMeetingAnalytics(),
    ]);

    let todayMeetings = [];
    try { todayMeetings = await getScheduledMeetings(-60, 1440); } catch (_) { }

    res.send(buildHtml({ meetings, tasks, meetStats, taskStats, analytics, todayMeetings, tokenParam }));
  } catch (err) {
    logger.error("Dashboard render error:", err);
    res.status(500).send(`<h1 style="color:red;font-family:sans-serif">Dashboard Error</h1><pre>${err.message}</pre>`);
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTime(t) {
  if (!t) return "—";
  try {
    return new Date(t).toLocaleString("en-IN", {
      timeZone: process.env.TIMEZONE || "Asia/Kolkata",
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true,
    });
  } catch { return String(t); }
}

// ── HTML template ──────────────────────────────────────────────────────────────
function buildHtml({ meetings, tasks, meetStats, taskStats, analytics, todayMeetings, tokenParam }) {
  const refreshUrl = "/dashboard" + tokenParam;
  const now = new Date().toLocaleString("en-IN", {
    timeZone: process.env.TIMEZONE || "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
  });

  // Week bar chart
  const maxWk = Math.max(...(analytics.weeks || []).map((w) => w.count), 1);
  const weekBars = (analytics.weeks || []).map((w) => {
    const h = Math.max(4, Math.round((w.count / maxWk) * 80));
    return `<div class="bw"><div class="bar" style="height:${h}px"></div><div class="bl">${esc(w.week)}</div><div class="bv">${w.count}</div></div>`;
  }).join("") || `<p class="empty">No data yet</p>`;

  // Top assignees
  const maxAsg = analytics.topAssignees?.[0]?.count || 1;
  const assigneeBars = (analytics.topAssignees || []).map((a) => {
    const pct = Math.round((a.count / maxAsg) * 100);
    return `<div class="arow"><span class="aname">${esc(a.person)}</span><div class="abg"><div class="abar" style="width:${pct}%"></div></div><span class="acnt">${a.count}</span></div>`;
  }).join("") || `<p class="empty">No data yet</p>`;

  // Busiest days
  const maxDay = analytics.busiestDays?.[0]?.count || 1;
  const dayBars = (analytics.busiestDays || []).map((d) => {
    const pct = Math.round((d.count / maxDay) * 100);
    return `<div class="arow"><span class="aname">${esc(d.day)}</span><div class="abg"><div class="abar" style="width:${pct}%"></div></div><span class="acnt">${d.count}</span></div>`;
  }).join("") || `<p class="empty">No data yet</p>`;

  // Today's meetings
  const todayRows = todayMeetings.map((e) => {
    const joinUrl = e.onlineMeeting?.joinUrl || e.join_url || e.webLink;
    const start = e.start?.dateTime || e.start_time;
    const org = e.organizer?.emailAddress?.name || e.organizer || "—";
    return `<tr><td>${esc(e.subject || "Meeting")}</td><td>${fmtTime(start)}</td><td>${esc(org)}</td><td>${joinUrl ? `<a href="${esc(joinUrl)}" target="_blank" class="join">Join</a>` : "—"}</td></tr>`;
  }).join("") || `<tr><td colspan="4" class="empty">No upcoming meetings in the next 24 hrs</td></tr>`;

  // Recent meetings
  const meetRows = meetings.map((m) => {
    return `<tr><td>${esc(m.subject)}</td><td>${fmtTime(m.start_time)}</td><td>${esc(m.organizer || "—")}</td><td>${m.summary ? '<span class="badge g">✓ AI</span>' : '<span class="badge gr">—</span>'}</td><td>${m.join_url ? `<a href="${esc(m.join_url)}" target="_blank" class="join">Join</a>` : "—"}</td></tr>`;
  }).join("") || `<tr><td colspan="5" class="empty">No meetings yet</td></tr>`;

  // Pending tasks
  const taskRows = tasks.slice(0, 30).map((t) =>
    `<tr><td>${t.id}</td><td>${esc(t.person)}</td><td>${esc(t.task)}</td><td>${esc(t.deadline || "—")}</td><td>${esc(t.meeting_subject || "—")}</td></tr>`
  ).join("") || `<tr><td colspan="5" class="empty">No pending tasks</td></tr>`;

  const rate = analytics.completionRate ?? 0;
  const done = analytics.doneTasks ?? 0;
  const total = done + (analytics.pendingTasks ?? 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>ClawMeet Bot — Dashboard</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;color:#e1e4e8;min-height:100vh}
.hdr{background:#161b22;border-bottom:1px solid #30363d;padding:16px 28px;display:flex;justify-content:space-between;align-items:center}
.hdr h1{font-size:19px;font-weight:700;color:#58a6ff}
.hdr .sub{font-size:11px;color:#8b949e;margin-top:3px}
.refresh{background:#21262d;border:1px solid #30363d;color:#58a6ff;padding:6px 14px;border-radius:6px;text-decoration:none;font-size:12px}
.refresh:hover{background:#30363d}
.main{padding:20px 28px;max-width:1400px;margin:0 auto}
.srow{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px}
.sc{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px}
.sc .val{font-size:26px;font-weight:700;color:#58a6ff}
.sc .lbl{font-size:11px;color:#8b949e;margin-top:3px;text-transform:uppercase;letter-spacing:.4px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:20px}
@media(max-width:780px){.g2{grid-template-columns:1fr}}
.card,.fc{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.fc{margin-bottom:18px}
.card h2,.fc h2{font-size:13px;font-weight:600;color:#c9d1d9;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #21262d}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;color:#8b949e;font-weight:500;padding:6px 7px;border-bottom:1px solid #21262d}
td{padding:6px 7px;border-bottom:1px solid #0d1117;color:#c9d1d9}
tr:hover td{background:#1c2128}
.empty{text-align:center;color:#484f58;padding:14px}
.badge{display:inline-block;padding:2px 6px;border-radius:10px;font-size:10px}
.badge.g{background:#1a4731;color:#3fb950}
.badge.gr{background:#21262d;color:#8b949e}
.join{background:#1a4731;color:#3fb950;padding:2px 7px;border-radius:5px;text-decoration:none;font-size:11px}
.join:hover{background:#1d5738}
.bc{display:flex;align-items:flex-end;gap:8px;height:90px;padding:4px 0}
.bw{display:flex;flex-direction:column;align-items:center;flex:1}
.bar{background:linear-gradient(to top,#1f6feb,#58a6ff);border-radius:3px 3px 0 0;width:100%;min-height:4px}
.bl{font-size:9px;color:#8b949e;margin-top:4px;text-align:center}
.bv{font-size:10px;color:#58a6ff;margin-top:1px}
.arow{display:flex;align-items:center;gap:8px;margin-bottom:7px}
.aname{width:80px;font-size:12px;color:#c9d1d9;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.abg{flex:1;background:#21262d;border-radius:3px;height:7px}
.abar{background:linear-gradient(to right,#1f6feb,#58a6ff);border-radius:3px;height:100%}
.acnt{width:22px;text-align:right;font-size:11px;color:#8b949e}
.pbg{background:#21262d;border-radius:4px;height:9px;margin-top:8px}
.pb{background:linear-gradient(to right,#238636,#3fb950);border-radius:4px;height:100%}
.cr{font-size:28px;font-weight:700;color:#3fb950}
.crs{font-size:11px;color:#8b949e;margin-top:2px}
.ftr{text-align:center;padding:14px;color:#484f58;font-size:11px;border-top:1px solid #21262d;margin-top:8px}
</style>
</head>
<body>
<div class="hdr">
  <div><h1>🤖 ClawMeet Bot Dashboard</h1><div class="sub">Updated: ${esc(now)}</div></div>
  <a href="${esc(refreshUrl)}" class="refresh">&#8635; Refresh</a>
</div>
<div class="main">

<div class="srow">
  <div class="sc"><div class="val">${meetStats.total ?? 0}</div><div class="lbl">Total Meetings</div></div>
  <div class="sc"><div class="val">${meetStats.thisWeek ?? 0}</div><div class="lbl">This Week</div></div>
  <div class="sc"><div class="val">${taskStats.pending ?? 0}</div><div class="lbl">Pending Tasks</div></div>
  <div class="sc"><div class="val">${taskStats.doneThisMonth ?? 0}</div><div class="lbl">Done (30d)</div></div>
  <div class="sc"><div class="val">${rate}%</div><div class="lbl">Completion Rate</div></div>
</div>

<div class="fc">
  <h2>📅 Upcoming Meetings (next 24 hrs)</h2>
  <table><thead><tr><th>Meeting</th><th>Start</th><th>Organizer</th><th>Link</th></tr></thead>
  <tbody>${todayRows}</tbody></table>
</div>

<div class="g2">
  <div class="card"><h2>📊 Meetings per Week</h2><div class="bc">${weekBars}</div></div>
  <div class="card"><h2>👤 Top Assignees</h2>${assigneeBars}</div>
</div>

<div class="g2">
  <div class="card">
    <h2>✅ Task Completion</h2>
    <div class="cr">${rate}%</div>
    <div class="crs">${done} done / ${total} total</div>
    <div class="pbg"><div class="pb" style="width:${rate}%"></div></div>
  </div>
  <div class="card"><h2>📆 Busiest Days</h2>${dayBars}</div>
</div>

<div class="fc">
  <h2>✅ Pending Tasks (top 30)</h2>
  <table><thead><tr><th>#</th><th>Person</th><th>Task</th><th>Deadline</th><th>Meeting</th></tr></thead>
  <tbody>${taskRows}</tbody></table>
</div>

<div class="fc">
  <h2>🕑 Recent Meetings</h2>
  <table><thead><tr><th>Subject</th><th>Start</th><th>Organizer</th><th>Summary</th><th>Link</th></tr></thead>
  <tbody>${meetRows}</tbody></table>
</div>

</div>
<div class="ftr">ClawMeet Bot &bull; Microsoft Teams + Gemini AI &bull; Node.js</div>
</body></html>`;
}

module.exports = router;
