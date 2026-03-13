import { Link, useLocation } from 'react-router-dom'
import { AnalyticsSkeleton, ErrorBox } from '../components/KpiCard.jsx'
import { useApi, scoreColor, backendUrl } from '../lib/utils.js'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts'

const GRID  = 'rgba(255,255,255,0.08)'
const LABEL = '#9ea8c2'
const BLUE  = '#f6d37a'
const GREEN = '#63d2a1'
const AMBER = '#e6b84e'
const TT    = { backgroundColor:'#101624', border:'1px solid #2a3145', borderRadius:8, fontSize:11 }

function AnalyticsLayout({ children }) {
  const { search } = useLocation()

  return (
    <div>
      <div className="hdr">
        <div>
          <h1>Team Analytics</h1>
          <div className="sub"><span className="live-dot" /> Charts &amp; metrics overview</div>
        </div>
        <div className="hdr-right">
          <Link to={'/team' + search}    className="refresh">Team Dashboard</Link>
          <Link to={'/public' + search}  className="refresh">Team View</Link>
          <Link to={'/me' + search}      className="refresh">My Dashboard</Link>
          <a href={backendUrl('/dashboard/logout')} className="refresh" style={{ color:'#8b949e' }}>Sign out</a>
        </div>
      </div>
      <div className="main-analytics">{children}</div>
      <div className="ftr">
        ClawMeet Bot &bull; Analytics &bull;{' '}
        <Link to={'/team' + search} style={{ color:'var(--brand)', textDecoration:'none' }}>← Back to Dashboard</Link>
      </div>
    </div>
  )
}

export default function Analytics() {
  const { data, loading, error } = useApi('/dashboard/api/team')

  if (loading) return <AnalyticsLayout><AnalyticsSkeleton /></AnalyticsLayout>
  if (error)   return <AnalyticsLayout><ErrorBox message={error} /></AnalyticsLayout>

  const { meetStats, taskStats, analytics, productivityScore } = data
  const rate      = analytics?.completionRate ?? 0
  const done      = analytics?.doneTasks ?? 0
  const total     = done + (analytics?.pendingTasks ?? 0)
  const weeks     = analytics?.weeks ?? []
  const assignees = analytics?.topAssignees ?? []
  const days      = analytics?.busiestDays ?? []
  const aiCov     = data.summaryCount && data.meetings?.length ? Math.round(data.summaryCount / data.meetings.length * 100) : 0
  const actScore  = Math.min(100, Math.round(((meetStats?.thisWeek ?? 0) / 5) * 100))
  const pColor    = scoreColor(productivityScore)

  const radarData = [
    { subject: 'Tasks',       A: Math.round(rate) },
    { subject: 'AI Coverage', A: aiCov },
    { subject: 'Activity',    A: actScore },
  ]
  const donutData = [
    { name: 'Done',    value: done },
    { name: 'Pending', value: total - done },
  ]

  return (
    <AnalyticsLayout>
      <div className="page-title">Analytics Overview</div>
      <div className="page-sub">All meeting and productivity metrics — each chart in its own focused space</div>

      {/* KPIs */}
      <div className="srow">
        <div className="sc"><div className="val">{meetStats?.total ?? 0}</div><div className="lbl">Total Meetings</div></div>
        <div className="sc"><div className="val">{meetStats?.thisWeek ?? 0}</div><div className="lbl">This Week</div></div>
        <div className="sc"><div className="val">{taskStats?.pending ?? 0}</div><div className="lbl">Pending Tasks</div></div>
        <div className="sc"><div className="val">{taskStats?.doneThisMonth ?? 0}</div><div className="lbl">Done (30 days)</div></div>
        <div className="sc"><div className="val">{rate}%</div><div className="lbl">Completion Rate</div></div>
        <div className="sc ps" style={{'--ps-color': pColor}}><div className="val">{productivityScore}</div><div className="lbl">Productivity Score</div></div>
      </div>

      {/* 1. Meetings Per Week */}
      <div className="analytics-card card" style={{ marginBottom:24 }}>
        <h2>Meetings Per Week</h2>
        <div className="chart-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weeks} margin={{ top:4, right:4, left:-10, bottom:4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="week" tick={{ fill:LABEL, fontSize:11 }} />
              <YAxis tick={{ fill:LABEL, fontSize:11 }} allowDecimals={false} />
              <Tooltip contentStyle={TT} />
              <Bar dataKey="count" name="Meetings" fill={BLUE} fillOpacity={0.8} radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 2 + 3. Task Completion + Productivity */}
      <div className="g2">
        <div className="analytics-card card">
          <h2>Task Completion</h2>
          <div className="chart-half">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={donutData} cx="50%" cy="50%" innerRadius={65} outerRadius={95} dataKey="value">
                  <Cell fill="rgba(63,185,80,0.8)" stroke="#3fb950" strokeWidth={2} />
                  <Cell fill="rgba(33,38,45,0.9)"  stroke="#30363d" strokeWidth={2} />
                </Pie>
                <Legend iconSize={10} wrapperStyle={{ fontSize:11, color:LABEL }} />
                <Tooltip contentStyle={TT} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <p style={{ textAlign:'center', fontSize:12, color:'#8b949e', marginTop:12 }}>{done} completed / {total} total tasks</p>
        </div>

        <div className="analytics-card card">
          <h2>Productivity Score</h2>
          <div className="ps-ring">
            <div>
              <div className="ring-num" style={{ color:pColor }}>{productivityScore}</div>
              <div className="ring-label">out of 100</div>
            </div>
            <div className="ring-desc">
              Task completion:&nbsp;<b>{rate}%</b><br />
              AI meeting coverage:&nbsp;<b>{aiCov}%</b><br />
              Meeting activity:&nbsp;<b>{actScore}%</b>
            </div>
          </div>
          <div className="chart-half" style={{ height:190 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} cx="50%" cy="50%" outerRadius={70}>
                <PolarGrid stroke={GRID} />
                <PolarAngleAxis dataKey="subject" tick={{ fill:LABEL, fontSize:10 }} />
                <PolarRadiusAxis domain={[0,100]} tick={{ fill:LABEL, fontSize:8 }} tickCount={4} />
                <Radar dataKey="A" stroke={BLUE} fill={BLUE} fillOpacity={0.15} strokeWidth={2} />
                <Tooltip contentStyle={TT} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 4 + 5. Top Assignees + Busiest Days */}
      <div className="g2">
        <div className="analytics-card card">
          <h2>Top Assignees</h2>
          <div className="chart-half">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={assignees} layout="vertical" margin={{ top:4, right:16, left:8, bottom:4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                <XAxis type="number" tick={{ fill:LABEL, fontSize:11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="person" tick={{ fill:LABEL, fontSize:11 }} width={80} />
                <Tooltip contentStyle={TT} />
                <Bar dataKey="count" name="Tasks" fill={GREEN} fillOpacity={0.7} radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="analytics-card card">
          <h2>Busiest Meeting Days</h2>
          <div className="chart-half">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={days} margin={{ top:4, right:4, left:-10, bottom:4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                <XAxis dataKey="day" tick={{ fill:LABEL, fontSize:11 }} />
                <YAxis tick={{ fill:LABEL, fontSize:11 }} allowDecimals={false} />
                <Tooltip contentStyle={TT} />
                <Bar dataKey="count" name="Meetings" fill={AMBER} fillOpacity={0.8} radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </AnalyticsLayout>
  )
}
