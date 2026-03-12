"use strict";
const express = require("express");
const crypto  = require("crypto");
const router  = express.Router();
const {
  getRecentMeetings, getPendingTasks, getMeetingStats, getTaskStats, getMeetingAnalytics,
  markTaskDone, getPersonalWorkspaceSummary,
  getUserByLinkToken, getPersonalTasks, getPersonalNotes, getUserByTelegramId,
  addPersonalTask, donePersonalTask, deletePersonalTask, updatePersonalTask,
  addPersonalNote, deletePersonalNote, updatePersonalNote,
} = require("../services/dbService");
const { getScheduledMeetings } = require("../services/calendarService");
const logger = require("../utils/logger");

// â”€â”€ Auth middleware â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function authCheck(req, res, next) {
  const token = process.env.DASHBOARD_TOKEN;
  if (!token) return next();
  const provided = req.query.token || req.headers["x-dashboard-token"];
  if (provided === token) return next();
  res.status(401).send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>ClawMeet Dashboard</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:sans-serif;background:#0f1117;color:#e1e4e8;display:flex;align-items:center;justify-content:center;min-height:100vh}.box{text-align:center;padding:40px;background:#161b22;border:1px solid #30363d;border-radius:12px;min-width:300px}h2{color:#58a6ff;margin-bottom:20px;font-size:18px}input{padding:10px 14px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e1e4e8;font-size:14px;width:220px;display:block;margin:0 auto 12px}button{padding:10px 24px;background:#238636;border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:14px}button:hover{background:#2ea043}</style></head>
<body><div class="box"><h2>&#x1F512; ClawMeet Dashboard</h2><form method="GET"><input name="token" type="password" placeholder="Access token" required><button type="submit">Enter</button></form></div></body></html>`);
}

// â”€â”€ Mark task done (from dashboard) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post("/task/:id/done", authCheck, async (req, res) => {
  try {
    await markTaskDone(req.params.id);
    const back = req.headers.referer || "/dashboard";
    res.redirect(back);
  } catch (err) {
    logger.error("Dashboard mark done error:", err);
    res.status(500).send("Error marking task done");
  }
});

// â”€â”€ JSON API for auto-refresh â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get("/api", authCheck, async (req, res) => {
  try {
    const [meetStats, taskStats, analytics] = await Promise.all([
      getMeetingStats(), getTaskStats(), getMeetingAnalytics(),
    ]);
    res.json({ meetStats, taskStats, analytics, ts: Date.now() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// â”€â”€ Main route â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get("/", authCheck, async (req, res) => {
  try {
    const tokenParam = process.env.DASHBOARD_TOKEN && req.query.token
      ? `?token=${encodeURIComponent(req.query.token)}` : "";

    const [meetings, tasks, meetStats, taskStats, analytics, personalSummary] = await Promise.all([
      getRecentMeetings(20),
      getPendingTasks(),
      getMeetingStats(),
      getTaskStats(),
      getMeetingAnalytics(),
      getPersonalWorkspaceSummary().catch(() => ({ totalPersonalTasks: 0, totalPersonalNotes: 0, usersWithTasks: 0 })),
    ]);

    let todayMeetings = [];
    try { todayMeetings = await getScheduledMeetings(-60, 1440); } catch (_) { }

    const summaryCount = meetings.filter((m) => m.summary).length;
    const aiCoverage   = meetings.length > 0 ? summaryCount / meetings.length : 0;
    const activityScore = Math.min(1, (meetStats.thisWeek ?? 0) / 5);
    const completionFrac = (analytics.completionRate ?? 0) / 100;
    const productivityScore = Math.round(completionFrac * 40 + aiCoverage * 30 + activityScore * 30);

    res.send(buildHtml({ meetings, tasks, meetStats, taskStats, analytics, todayMeetings, tokenParam, productivityScore, summaryCount, personalSummary }));
  } catch (err) {
    logger.error("Dashboard render error:", err);
    res.status(500).send(`<h1 style="color:red;font-family:sans-serif">Dashboard Error</h1><pre>${err.message}</pre>`);
  }
});

// ── Analytics page ────────────────────────────────────────────────────────────
router.get("/analytics", authCheck, async (req, res) => {
  try {
    const [meetings, meetStats, taskStats, analytics] = await Promise.all([
      getRecentMeetings(20), getMeetingStats(), getTaskStats(), getMeetingAnalytics(),
    ]);
    const summaryCount  = meetings.filter((m) => m.summary).length;
    const aiCoverage    = meetings.length > 0 ? summaryCount / meetings.length : 0;
    const activityScore = Math.min(1, (meetStats.thisWeek ?? 0) / 5);
    const productivityScore = Math.round(((analytics.completionRate ?? 0) / 100) * 40 + aiCoverage * 30 + activityScore * 30);
    res.send(buildAnalyticsHtml({ meetStats, taskStats, analytics, productivityScore, aiCoverage, activityScore }));
  } catch (err) {
    logger.error("Analytics page error:", err);
    res.status(500).send(`<h1 style="color:red;font-family:sans-serif">Analytics Error</h1><pre>${err.message}</pre>`);
  }
});

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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

function deadlineClass(deadline) {
  if (!deadline) return "";
  try {
    const d = new Date(deadline);
    if (isNaN(d)) return "";
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dd    = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (dd < today)  return " dl-overdue";
    if (dd.getTime() === today.getTime()) return " dl-today";
    return "";
  } catch { return ""; }
}

function scoreColor(score) {
  if (score >= 70) return "#3fb950";
  if (score >= 40) return "#d29922";
  return "#f85149";
}

// â”€â”€ HTML template â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildHtml({ meetings, tasks, meetStats, taskStats, analytics, todayMeetings, tokenParam, productivityScore, summaryCount, personalSummary = {} }) {
  const baseUrl = "/dashboard" + tokenParam;
  const apiUrl  = "/dashboard/api" + tokenParam;
  const now = new Date().toLocaleString("en-IN", {
    timeZone: process.env.TIMEZONE || "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
  });

  const rate  = analytics.completionRate ?? 0;
  const done  = analytics.doneTasks ?? 0;
  const total = done + (analytics.pendingTasks ?? 0);

  // Chart.js data (serialised server-side â†’ safe to embed)
  const weekLabels = JSON.stringify((analytics.weeks || []).map((w) => w.week));
  const weekCounts = JSON.stringify((analytics.weeks || []).map((w) => w.count));

  // Productivity sub-scores for radar
  const activityScore  = Math.min(1, (meetStats.thisWeek ?? 0) / 5);
  const aiCoverage     = meetings.length > 0 ? summaryCount / meetings.length : 0;
  const radarData = JSON.stringify([
    Math.round((rate / 100) * 100),
    Math.round(aiCoverage * 100),
    Math.round(activityScore * 100),
  ]);
  const pColor = scoreColor(productivityScore);

  // Today's meetings
  const todayRows = todayMeetings.map((e) => {
    const joinUrl = e.onlineMeeting?.joinUrl || e.join_url || e.webLink;
    const start = e.start?.dateTime || e.start_time;
    const org = e.organizer?.emailAddress?.name || e.organizer || "—";
    return `<tr><td>${esc(e.subject || "Meeting")}</td><td>${fmtTime(start)}</td><td>${esc(org)}</td><td>${joinUrl ? `<a href="${esc(joinUrl)}" target="_blank" class="join">&#x25B6; Join</a>` : "—"}</td></tr>`;
  }).join("") || `<tr><td colspan="4" class="empty">No upcoming meetings in the next 24 hrs</td></tr>`;

  // Recent meetings
  const meetRows = meetings.map((m) =>
    `<tr><td>${esc(m.subject)}</td><td>${fmtTime(m.start_time)}</td><td>${esc(m.organizer || "—")}</td><td>${m.summary ? '<span class="badge g">&#x2713; AI</span>' : '<span class="badge gr">—</span>'}</td><td>${m.join_url ? `<a href="${esc(m.join_url)}" target="_blank" class="join">&#x25B6; Join</a>` : "—"}</td></tr>`
  ).join("") || `<tr><td colspan="5" class="empty">No meetings yet</td></tr>`;

  // Pending tasks — with deadline colouring + done button
  const taskRows = tasks.slice(0, 30).map((t) => {
    const dlCls = deadlineClass(t.deadline);
    const dlText = t.deadline
      ? `<span class="dlbadge${dlCls}">${esc(t.deadline)}</span>`
      : "—";
    return `<tr>
      <td>${t.id}</td>
      <td>${esc(t.person)}</td>
      <td>${esc(t.task)}</td>
      <td>${dlText}</td>
      <td>${esc(t.meeting_subject || "—")}</td>
      <td><form method="POST" action="/dashboard/task/${t.id}/done${tokenParam ? "?" + tokenParam.slice(1) : ""}" style="margin:0">
        <button class="donebtn" type="submit" title="Mark complete">&#x2705;</button>
      </form></td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="empty">No pending tasks &#x1F389;</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>ClawMeet Bot — Dashboard</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;color:#e1e4e8;min-height:100vh}
.hdr{background:#161b22;border-bottom:1px solid #30363d;padding:16px 28px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.hdr h1{font-size:18px;font-weight:700;color:#58a6ff}
.hdr .sub{font-size:11px;color:#8b949e;margin-top:3px}
.hdr-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.refresh{background:#21262d;border:1px solid #30363d;color:#58a6ff;padding:6px 14px;border-radius:6px;text-decoration:none;font-size:12px;cursor:pointer;white-space:nowrap}
.refresh:hover{background:#30363d}
.countdown{font-size:11px;color:#8b949e;white-space:nowrap}
.main{padding:20px 28px;max-width:1440px;margin:0 auto}
/* Stat cards */
.srow{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:20px}
.sc{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px 16px;position:relative}
.sc .val{font-size:26px;font-weight:700;color:#58a6ff}
.sc .lbl{font-size:10px;color:#8b949e;margin-top:4px;text-transform:uppercase;letter-spacing:.5px}
.sc.ps .val{color:${pColor}}
/* Grid layouts */
.g2{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:20px}
.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px;margin-bottom:20px}
@media(max-width:900px){.g2,.g3{grid-template-columns:1fr}.span2{grid-column:span 1 !important}}
@media(max-width:600px){.main{padding:12px 10px}.hdr{padding:12px 14px}.sc .val{font-size:20px}.srow{grid-template-columns:repeat(2,1fr)}}
.card,.fc{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.fc{margin-bottom:18px}
.card h2,.fc h2{font-size:12px;font-weight:600;color:#8b949e;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #21262d;text-transform:uppercase;letter-spacing:.5px}
/* Chart containers */
.chart-wrap{position:relative;height:180px}
.chart-sm{position:relative;height:160px;display:flex;align-items:center;justify-content:center}
/* Tables */
.table-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;color:#8b949e;font-weight:500;padding:6px 8px;border-bottom:1px solid #21262d}
td{padding:6px 8px;border-bottom:1px solid #0d1117;color:#c9d1d9;vertical-align:middle}
tr:hover td{background:#1c2128}
.empty{text-align:center;color:#484f58;padding:16px}
.badge{display:inline-block;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:500}
.badge.g{background:#1a4731;color:#3fb950}
.badge.gr{background:#21262d;color:#8b949e}
.join{background:#1a4731;color:#3fb950;padding:2px 8px;border-radius:5px;text-decoration:none;font-size:11px;font-weight:500}
.join:hover{background:#1d5738}
/* Deadline badges */
.dlbadge{display:inline-block;padding:1px 6px;border-radius:4px;font-size:11px;background:#21262d;color:#8b949e}
.dlbadge.dl-overdue{background:#3d1a1a;color:#f85149;font-weight:600}
.dlbadge.dl-today{background:#3d2f00;color:#d29922;font-weight:600}
/* Done button */
.donebtn{background:none;border:none;cursor:pointer;font-size:15px;padding:2px 4px;border-radius:4px;transition:transform .1s}
.donebtn:hover{transform:scale(1.3)}
/* Productivity ring */
.ps-ring{display:flex;align-items:center;gap:14px}
.ring-num{font-size:36px;font-weight:700;color:${pColor}}
.ring-desc{font-size:11px;color:#8b949e;line-height:1.5}
/* Footer */
.ftr{text-align:center;padding:16px;color:#484f58;font-size:11px;border-top:1px solid #21262d;margin-top:8px}
/* Live dot */
.live-dot{display:inline-block;width:7px;height:7px;background:#3fb950;border-radius:50%;margin-right:4px;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
</style>
</head>
<body>
<div class="hdr">
  <div><h1>&#x1F916; ClawMeet Bot Dashboard</h1><div class="sub"><span class="live-dot"></span>Updated: <span id="ts">${esc(now)}</span></div></div>
  <div class="hdr-right">
    <a href="/dashboard/analytics" class="refresh">&#x1F4CA; Analytics</a>
    <a href="/dashboard/public" class="refresh">&#x1F465; Team View</a>
    <a href="/dashboard/me" class="refresh">&#x1F464; My Dashboard</a>
    <span class="countdown" id="cd">Auto-refresh in <b id="cds">60</b>s</span>
    <a href="${esc(baseUrl)}" class="refresh" id="rfbtn">&#x21BB; Refresh</a>
  </div>
</div>
<div class="main">

<!-- KPI cards -->
<div class="srow">
  <div class="sc"><div class="val" id="kpi-total">${meetStats.total ?? 0}</div><div class="lbl">Total Meetings</div></div>
  <div class="sc"><div class="val" id="kpi-week">${meetStats.thisWeek ?? 0}</div><div class="lbl">This Week</div></div>
  <div class="sc"><div class="val" id="kpi-pending">${taskStats.pending ?? 0}</div><div class="lbl">Pending Tasks</div></div>
  <div class="sc"><div class="val" id="kpi-done">${taskStats.doneThisMonth ?? 0}</div><div class="lbl">Done (30d)</div></div>
  <div class="sc"><div class="val" id="kpi-rate">${rate}%</div><div class="lbl">Task Completion</div></div>
  <div class="sc ps"><div class="val" id="kpi-score">${productivityScore}</div><div class="lbl">Productivity Score</div></div>
</div>

<!-- Upcoming meetings -->
<div class="fc">
  <h2>&#x1F4C5; Upcoming Meetings (next 24 hrs)</h2>
  <div class="table-scroll"><table><thead><tr><th>Meeting</th><th>Start</th><th>Organizer</th><th>Link</th></tr></thead>
  <tbody>${todayRows}</tbody></table></div>
</div>

<!-- Analytics CTA -->
<div class="fc" style="background:linear-gradient(135deg,#161b22 0%,#1c2128 100%);border-color:#1f6feb;text-align:center;padding:28px 20px">
  <div style="font-size:36px;margin-bottom:10px">&#x1F4CA;</div>
  <div style="font-size:16px;font-weight:600;color:#58a6ff;margin-bottom:8px">Team Analytics</div>
  <p style="color:#8b949e;font-size:12px;margin-bottom:18px;line-height:1.7">Meetings per week &bull; Task completion &bull; Productivity score &bull; Top assignees &bull; Busiest days<br>All charts in one focused, distraction-free view</p>
  <a href="/dashboard/analytics" style="display:inline-block;background:#1f6feb;color:#fff;padding:10px 28px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">&#x1F4CA; View Analytics &rarr;</a>
</div>

<!-- Tasks -->
<div class="fc">
  <h2>&#x2705; Pending Tasks <span style="color:#484f58;font-weight:400">(top 30 &mdash; click &#x2705; to complete)</span></h2>
  <div class="table-scroll"><table><thead><tr><th>#</th><th>Person</th><th>Task</th><th>Deadline</th><th>Meeting</th><th></th></tr></thead>
  <tbody id="task-tbody">${taskRows}</tbody></table></div>
</div>

<!-- Recent meetings -->
<div class="fc">
  <h2>&#x1F552; Recent Meetings</h2>
  <div class="table-scroll"><table><thead><tr><th>Subject</th><th>Start</th><th>Organizer</th><th>Summary</th><th>Link</th></tr></thead>
  <tbody>${meetRows}</tbody></table></div>
</div>

<!-- â•â•â• PERSONAL WORKSPACE â•â•â• -->
<div class="fc" style="border-color:#6e40c9;margin-top:24px">
  <h2 style="color:#a371f7">&#x1F512; Personal Workspace <span style="font-weight:400;color:#484f58;text-transform:none;letter-spacing:0">(private — only visible to each user via Telegram)</span></h2>
  <div class="srow" style="margin-bottom:12px">
    <div class="sc"><div class="val" style="color:#a371f7">${personalSummary.totalPersonalTasks ?? 0}</div><div class="lbl">Personal Tasks</div></div>
    <div class="sc"><div class="val" style="color:#a371f7">${personalSummary.totalPersonalNotes ?? 0}</div><div class="lbl">Personal Notes</div></div>
    <div class="sc"><div class="val" style="color:#a371f7">${personalSummary.usersWithTasks ?? 0}</div><div class="lbl">Active Users</div></div>
  </div>
  <p style="font-size:11px;color:#484f58;line-height:1.6">
    Personal tasks and notes are private per Telegram user — not shown here in detail.<br>
    Each user can manage their own workspace via:
    <code>/mytasks</code> &nbsp; <code>/mytask</code> &nbsp; <code>/mynotes</code> &nbsp; <code>/note</code> &nbsp; <code>/myprofile</code>
  </p>
</div>


</div><div class="ftr">ClawMeet Bot &bull; Microsoft Teams + Gemini AI &bull; Node.js &bull; <a href="https://github.com/Vinay-vicky/ClawMeetBot" target="_blank" style="color:#58a6ff;text-decoration:none">GitHub</a> &bull; <a href="/dashboard/developer" style="color:#484f58;text-decoration:none;font-size:10px">&#x1F527; Developer API</a></div>

<script>
// â”€â”€ Chart.js charts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€




// â”€â”€ Auto-refresh â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let cdVal = 60;
const cdEl = document.getElementById('cds');
const tsEl = document.getElementById('ts');
const apiUrl = ${JSON.stringify(apiUrl)};

setInterval(() => {
  cdVal--;
  if (cdEl) cdEl.textContent = cdVal;
  if (cdVal <= 0) {
    cdVal = 60;
    // Soft refresh: update KPI cards without page reload
    fetch(apiUrl)
      .then(r => r.json())
      .then(d => {
        if (d.error) { location.reload(); return; }
        const s = d.meetStats; const t = d.taskStats; const a = d.analytics;
        document.getElementById('kpi-total').textContent   = s.total   ?? 0;
        document.getElementById('kpi-week').textContent    = s.thisWeek ?? 0;
        document.getElementById('kpi-pending').textContent = t.pending  ?? 0;
        document.getElementById('kpi-done').textContent    = t.doneThisMonth ?? 0;
        const rate = a.completionRate ?? 0;
        document.getElementById('kpi-rate').textContent = rate + '%';
        // Compute productivity score
        const act = Math.min(1, (s.thisWeek ?? 0) / 5);
        const ps  = Math.round((rate / 100) * 40 + act * 30);
        document.getElementById('kpi-score').textContent = ps;
        // Update timestamp
        if (tsEl) tsEl.textContent = new Date().toLocaleString('en-IN', {
          timeZone: '${process.env.TIMEZONE || "Asia/Kolkata"}',
          day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true
        });
      })
      .catch(() => { /* silent fail */ });
  }
}, 1000);

</script>
</body></html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// SESSION HELPERS  (cookie-based, no extra packages)
// ══════════════════════════════════════════════════════════════════════════════

function sessionSecret() {
  return process.env.SESSION_SECRET || process.env.DASHBOARD_TOKEN || "clawmeet-session-2026";
}

function parseCookies(req) {
  const map = {};
  (req.headers.cookie || "").split(";").forEach((part) => {
    const [k, ...vs] = part.trim().split("=");
    if (k) map[k.trim()] = decodeURIComponent(vs.join("="));
  });
  return map;
}

function createSessionCookie(telegramId, name) {
  const payload = Buffer.from(JSON.stringify({ tid: String(telegramId), name: name || "" })).toString("base64url");
  const sig = crypto.createHmac("sha256", sessionSecret()).update(payload).digest("hex");
  return `cmbt=${payload}.${sig}; Path=/dashboard; HttpOnly; SameSite=Lax; Max-Age=604800`;
}

function readSession(req) {
  const val = parseCookies(req).cmbt;
  if (!val) return null;
  const dotIdx = val.lastIndexOf(".");
  if (dotIdx === -1) return null;
  const b64 = val.slice(0, dotIdx);
  const sig = val.slice(dotIdx + 1);
  const expected = crypto.createHmac("sha256", sessionSecret()).update(b64).digest("hex");
  if (sig !== expected) return null;
  try { return JSON.parse(Buffer.from(b64, "base64url").toString()); }
  catch { return null; }
}

function requireSession(req, res, next) {
  const session = readSession(req);
  if (!session) return res.redirect("/dashboard/login?msg=Please+log+in+first");
  req.session = session;
  next();
}

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC DASHBOARD  — /dashboard/public  (no login required)
// ══════════════════════════════════════════════════════════════════════════════

router.get("/public", async (req, res) => {
  try {
    const [meetStats, taskStats, analytics, meetings] = await Promise.all([
      getMeetingStats(), getTaskStats(), getMeetingAnalytics(), getRecentMeetings(10),
    ]);
    res.send(buildPublicHtml({ meetStats, taskStats, analytics, meetings }));
  } catch (err) {
    logger.error("Public dashboard error:", err);
    res.status(500).send("<h2>Error loading public dashboard</h2>");
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// LOGIN / LOGOUT
// ══════════════════════════════════════════════════════════════════════════════

router.get("/login", async (req, res) => {
  const session = readSession(req);
  if (session) return res.redirect("/dashboard/me");
  // One-click login via ?token=xxx (sent from Telegram DM)
  const quickToken = (req.query.token || "").trim();
  if (quickToken) {
    try {
      const user = await getUserByLinkToken(quickToken);
      if (user) {
        res.setHeader("Set-Cookie", createSessionCookie(user.telegram_id, user.name));
        return res.redirect("/dashboard/me");
      }
    } catch (_) { /* fall through to form */ }
    return res.send(buildLoginHtml({ error: "Invalid or expired login link. Get a new one via /myprofile in Telegram." }));
  }
  res.send(buildLoginHtml({ error: req.query.error, msg: req.query.msg }));
});

router.post("/login", express.urlencoded({ extended: false }), async (req, res) => {
  const linkToken = (req.body.link_token || "").trim();
  if (!linkToken) return res.send(buildLoginHtml({ error: "Please enter your link token." }));
  try {
    const user = await getUserByLinkToken(linkToken);
    if (!user) return res.send(buildLoginHtml({ error: "Invalid token. Check /myprofile in Telegram." }));
    res.setHeader("Set-Cookie", createSessionCookie(user.telegram_id, user.name));
    res.redirect("/dashboard/me");
  } catch (err) {
    logger.error("Login error:", err);
    res.send(buildLoginHtml({ error: "Login failed, please try again." }));
  }
});

router.get("/logout", (req, res) => {
  res.setHeader("Set-Cookie", "cmbt=; Path=/dashboard; HttpOnly; Max-Age=0");
  res.redirect("/dashboard/login?msg=You+have+been+logged+out");
});

// ══════════════════════════════════════════════════════════════════════════════
// PERSONAL DASHBOARD  — /dashboard/me  (requires session)
// ══════════════════════════════════════════════════════════════════════════════

router.get("/me", requireSession, async (req, res) => {
  const telegramId = req.session.tid;
  try {
    const [user, myTasks, myNotes] = await Promise.all([
      getUserByTelegramId(telegramId),
      getPersonalTasks(telegramId),
      getPersonalNotes(telegramId, 30),
    ]);
    res.send(buildPersonalHtml({ user: user || { name: req.session.name, telegram_id: telegramId }, myTasks, myNotes }));
  } catch (err) {
    logger.error("Personal dashboard error:", err);
    res.status(500).send("<h2>Error loading your dashboard</h2>");
  }
});

// Mark personal task done from personal dashboard
router.post("/me/task/:id/done", requireSession, async (req, res) => {
  try {
    await donePersonalTask(req.params.id, req.session.tid);
    res.redirect("/dashboard/me");
  } catch (err) {
    logger.error("Personal task done error:", err);
    res.redirect("/dashboard/me");
  }
});

// Add task
router.post("/me/task/add", requireSession, express.urlencoded({ extended: false }), async (req, res) => {
  const { task, deadline } = req.body;
  if (task && task.trim()) {
    await addPersonalTask(req.session.tid, task.trim(), (deadline || "").trim()).catch(() => {});
  }
  res.redirect("/dashboard/me");
});

// Edit task
router.post("/me/task/:id/edit", requireSession, express.urlencoded({ extended: false }), async (req, res) => {
  const { task, deadline } = req.body;
  if (task && task.trim()) {
    await updatePersonalTask(req.params.id, req.session.tid, task.trim(), (deadline || "").trim()).catch(() => {});
  }
  res.redirect("/dashboard/me");
});

// Delete task
router.post("/me/task/:id/delete", requireSession, async (req, res) => {
  await deletePersonalTask(req.params.id, req.session.tid).catch(() => {});
  res.redirect("/dashboard/me");
});

// Add note
router.post("/me/note/add", requireSession, express.urlencoded({ extended: false }), async (req, res) => {
  const { note } = req.body;
  if (note && note.trim()) {
    await addPersonalNote(req.session.tid, note.trim()).catch(() => {});
  }
  res.redirect("/dashboard/me");
});

// Edit note
router.post("/me/note/:id/edit", requireSession, express.urlencoded({ extended: false }), async (req, res) => {
  const { note } = req.body;
  if (note && note.trim()) {
    await updatePersonalNote(req.params.id, req.session.tid, note.trim()).catch(() => {});
  }
  res.redirect("/dashboard/me");
});

// Delete note
router.post("/me/note/:id/delete", requireSession, async (req, res) => {
  await deletePersonalNote(req.params.id, req.session.tid).catch(() => {});
  res.redirect("/dashboard/me");
});

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC DASHBOARD HTML
// ══════════════════════════════════════════════════════════════════════════════
// ── Analytics page HTML ──────────────────────────────────────────────────────
function buildAnalyticsHtml({ meetStats, taskStats, analytics, productivityScore, aiCoverage, activityScore }) {
  const now = new Date().toLocaleString("en-IN", {
    timeZone: process.env.TIMEZONE || "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
  });
  const rate  = analytics.completionRate ?? 0;
  const done  = analytics.doneTasks ?? 0;
  const total = done + (analytics.pendingTasks ?? 0);
  const weekLabels = JSON.stringify((analytics.weeks || []).map((w) => w.week));
  const weekCounts = JSON.stringify((analytics.weeks || []).map((w) => w.count));
  const radarData  = JSON.stringify([
    Math.round((rate / 100) * 100),
    Math.round(aiCoverage * 100),
    Math.round(activityScore * 100),
  ]);
  const pColor = scoreColor(productivityScore);

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Analytics &#x2014; ClawMeet Bot</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"><\/script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;color:#e1e4e8;min-height:100vh}
.hdr{background:#161b22;border-bottom:1px solid #30363d;padding:16px 28px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.hdr h1{font-size:18px;font-weight:700;color:#58a6ff}
.hdr .sub{font-size:11px;color:#8b949e;margin-top:3px}
.hdr-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.btn{background:#21262d;border:1px solid #30363d;color:#58a6ff;padding:6px 14px;border-radius:6px;text-decoration:none;font-size:12px;white-space:nowrap}
.btn:hover{background:#30363d}
.main{padding:26px 28px;max-width:1200px;margin:0 auto}
.page-title{font-size:22px;font-weight:700;color:#c9d1d9;margin-bottom:4px}
.page-sub{font-size:12px;color:#8b949e;margin-bottom:26px}
.srow{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:28px}
.sc{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px 16px}
.sc .val{font-size:26px;font-weight:700;color:#58a6ff}
.sc .lbl{font-size:10px;color:#8b949e;margin-top:4px;text-transform:uppercase;letter-spacing:.5px}
.card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:24px;margin-bottom:24px}
.card h2{font-size:13px;font-weight:600;color:#8b949e;margin-bottom:18px;padding-bottom:10px;border-bottom:1px solid #21262d;text-transform:uppercase;letter-spacing:.5px}
.chart-full{position:relative;height:300px}
.chart-half{position:relative;height:260px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px}
@media(max-width:768px){.g2{grid-template-columns:1fr}}
@media(max-width:600px){.main{padding:14px 12px}.hdr{padding:12px 14px}}
.ps-ring{display:flex;align-items:center;gap:18px;margin-bottom:18px}
.ring-num{font-size:52px;font-weight:700;color:${pColor};line-height:1}
.ring-label{font-size:11px;color:#8b949e;margin-top:4px}
.ring-desc{font-size:12px;color:#8b949e;line-height:1.9}
.ring-desc b{color:#c9d1d9}
.ftr{text-align:center;padding:16px;color:#484f58;font-size:11px;border-top:1px solid #21262d;margin-top:8px}
.live-dot{display:inline-block;width:7px;height:7px;background:#3fb950;border-radius:50%;margin-right:4px;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
</style>
</head>
<body>
<div class="hdr">
  <div>
    <h1>&#x1F4CA; Team Analytics</h1>
    <div class="sub"><span class="live-dot"></span>Updated: ${esc(now)}</div>
  </div>
  <div class="hdr-right">
    <a href="/dashboard/" class="btn">&#x1F3E0; Team Dashboard</a>
    <a href="/dashboard/public" class="btn">&#x1F465; Team View</a>
    <a href="/dashboard/me" class="btn">&#x1F464; My Dashboard</a>
  </div>
</div>
<div class="main">
<div class="page-title">&#x1F4CA; Analytics Overview</div>
<div class="page-sub">All meeting and productivity metrics — each chart in its own focused space</div>

<div class="srow">
  <div class="sc"><div class="val">${meetStats.total ?? 0}</div><div class="lbl">Total Meetings</div></div>
  <div class="sc"><div class="val">${meetStats.thisWeek ?? 0}</div><div class="lbl">This Week</div></div>
  <div class="sc"><div class="val">${taskStats.pending ?? 0}</div><div class="lbl">Pending Tasks</div></div>
  <div class="sc"><div class="val">${taskStats.doneThisMonth ?? 0}</div><div class="lbl">Done (30 days)</div></div>
  <div class="sc"><div class="val">${rate}%</div><div class="lbl">Completion Rate</div></div>
  <div class="sc"><div class="val" style="color:${pColor}">${productivityScore}</div><div class="lbl">Productivity Score</div></div>
</div>

<!-- 1. Meetings Per Week -->
<div class="card">
  <h2>&#x1F4CA; Meetings Per Week</h2>
  <div class="chart-full"><canvas id="weekChart"></canvas></div>
</div>

<!-- 2 & 3. Task Completion + Productivity Score -->
<div class="g2">
  <div class="card">
    <h2>&#x2705; Task Completion</h2>
    <div class="chart-half"><canvas id="donutChart"></canvas></div>
    <p style="text-align:center;font-size:12px;color:#8b949e;margin-top:12px">${done} completed &nbsp;/&nbsp; ${total} total tasks</p>
  </div>
  <div class="card">
    <h2>&#x1F3C6; Productivity Score</h2>
    <div class="ps-ring">
      <div>
        <div class="ring-num">${productivityScore}</div>
        <div class="ring-label">out of 100</div>
      </div>
      <div class="ring-desc">
        Task completion:&nbsp;<b>${rate}%</b><br>
        AI meeting coverage:&nbsp;<b>${Math.round(aiCoverage * 100)}%</b><br>
        Meeting activity:&nbsp;<b>${Math.round(activityScore * 100)}%</b>
      </div>
    </div>
    <div class="chart-half" style="height:190px"><canvas id="radarChart"></canvas></div>
  </div>
</div>

<!-- 4 & 5. Top Assignees + Busiest Days -->
<div class="g2">
  <div class="card">
    <h2>&#x1F464; Top Assignees</h2>
    <div class="chart-half"><canvas id="assigneeChart"></canvas></div>
  </div>
  <div class="card">
    <h2>&#x1F4C6; Busiest Meeting Days</h2>
    <div class="chart-half"><canvas id="dayChart"></canvas></div>
  </div>
</div>

</div>
<div class="ftr">ClawMeet Bot &bull; Analytics &bull; <a href="/dashboard/" style="color:#58a6ff;text-decoration:none">&#x2190; Back to Dashboard</a></div>

<script>
const gridColor = 'rgba(255,255,255,0.05)';
const labelColor = '#8b949e';
const blue2 = '#58a6ff';
const green2 = '#3fb950';

new Chart(document.getElementById('weekChart'), {
  type: 'bar',
  data: {
    labels: ${weekLabels},
    datasets: [{ label: 'Meetings', data: ${weekCounts}, backgroundColor: 'rgba(88,166,255,0.25)', borderColor: blue2, borderWidth: 2, borderRadius: 6 }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: labelColor }, grid: { color: gridColor } },
      y: { ticks: { color: labelColor, stepSize: 1 }, grid: { color: gridColor }, beginAtZero: true }
    }
  }
});

new Chart(document.getElementById('donutChart'), {
  type: 'doughnut',
  data: {
    labels: ['Done', 'Pending'],
    datasets: [{ data: [${done}, ${total - done}], backgroundColor: ['rgba(63,185,80,0.8)','rgba(33,38,45,0.9)'], borderColor: ['#3fb950','#30363d'], borderWidth: 2, hoverOffset: 6 }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    cutout: '68%',
    plugins: { legend: { position: 'bottom', labels: { color: labelColor, font: { size: 11 }, padding: 10 } } }
  }
});

new Chart(document.getElementById('radarChart'), {
  type: 'radar',
  data: {
    labels: ['Tasks \u2705', 'AI Coverage \uD83E\uDD16', 'Activity \uD83D\uDCC5'],
    datasets: [{ data: ${radarData}, backgroundColor: 'rgba(88,166,255,0.15)', borderColor: blue2, borderWidth: 2, pointBackgroundColor: blue2 }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    scales: {
      r: {
        min: 0, max: 100,
        ticks: { color: labelColor, stepSize: 25, backdropColor: 'transparent', font: { size: 9 } },
        grid: { color: gridColor }, angleLines: { color: gridColor },
        pointLabels: { color: labelColor, font: { size: 10 } }
      }
    },
    plugins: { legend: { display: false } }
  }
});

const assignees = ${JSON.stringify((analytics.topAssignees || []))};
new Chart(document.getElementById('assigneeChart'), {
  type: 'bar',
  data: {
    labels: assignees.map(a => a.person),
    datasets: [{ axis: 'y', label: 'Tasks', data: assignees.map(a => a.count), backgroundColor: 'rgba(35,134,54,0.4)', borderColor: green2, borderWidth: 2, borderRadius: 4 }]
  },
  options: {
    indexAxis: 'y',
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: labelColor, stepSize: 1 }, grid: { color: gridColor }, beginAtZero: true },
      y: { ticks: { color: labelColor }, grid: { display: false } }
    }
  }
});

const days = ${JSON.stringify((analytics.busiestDays || []))};
new Chart(document.getElementById('dayChart'), {
  type: 'bar',
  data: {
    labels: days.map(d => d.day),
    datasets: [{ label: 'Meetings', data: days.map(d => d.count), backgroundColor: 'rgba(210,153,34,0.35)', borderColor: '#d29922', borderWidth: 2, borderRadius: 4 }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: labelColor }, grid: { color: gridColor } },
      y: { ticks: { color: labelColor, stepSize: 1 }, grid: { color: gridColor }, beginAtZero: true }
    }
  }
});
<\/script>
</body></html>`;
}


// ── Developer API page ───────────────────────────────────────────────────────
router.get("/developer", authCheck, (req, res) => {
  res.send(buildDevHtml());
});

function buildDevHtml() {
  const now = new Date().toLocaleString("en-IN", {
    timeZone: process.env.TIMEZONE || "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
  });
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Developer API &#x2014; ClawMeet Bot</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;color:#e1e4e8;min-height:100vh}
.hdr{background:#161b22;border-bottom:1px solid #30363d;padding:16px 28px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.hdr h1{font-size:18px;font-weight:700;color:#58a6ff}
.hdr .sub{font-size:11px;color:#8b949e;margin-top:3px}
.hdr-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.btn{background:#21262d;border:1px solid #30363d;color:#58a6ff;padding:6px 14px;border-radius:6px;text-decoration:none;font-size:12px;white-space:nowrap}
.btn:hover{background:#30363d}
.main{padding:26px 28px;max-width:960px;margin:0 auto}
.page-title{font-size:22px;font-weight:700;color:#c9d1d9;margin-bottom:4px}
.page-sub{font-size:12px;color:#8b949e;margin-bottom:28px}
.card{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:24px;margin-bottom:24px}
.card h2{font-size:13px;font-weight:600;color:#8b949e;margin-bottom:16px;padding-bottom:10px;border-bottom:1px solid #21262d;text-transform:uppercase;letter-spacing:.5px}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;color:#8b949e;font-weight:500;padding:7px 10px;border-bottom:1px solid #21262d}
td{padding:8px 10px;border-bottom:1px solid #0d1117;color:#c9d1d9;vertical-align:middle}
tr:hover td{background:#1c2128}
.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;font-family:monospace}
.badge-get{background:#1a4731;color:#3fb950}
.badge-post{background:#1a3a5c;color:#58a6ff}
.badge-patch{background:#3d2f00;color:#d29922}
code{background:#0d1117;border:1px solid #30363d;padding:2px 7px;border-radius:4px;font-size:11px;font-family:monospace;color:#e1e4e8}
.info-box{background:#0d1117;border:1px solid #1f6feb;border-radius:8px;padding:16px 18px;margin-bottom:20px;font-size:12px;color:#8b949e;line-height:1.8}
.info-box b{color:#58a6ff}
.warn-box{background:#1c1600;border:1px solid #d29922;border-radius:8px;padding:14px 18px;margin-bottom:20px;font-size:12px;color:#d29922;line-height:1.8}
.tag{display:inline-block;background:#21262d;border:1px solid #30363d;border-radius:4px;padding:1px 6px;font-size:10px;color:#8b949e;margin-left:6px;font-family:monospace}
.chips{display:flex;gap:10px;flex-wrap:wrap}
.chip{background:#21262d;border:1px solid #30363d;border-radius:6px;padding:6px 14px;font-size:12px;color:#c9d1d9}
.ftr{text-align:center;padding:16px;color:#484f58;font-size:11px;border-top:1px solid #21262d;margin-top:8px}
@media(max-width:600px){.main{padding:14px 12px}.hdr{padding:12px 14px}}
</style>
</head>
<body>
<div class="hdr">
  <div><h1>&#x1F527; Developer API</h1><div class="sub">ClawMeet Bot REST Reference &bull; ${esc(now)}</div></div>
  <div class="hdr-right">
    <a href="/dashboard/" class="btn">&#x1F3E0; Team Dashboard</a>
    <a href="/dashboard/analytics" class="btn">&#x1F4CA; Analytics</a>
  </div>
</div>
<div class="main">
<div class="page-title">&#x1F527; REST API Reference</div>
<div class="page-sub">For developers, integrations, automation &amp; external services &mdash; not intended for regular users</div>

<div class="info-box">
  <b>Authentication</b><br>
  All endpoints require either:<br>
  &bull; Query param: <code>?token=DASHBOARD_TOKEN</code><br>
  &bull; Header: <code>Authorization: Bearer DASHBOARD_TOKEN</code>
</div>

<div class="warn-box">
  &#x26A0; This page is intended for developers and admins only. Do not share links to this page with regular users.
</div>

<div class="card">
  <h2>&#x2705; Tasks</h2>
  <table>
    <thead><tr><th style="width:80px">Method</th><th style="width:300px">Endpoint</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><span class="badge badge-get">GET</span></td><td><code>/api/tasks</code></td><td>All pending team tasks</td></tr>
      <tr><td><span class="badge badge-post">POST</span></td><td><code>/api/tasks</code></td><td>Create team task &mdash; body: <code>{ person, task, deadline }</code></td></tr>
      <tr><td><span class="badge badge-patch">PATCH</span></td><td><code>/api/tasks/:id/done</code></td><td>Mark team task as done</td></tr>
      <tr><td><span class="badge badge-get">GET</span></td><td><code>/api/tasks/personal/:telegramId</code></td><td>Personal tasks for a user <span class="tag">private</span></td></tr>
    </tbody>
  </table>
</div>

<div class="card">
  <h2>&#x1F4DD; Notes &amp; Transcripts</h2>
  <table>
    <thead><tr><th style="width:80px">Method</th><th style="width:300px">Endpoint</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><span class="badge badge-get">GET</span></td><td><code>/api/notes/meeting/:meetingId</code></td><td>Notes for a meeting</td></tr>
      <tr><td><span class="badge badge-get">GET</span></td><td><code>/api/notes/personal/:telegramId</code></td><td>Personal notes for a user <span class="tag">private</span></td></tr>
      <tr><td><span class="badge badge-get">GET</span></td><td><code>/api/notes/transcript/:meetingId</code></td><td>Full transcript for a meeting</td></tr>
    </tbody>
  </table>
</div>

<div class="card">
  <h2>&#x1F464; Auth &amp; Users</h2>
  <table>
    <thead><tr><th style="width:80px">Method</th><th style="width:300px">Endpoint</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><span class="badge badge-get">GET</span></td><td><code>/api/auth/user/:telegramId</code></td><td>Fetch user profile</td></tr>
      <tr><td><span class="badge badge-post">POST</span></td><td><code>/api/auth/link-token</code></td><td>Generate a dashboard login link token</td></tr>
    </tbody>
  </table>
</div>

<div class="card">
  <h2>&#x1F4E1; Works With</h2>
  <p style="font-size:12px;color:#8b949e;margin-bottom:14px">These endpoints can be used with automation tools and custom integrations:</p>
  <div class="chips">
    <span class="chip">&#x26A1; Zapier</span>
    <span class="chip">&#x1F9F6; n8n</span>
    <span class="chip">&#x1F504; Make.com</span>
    <span class="chip">&#x1F916; Custom AI agents</span>
    <span class="chip">&#x1F4CB; Postman / curl</span>
  </div>
</div>

</div>
<div class="ftr">ClawMeet Bot &bull; <a href="/dashboard/" style="color:#58a6ff;text-decoration:none">&#x2190; Back to Dashboard</a></div>
</body></html>`;
}

function buildPublicHtml({ meetStats, taskStats, analytics, meetings }) {
  const now = new Date().toLocaleString("en-IN", {
    timeZone: process.env.TIMEZONE || "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
  });
  const rate = analytics.completionRate ?? 0;
  const maxWk = Math.max(...(analytics.weeks || []).map((w) => w.count), 1);
  const weekBars = (analytics.weeks || []).map((w) => {
    const h = Math.max(4, Math.round((w.count / maxWk) * 80));
    return `<div class="bw"><div class="bar" style="height:${h}px"></div><div class="bl">${esc(w.week)}</div><div class="bv">${w.count}</div></div>`;
  }).join("") || `<p class="empty">No data yet</p>`;
  const meetRows = meetings.slice(0, 8).map((m) =>
    `<tr><td>${esc(m.subject)}</td><td>${fmtTime(m.start_time)}</td><td>${esc(m.organizer || "—")}</td><td>${m.summary ? '<span class="badge g">✓ AI</span>' : '<span class="badge gr">—</span>'}</td></tr>`
  ).join("") || `<tr><td colspan="4" class="empty">No meetings yet</td></tr>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>ClawMeet — Public Overview</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;color:#e1e4e8;min-height:100vh}
.hdr{background:#161b22;border-bottom:1px solid #30363d;padding:16px 28px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}
.hdr h1{font-size:19px;font-weight:700;color:#58a6ff}.hdr .sub{font-size:11px;color:#8b949e;margin-top:3px}
.nav a{background:#21262d;border:1px solid #30363d;color:#58a6ff;padding:6px 14px;border-radius:6px;text-decoration:none;font-size:12px;margin-left:8px}
.nav a:hover{background:#30363d}
.main{padding:20px 28px;max-width:1200px;margin:0 auto}
.srow{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px}
.sc{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px}
.sc .val{font-size:28px;font-weight:700;color:#58a6ff}.sc .lbl{font-size:11px;color:#8b949e;margin-top:3px;text-transform:uppercase;letter-spacing:.4px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:20px}@media(max-width:700px){.g2{grid-template-columns:1fr}}
.card,.fc{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:18px}
.card h2,.fc h2{font-size:13px;font-weight:600;color:#c9d1d9;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #21262d}
table{width:100%;border-collapse:collapse;font-size:12px}th{text-align:left;color:#8b949e;font-weight:500;padding:6px 7px;border-bottom:1px solid #21262d}
td{padding:6px 7px;border-bottom:1px solid #0d1117;color:#c9d1d9}tr:hover td{background:#1c2128}
.empty{text-align:center;color:#484f58;padding:14px}.badge{display:inline-block;padding:2px 6px;border-radius:10px;font-size:10px}
.badge.g{background:#1a4731;color:#3fb950}.badge.gr{background:#21262d;color:#8b949e}
.bc{display:flex;align-items:flex-end;gap:8px;height:90px;padding:4px 0}
.bw{display:flex;flex-direction:column;align-items:center;flex:1}
.bar{background:linear-gradient(to top,#1f6feb,#58a6ff);border-radius:3px 3px 0 0;width:100%;min-height:4px}
.bl{font-size:9px;color:#8b949e;margin-top:4px;text-align:center}.bv{font-size:10px;color:#58a6ff;margin-top:1px}
.pbg{background:#21262d;border-radius:4px;height:9px;margin-top:8px}.pb{background:linear-gradient(to right,#238636,#3fb950);border-radius:4px;height:100%}
.ftr{text-align:center;padding:14px;color:#484f58;font-size:11px;border-top:1px solid #21262d}
</style></head><body>
<div class="hdr">
  <div><h1>🤖 ClawMeet — Team Overview</h1><div class="sub">Public view · ${esc(now)}</div></div>
  <div class="nav"><a href="/dashboard/login">🔐 My Dashboard</a></div>
</div>
<div class="main">
<div class="srow">
  <div class="sc"><div class="val">${meetStats.total ?? 0}</div><div class="lbl">Total Meetings</div></div>
  <div class="sc"><div class="val">${meetStats.thisWeek ?? 0}</div><div class="lbl">This Week</div></div>
  <div class="sc"><div class="val">${taskStats.pending ?? 0}</div><div class="lbl">Pending Tasks</div></div>
  <div class="sc"><div class="val">${taskStats.doneThisMonth ?? 0}</div><div class="lbl">Done (30d)</div></div>
  <div class="sc"><div class="val">${rate}%</div><div class="lbl">Completion Rate</div></div>
</div>
<div class="g2">
  <div class="card"><h2>📊 Meetings per Week</h2><div class="bc">${weekBars}</div></div>
  <div class="card"><h2>✅ Task Completion</h2>
    <div style="font-size:28px;font-weight:700;color:#3fb950">${rate}%</div>
    <div style="font-size:11px;color:#8b949e;margin-top:2px">${analytics.doneTasks ?? 0} done / ${(analytics.doneTasks ?? 0) + (analytics.pendingTasks ?? 0)} total</div>
    <div class="pbg"><div class="pb" style="width:${rate}%"></div></div>
  </div>
</div>
<div class="fc"><h2>🕑 Recent Meetings</h2>
  <table><thead><tr><th>Subject</th><th>Start</th><th>Organizer</th><th>AI Summary</th></tr></thead>
  <tbody>${meetRows}</tbody></table>
</div>
<div style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:20px;text-align:center">
  <p style="color:#8b949e;font-size:13px;margin-bottom:12px">Want to see your personal tasks and notes?</p>
  <a href="/dashboard/login" style="background:#238636;color:#fff;padding:9px 22px;border-radius:6px;text-decoration:none;font-size:13px">🔐 Log in with Telegram Link Token</a>
</div>
</div>
<div class="ftr">ClawMeet Bot · Real-time team meeting intelligence</div>
</body></html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// LOGIN PAGE HTML
// ══════════════════════════════════════════════════════════════════════════════

function buildLoginHtml({ error, msg } = {}) {
  const botName = process.env.TELEGRAM_BOT_USERNAME || "your ClawMeet bot";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>ClawMeet — Login</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;color:#e1e4e8;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.box{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:36px 32px;width:100%;max-width:420px}
.logo{font-size:32px;margin-bottom:10px}.title{font-size:21px;font-weight:700;color:#58a6ff;margin-bottom:4px}
.subtitle{font-size:13px;color:#8b949e;margin-bottom:28px;line-height:1.5}
label{display:block;font-size:12px;color:#8b949e;margin-bottom:6px;font-weight:500}
input{width:100%;padding:10px 13px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e1e4e8;font-size:14px;margin-bottom:16px;outline:none;font-family:monospace}
input:focus{border-color:#58a6ff}
button{width:100%;padding:11px;background:#238636;border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:14px;font-weight:600}
button:hover{background:#2ea043}
.err{background:#2d1117;border:1px solid #f85149;color:#f85149;padding:10px 13px;border-radius:6px;font-size:12px;margin-bottom:16px}
.ok{background:#0d2818;border:1px solid #3fb950;color:#3fb950;padding:10px 13px;border-radius:6px;font-size:12px;margin-bottom:16px}
.hint{background:#0d1117;border:1px solid #21262d;border-radius:8px;padding:14px;margin-top:20px;font-size:12px;color:#8b949e;line-height:1.7}
.hint strong{color:#c9d1d9}.hint code{background:#161b22;padding:2px 6px;border-radius:4px;font-family:monospace;color:#d2a8ff}
.pub{display:block;text-align:center;margin-top:18px;color:#58a6ff;font-size:12px;text-decoration:none}
.pub:hover{text-decoration:underline}
</style></head><body>
<div class="box">
  <div class="logo">🔐</div>
  <div class="title">ClawMeet Dashboard</div>
  <div class="subtitle">Sign in with your personal link token to view your workspace.</div>
  ${error ? `<div class="err">❌ ${esc(error)}</div>` : ""}
  ${msg && !error ? `<div class="ok">✓ ${esc(msg)}</div>` : ""}
  <form method="POST" action="/dashboard/login">
    <label>Your Link Token</label>
    <input type="password" name="link_token" placeholder="Paste your link token here" required autocomplete="off">
    <button type="submit">Sign In →</button>
  </form>
  <div class="hint">
    <strong>How to get your token:</strong><br>
    1. Open Telegram<br>
    2. Send <code>/myprofile</code> to ${esc(botName)}<br>
    3. Copy the token shown in the reply<br>
    4. Paste it above and sign in
  </div>
  <a class="pub" href="/dashboard/public">👀 View public team overview (no login)</a>
</div>
</body></html>`;
}

// ══════════════════════════════════════════════════════════════════════════════
// PERSONAL DASHBOARD HTML
// ══════════════════════════════════════════════════════════════════════════════

function buildPersonalHtml({ user, myTasks, myNotes }) {
  const name = esc(user.name || "Team Member");
  const initials = (user.name || "?").split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  const overdueCount = myTasks.filter((t) => t.deadline && new Date(t.deadline) < new Date()).length;

  // Task rows — with edit form (hidden by default) and delete/done buttons
  const taskRows = myTasks.map((t) => {
    const dlCls = t.deadline && new Date(t.deadline) < new Date() ? " overdue" : "";
    return `
    <tr id="task-row-${t.id}">
      <td class="task-text">${esc(t.task)}</td>
      <td class="task-dl${dlCls}">${esc(t.deadline || "\u2014")}</td>
      <td class="task-actions">
        <form method="POST" action="/dashboard/me/task/${t.id}/done" style="display:inline">
          <button type="submit" class="btn btn-done" title="Mark done">&#x2713; Done</button>
        </form>
        <button type="button" class="btn btn-edit" onclick="toggleEdit(${t.id})" title="Edit">&#x270E; Edit</button>
        <form method="POST" action="/dashboard/me/task/${t.id}/delete" style="display:inline"
              onsubmit="return confirm('Delete this task?')">
          <button type="submit" class="btn btn-del" title="Delete">&#x1F5D1;</button>
        </form>
      </td>
    </tr>
    <tr id="edit-row-${t.id}" class="edit-row" style="display:none">
      <td colspan="3">
        <form method="POST" action="/dashboard/me/task/${t.id}/edit" class="inline-form">
          <input name="task" value="${esc(t.task)}" required class="inp" placeholder="Task text"/>
          <input name="deadline" value="${esc(t.deadline || "")}" class="inp inp-sm" placeholder="YYYY-MM-DD" type="date"/>
          <button type="submit" class="btn btn-save">Save</button>
          <button type="button" class="btn btn-cancel" onclick="toggleEdit(${t.id})">Cancel</button>
        </form>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="3" class="empty">No pending tasks &#x1F389;<br><small>Use the form above to add one</small></td></tr>`;

  // Note rows — with edit form and delete button
  const noteRows = myNotes.map((n) => {
    const date = n.created_at ? n.created_at.substring(0, 10) : "";
    return `
    <div class="note-item" id="note-${n.id}">
      <div class="note-body">
        <div class="note-text" id="note-text-${n.id}">${esc(n.note)}</div>
        <form id="note-edit-form-${n.id}" method="POST" action="/dashboard/me/note/${n.id}/edit"
              class="note-edit-form" style="display:none">
          <textarea name="note" required class="note-ta">${esc(n.note)}</textarea>
          <div class="note-edit-btns">
            <button type="submit" class="btn btn-save">Save</button>
            <button type="button" class="btn btn-cancel" onclick="toggleNoteEdit(${n.id})">Cancel</button>
          </div>
        </form>
      </div>
      <div class="note-meta">
        <span class="note-date">${date}</span>
        <div class="note-act">
          <button type="button" class="btn btn-edit" onclick="toggleNoteEdit(${n.id})" title="Edit">&#x270E;</button>
          <form method="POST" action="/dashboard/me/note/${n.id}/delete" style="display:inline"
                onsubmit="return confirm('Delete this note?')">
            <button type="submit" class="btn btn-del" title="Delete">&#x1F5D1;</button>
          </form>
        </div>
      </div>
    </div>`;
  }).join("") || `<div class="empty">No notes yet.<br><small>Use the form below to add one</small></div>`;

  const now = new Date().toLocaleString("en-IN", {
    timeZone: process.env.TIMEZONE || "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
  });

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>ClawMeet \u2014 My Workspace</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;color:#e1e4e8;min-height:100vh}
.hdr{background:#161b22;border-bottom:1px solid #30363d;padding:14px 24px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}
.hdr-left{display:flex;align-items:center;gap:12px}
.avatar{width:38px;height:38px;background:linear-gradient(135deg,#1f6feb,#58a6ff);border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:#fff;flex-shrink:0}
.hdr-title{font-size:16px;font-weight:600;color:#c9d1d9}.hdr-sub{font-size:11px;color:#8b949e;margin-top:2px}
.nav{display:flex;gap:8px;flex-wrap:wrap}
.nav a{background:#21262d;border:1px solid #30363d;color:#8b949e;padding:5px 12px;border-radius:6px;text-decoration:none;font-size:12px}
.nav a:hover{color:#e1e4e8;background:#30363d}
.nav a.danger{color:#f85149;border-color:#f85149;font-weight:500}
.nav a.danger:hover{background:#2d1117}
.main{padding:20px 24px;max-width:1200px;margin:0 auto}
/* KPI cards */
.srow{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:22px}
.sc{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px}
.sc .val{font-size:26px;font-weight:700;color:#58a6ff}.sc .lbl{font-size:11px;color:#8b949e;margin-top:3px;text-transform:uppercase;letter-spacing:.4px}
.sc.ov .val{color:#f85149}
/* Two-column grid */
.g2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media(max-width:780px){.g2{grid-template-columns:1fr}}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.card-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #21262d}
.card-hdr h2{font-size:13px;font-weight:600;color:#c9d1d9}
.card-hdr span{font-size:11px;color:#484f58;font-weight:400}
/* Add forms */
.add-form{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.add-form .inp{flex:1;min-width:120px;padding:7px 10px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e1e4e8;font-size:12px;outline:none}
.add-form .inp:focus{border-color:#58a6ff}
.add-form .inp-sm{max-width:130px}
/* Table */
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;color:#8b949e;font-weight:500;padding:6px 7px;border-bottom:1px solid #21262d}
td{padding:7px 7px;border-bottom:1px solid #0d1117;color:#c9d1d9;vertical-align:middle}
tr:hover td{background:#1c2128}
.edit-row td{background:#0d1117 !important;padding:8px 7px}
.task-actions{white-space:nowrap;width:1%}
.overdue{color:#f85149;font-weight:500}
/* Inline edit form in table */
.inline-form{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.inline-form .inp{padding:5px 8px;background:#161b22;border:1px solid #30363d;border-radius:5px;color:#e1e4e8;font-size:12px;outline:none;flex:1;min-width:100px}
.inline-form .inp:focus{border-color:#58a6ff}
.inline-form .inp-sm{max-width:130px}
/* Buttons */
.btn{padding:3px 9px;border:1px solid transparent;border-radius:5px;cursor:pointer;font-size:11px;font-weight:500;transition:opacity .15s}
.btn-done{background:#1a4731;color:#3fb950;border-color:#238636}.btn-done:hover{background:#1d5738}
.btn-edit{background:#1a3a5c;color:#58a6ff;border-color:#1f6feb}.btn-edit:hover{background:#1f3d6b}
.btn-del{background:#2d1117;color:#f85149;border-color:#6e2024;font-size:13px;padding:2px 7px}.btn-del:hover{background:#3d1117}
.btn-save{background:#238636;color:#fff;border-color:#2ea043}.btn-save:hover{background:#2ea043}
.btn-cancel{background:#21262d;color:#8b949e;border-color:#30363d}.btn-cancel:hover{color:#e1e4e8}
.btn-add{background:#238636;color:#fff;border-color:#2ea043;padding:7px 14px;font-size:12px}.btn-add:hover{background:#2ea043}
/* Empty state */
.empty{text-align:center;color:#484f58;padding:18px;font-size:12px;line-height:1.8}
.empty small{font-size:11px}
/* Notes */
.notes-scroll{max-height:420px;overflow-y:auto}
.note-item{padding:11px 0;border-bottom:1px solid #1c2128;display:flex;gap:10px;align-items:flex-start}
.note-item:last-child{border-bottom:none}
.note-body{flex:1;min-width:0}
.note-text{font-size:13px;color:#c9d1d9;line-height:1.55;word-break:break-word}
.note-meta{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0}
.note-date{font-size:10px;color:#484f58}
.note-act{display:flex;gap:4px}
.note-edit-form{margin-top:6px}
.note-ta{width:100%;padding:7px 9px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e1e4e8;font-size:12px;font-family:inherit;resize:vertical;min-height:60px;outline:none}
.note-ta:focus{border-color:#58a6ff}
.note-edit-btns{display:flex;gap:6px;margin-top:6px}
/* Add note form */
.note-add-form{margin-top:12px;padding-top:12px;border-top:1px solid #21262d}
.note-add-form textarea{width:100%;padding:8px 10px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e1e4e8;font-size:12px;font-family:inherit;resize:vertical;min-height:64px;outline:none;margin-bottom:8px}
.note-add-form textarea:focus{border-color:#58a6ff}
.ftr{text-align:center;padding:14px;color:#484f58;font-size:11px;border-top:1px solid #21262d;margin-top:20px}
</style></head><body>

<div class="hdr">
  <div class="hdr-left">
    <div class="avatar">${initials}</div>
    <div><div class="hdr-title">Welcome, ${name}</div><div class="hdr-sub">My Workspace &middot; ${esc(now)}</div></div>
  </div>
  <div class="nav">
    <a href="/dashboard/public">&#x1F465; Team View</a>
    <a href="/dashboard">&#x1F3E0; Team Dashboard</a>
    <a href="/dashboard/logout" class="danger">&#x23CF; Logout</a>
  </div>
</div>

<div class="main">

<!-- KPI cards -->
<div class="srow">
  <div class="sc"><div class="val">${myTasks.length}</div><div class="lbl">Pending Tasks</div></div>
  <div class="sc"><div class="val">${myNotes.length}</div><div class="lbl">My Notes</div></div>
  <div class="sc${overdueCount > 0 ? " ov" : ""}"><div class="val">${overdueCount}</div><div class="lbl">Overdue</div></div>
  <div class="sc"><div class="val" style="font-size:14px">${esc(String(user.telegram_id || "\u2014"))}</div><div class="lbl">Telegram ID</div></div>
</div>

<!-- Tasks + Notes -->
<div class="g2">

  <!-- TASKS CARD -->
  <div class="card">
    <div class="card-hdr">
      <h2>&#x1F4CB; My Tasks</h2>
      <span>${myTasks.length} pending</span>
    </div>
    <!-- Add task form -->
    <form method="POST" action="/dashboard/me/task/add" class="add-form">
      <input name="task" class="inp" placeholder="New task..." required/>
      <input name="deadline" type="date" class="inp inp-sm" title="Deadline (optional)"/>
      <button type="submit" class="btn btn-add">+ Add</button>
    </form>
    <!-- Task table -->
    <div style="overflow-x:auto">
    <table>
      <thead><tr><th>Task</th><th>Deadline</th><th>Actions</th></tr></thead>
      <tbody>${taskRows}</tbody>
    </table>
    </div>
  </div>

  <!-- NOTES CARD -->
  <div class="card">
    <div class="card-hdr">
      <h2>&#x1F5D2; My Notes</h2>
      <span>${myNotes.length} notes</span>
    </div>
    <div class="notes-scroll">${noteRows}</div>
    <!-- Add note form -->
    <div class="note-add-form">
      <form method="POST" action="/dashboard/me/note/add">
        <textarea name="note" placeholder="Write a new note..." required></textarea>
        <button type="submit" class="btn btn-add">+ Add Note</button>
      </form>
    </div>
  </div>

</div>
</div>

<div class="ftr">ClawMeet Bot &middot; My Personal Workspace &middot; Data is private to you</div>

<script>
function toggleEdit(id) {
  const row = document.getElementById('edit-row-' + id);
  row.style.display = row.style.display === 'none' ? '' : 'none';
}
function toggleNoteEdit(id) {
  const form = document.getElementById('note-edit-form-' + id);
  const text = document.getElementById('note-text-' + id);
  const show = form.style.display === 'none';
  form.style.display = show ? '' : 'none';
  text.style.display = show ? 'none' : '';
}
</script>
</body></html>`;
}

module.exports = router;

