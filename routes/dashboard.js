"use strict";
const express = require("express");
const router = express.Router();
const {
  getRecentMeetings, getPendingTasks, getMeetingStats, getTaskStats, getMeetingAnalytics,
  markTaskDone,
} = require("../services/dbService");
const { getScheduledMeetings } = require("../services/calendarService");
const logger = require("../utils/logger");

// ── Auth middleware ────────────────────────────────────────────────────────────
function authCheck(req, res, next) {
  const token = process.env.DASHBOARD_TOKEN;
  if (!token) return next();
  const provided = req.query.token || req.headers["x-dashboard-token"];
  if (provided === token) return next();
  res.status(401).send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>ClawMeet Dashboard</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:sans-serif;background:#0f1117;color:#e1e4e8;display:flex;align-items:center;justify-content:center;min-height:100vh}.box{text-align:center;padding:40px;background:#161b22;border:1px solid #30363d;border-radius:12px;min-width:300px}h2{color:#58a6ff;margin-bottom:20px;font-size:18px}input{padding:10px 14px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e1e4e8;font-size:14px;width:220px;display:block;margin:0 auto 12px}button{padding:10px 24px;background:#238636;border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:14px}button:hover{background:#2ea043}</style></head>
<body><div class="box"><h2>🔒 ClawMeet Dashboard</h2><form method="GET"><input name="token" type="password" placeholder="Access token" required><button type="submit">Enter</button></form></div></body></html>`);
}

// ── Mark task done (from dashboard) ───────────────────────────────────────────
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

// ── JSON API for auto-refresh ─────────────────────────────────────────────────
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

    const summaryCount = meetings.filter((m) => m.summary).length;
    const aiCoverage   = meetings.length > 0 ? summaryCount / meetings.length : 0;
    const activityScore = Math.min(1, (meetStats.thisWeek ?? 0) / 5);
    const completionFrac = (analytics.completionRate ?? 0) / 100;
    const productivityScore = Math.round(completionFrac * 40 + aiCoverage * 30 + activityScore * 30);

    res.send(buildHtml({ meetings, tasks, meetStats, taskStats, analytics, todayMeetings, tokenParam, productivityScore, summaryCount }));
  } catch (err) {
    logger.error("Dashboard render error:", err);
    res.status(500).send(`<h1 style="color:red;font-family:sans-serif">Dashboard Error</h1><pre>${err.message}</pre>`);
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────────
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

// ── HTML template ──────────────────────────────────────────────────────────────
function buildHtml({ meetings, tasks, meetStats, taskStats, analytics, todayMeetings, tokenParam, productivityScore, summaryCount }) {
  const baseUrl = "/dashboard" + tokenParam;
  const apiUrl  = "/dashboard/api" + tokenParam;
  const now = new Date().toLocaleString("en-IN", {
    timeZone: process.env.TIMEZONE || "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
  });

  const rate  = analytics.completionRate ?? 0;
  const done  = analytics.doneTasks ?? 0;
  const total = done + (analytics.pendingTasks ?? 0);

  // Chart.js data (serialised server-side → safe to embed)
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
    return `<tr><td>${esc(e.subject || "Meeting")}</td><td>${fmtTime(start)}</td><td>${esc(org)}</td><td>${joinUrl ? `<a href="${esc(joinUrl)}" target="_blank" class="join">▶ Join</a>` : "—"}</td></tr>`;
  }).join("") || `<tr><td colspan="4" class="empty">No upcoming meetings in the next 24 hrs</td></tr>`;

  // Recent meetings
  const meetRows = meetings.map((m) =>
    `<tr><td>${esc(m.subject)}</td><td>${fmtTime(m.start_time)}</td><td>${esc(m.organizer || "—")}</td><td>${m.summary ? '<span class="badge g">✓ AI</span>' : '<span class="badge gr">—</span>'}</td><td>${m.join_url ? `<a href="${esc(m.join_url)}" target="_blank" class="join">▶ Join</a>` : "—"}</td></tr>`
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
        <button class="donebtn" type="submit" title="Mark complete">✅</button>
      </form></td>
    </tr>`;
  }).join("") || `<tr><td colspan="6" class="empty">No pending tasks 🎉</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>ClawMeet Bot — Dashboard</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;color:#e1e4e8;min-height:100vh}
.hdr{background:#161b22;border-bottom:1px solid #30363d;padding:16px 28px;display:flex;justify-content:space-between;align-items:center;gap:12px}
.hdr h1{font-size:18px;font-weight:700;color:#58a6ff}
.hdr .sub{font-size:11px;color:#8b949e;margin-top:3px}
.hdr-right{display:flex;align-items:center;gap:10px}
.refresh{background:#21262d;border:1px solid #30363d;color:#58a6ff;padding:6px 14px;border-radius:6px;text-decoration:none;font-size:12px;cursor:pointer}
.refresh:hover{background:#30363d}
.countdown{font-size:11px;color:#8b949e}
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
@media(max-width:900px){.g2,.g3{grid-template-columns:1fr}}
.card,.fc{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px}
.fc{margin-bottom:18px}
.card h2,.fc h2{font-size:12px;font-weight:600;color:#8b949e;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #21262d;text-transform:uppercase;letter-spacing:.5px}
/* Chart containers */
.chart-wrap{position:relative;height:180px}
.chart-sm{position:relative;height:160px;display:flex;align-items:center;justify-content:center}
/* Tables */
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
  <div><h1>🤖 ClawMeet Bot Dashboard</h1><div class="sub"><span class="live-dot"></span>Updated: <span id="ts">${esc(now)}</span></div></div>
  <div class="hdr-right">
    <span class="countdown" id="cd">Auto-refresh in <b id="cds">60</b>s</span>
    <a href="${esc(baseUrl)}" class="refresh" id="rfbtn">↻ Refresh</a>
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
  <h2>📅 Upcoming Meetings (next 24 hrs)</h2>
  <table><thead><tr><th>Meeting</th><th>Start</th><th>Organizer</th><th>Link</th></tr></thead>
  <tbody>${todayRows}</tbody></table>
</div>

<!-- Charts row -->
<div class="g3">
  <div class="card" style="grid-column:span 2">
    <h2>📊 Meetings Per Week</h2>
    <div class="chart-wrap"><canvas id="weekChart"></canvas></div>
  </div>
  <div class="card">
    <h2>✅ Task Completion</h2>
    <div class="chart-sm"><canvas id="donutChart"></canvas></div>
    <p style="text-align:center;font-size:11px;color:#8b949e;margin-top:6px">${done} done / ${total} total</p>
  </div>
</div>

<!-- Productivity + assignees + busiest days -->
<div class="g3">
  <div class="card">
    <h2>🏆 Productivity Score</h2>
    <div style="margin-top:10px">
      <div class="ps-ring">
        <div><div class="ring-num">${productivityScore}</div><div style="font-size:10px;color:#8b949e">out of 100</div></div>
        <div class="ring-desc">
          Tasks completed: <b>${rate}%</b><br>
          AI coverage: <b>${Math.round(aiCoverage * 100)}%</b><br>
          Meeting activity: <b>${Math.round(activityScore * 100)}%</b>
        </div>
      </div>
      <div class="chart-sm" style="height:120px"><canvas id="radarChart"></canvas></div>
    </div>
  </div>
  <div class="card">
    <h2>👤 Top Assignees</h2>
    <div class="chart-wrap"><canvas id="assigneeChart"></canvas></div>
  </div>
  <div class="card">
    <h2>📆 Busiest Meeting Days</h2>
    <div class="chart-wrap"><canvas id="dayChart"></canvas></div>
  </div>
</div>

<!-- Tasks -->
<div class="fc">
  <h2>✅ Pending Tasks <span style="color:#484f58;font-weight:400">(top 30 — click ✅ to complete)</span></h2>
  <table><thead><tr><th>#</th><th>Person</th><th>Task</th><th>Deadline</th><th>Meeting</th><th></th></tr></thead>
  <tbody id="task-tbody">${taskRows}</tbody></table>
</div>

<!-- Recent meetings -->
<div class="fc">
  <h2>🕑 Recent Meetings</h2>
  <table><thead><tr><th>Subject</th><th>Start</th><th>Organizer</th><th>Summary</th><th>Link</th></tr></thead>
  <tbody>${meetRows}</tbody></table>
</div>

</div>
<div class="ftr">ClawMeet Bot &bull; Microsoft Teams + Gemini AI &bull; Node.js &bull; <a href="https://github.com/Vinay-vicky/ClawMeetBot" target="_blank" style="color:#58a6ff;text-decoration:none">GitHub</a></div>

<script>
// ── Chart.js charts ────────────────────────────────────────────────────────
const gridColor = 'rgba(255,255,255,0.05)';
const labelColor = '#8b949e';
const blue1 = '#1f6feb'; const blue2 = '#58a6ff';
const green1 = '#238636'; const green2 = '#3fb950';

// Meetings per week bar chart
new Chart(document.getElementById('weekChart'), {
  type: 'bar',
  data: {
    labels: ${weekLabels},
    datasets: [{
      label: 'Meetings',
      data: ${weekCounts},
      backgroundColor: 'rgba(88,166,255,0.25)',
      borderColor: blue2,
      borderWidth: 2,
      borderRadius: 5,
    }]
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

// Task completion doughnut
new Chart(document.getElementById('donutChart'), {
  type: 'doughnut',
  data: {
    labels: ['Done', 'Pending'],
    datasets: [{
      data: [${done}, ${total - done}],
      backgroundColor: ['rgba(63,185,80,0.8)', 'rgba(33,38,45,0.9)'],
      borderColor: ['#3fb950', '#30363d'],
      borderWidth: 2,
      hoverOffset: 6,
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    cutout: '68%',
    plugins: {
      legend: { position: 'bottom', labels: { color: labelColor, font: { size: 11 }, padding: 10 } }
    }
  }
});

// Productivity radar chart
new Chart(document.getElementById('radarChart'), {
  type: 'radar',
  data: {
    labels: ['Tasks ✅', 'AI Coverage 🤖', 'Activity 📅'],
    datasets: [{
      data: ${radarData},
      backgroundColor: 'rgba(88,166,255,0.15)',
      borderColor: blue2,
      borderWidth: 2,
      pointBackgroundColor: blue2,
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    scales: {
      r: {
        min: 0, max: 100,
        ticks: { color: labelColor, stepSize: 25, backdropColor: 'transparent', font: { size: 9 } },
        grid: { color: gridColor },
        angleLines: { color: gridColor },
        pointLabels: { color: labelColor, font: { size: 10 } }
      }
    },
    plugins: { legend: { display: false } }
  }
});

// Top assignees horizontal bar
const assignees = ${JSON.stringify((analytics.topAssignees || []))};
new Chart(document.getElementById('assigneeChart'), {
  type: 'bar',
  data: {
    labels: assignees.map(a => a.person),
    datasets: [{
      axis: 'y',
      label: 'Tasks',
      data: assignees.map(a => a.count),
      backgroundColor: 'rgba(35,134,54,0.4)',
      borderColor: green2,
      borderWidth: 2,
      borderRadius: 4,
    }]
  },
  options: {
    indexAxis: 'y',
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: labelColor, stepSize: 1 }, grid: { color: gridColor }, beginAtZero: true },
      y: { ticks: { color: labelColor } , grid: { display: false } }
    }
  }
});

// Busiest days bar
const days = ${JSON.stringify((analytics.busiestDays || []))};
new Chart(document.getElementById('dayChart'), {
  type: 'bar',
  data: {
    labels: days.map(d => d.day),
    datasets: [{
      label: 'Meetings',
      data: days.map(d => d.count),
      backgroundColor: 'rgba(210,153,34,0.35)',
      borderColor: '#d29922',
      borderWidth: 2,
      borderRadius: 4,
    }]
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

// ── Auto-refresh ────────────────────────────────────────────────────────────
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

const aiCoverage = ${JSON.stringify(Math.round(aiCoverage * 100))};
</script>
</body></html>`;
}

module.exports = router;


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
