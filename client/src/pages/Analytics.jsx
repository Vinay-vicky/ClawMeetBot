import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AnalyticsSkeleton, ErrorBox } from '../components/KpiCard.jsx'
import { useApi, scoreColor, backendUrl, getStoredTheme } from '../lib/utils.js'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts'

function getThemeChartTokens(theme) {
  if (theme === 'light') {
    return {
      grid: 'rgba(31,42,68,0.14)',
      label: '#556486',
      blue: '#ca8a04',
      green: '#0f766e',
      amber: '#a16207',
      tooltip: { backgroundColor: '#ffffff', border: '1px solid #d4ddef', borderRadius: 8, fontSize: 11, color: '#1f2a44' },
      doneFill: 'rgba(15,118,110,0.22)',
      doneStroke: '#0f766e',
      pendingFill: 'rgba(85,100,134,0.22)',
      pendingStroke: '#7081a7',
    }
  }

  return {
    grid: 'rgba(255,255,255,0.08)',
    label: '#9ea8c2',
    blue: '#f6d37a',
    green: '#63d2a1',
    amber: '#e6b84e',
    tooltip: { backgroundColor: '#101624', border: '1px solid #2a3145', borderRadius: 8, fontSize: 11, color: '#eef3ff' },
    doneFill: 'rgba(63,185,80,0.8)',
    doneStroke: '#3fb950',
    pendingFill: 'rgba(33,38,45,0.9)',
    pendingStroke: '#30363d',
  }
}

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
          <a href={backendUrl('/dashboard/logout')} className="refresh signout-link">Sign out</a>
        </div>
      </div>
      <div className="main-analytics">{children}</div>
      <div className="ftr">
        ClawMeet Bot &bull; Analytics &bull;{' '}
        <Link to={'/team' + search} className="ftr-link-brand">← Back to Dashboard</Link>
      </div>
    </div>
  )
}

export default function Analytics() {
  const { data, loading, error } = useApi('/dashboard/api/team')
  const [theme, setTheme] = useState(() => getStoredTheme())

  useEffect(() => {
    const onThemeChange = (event) => {
      setTheme(event?.detail === 'light' ? 'light' : 'dark')
    }
    window.addEventListener('cmbt-theme-change', onThemeChange)
    return () => window.removeEventListener('cmbt-theme-change', onThemeChange)
  }, [])

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
  const chartTheme = useMemo(() => getThemeChartTokens(theme), [theme])

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
              <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
              <XAxis dataKey="week" tick={{ fill:chartTheme.label, fontSize:11 }} />
              <YAxis tick={{ fill:chartTheme.label, fontSize:11 }} allowDecimals={false} />
              <Tooltip contentStyle={chartTheme.tooltip} />
              <Bar dataKey="count" name="Meetings" fill={chartTheme.blue} fillOpacity={0.8} radius={[4,4,0,0]} />
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
                  <Cell fill={chartTheme.doneFill} stroke={chartTheme.doneStroke} strokeWidth={2} />
                  <Cell fill={chartTheme.pendingFill} stroke={chartTheme.pendingStroke} strokeWidth={2} />
                </Pie>
                <Legend iconSize={10} wrapperStyle={{ fontSize:11, color:chartTheme.label }} />
                <Tooltip contentStyle={chartTheme.tooltip} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <p className="analytics-muted-copy">{done} completed / {total} total tasks</p>
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
                <PolarGrid stroke={chartTheme.grid} />
                <PolarAngleAxis dataKey="subject" tick={{ fill:chartTheme.label, fontSize:10 }} />
                <PolarRadiusAxis domain={[0,100]} tick={{ fill:chartTheme.label, fontSize:8 }} tickCount={4} />
                <Radar dataKey="A" stroke={chartTheme.blue} fill={chartTheme.blue} fillOpacity={0.15} strokeWidth={2} />
                <Tooltip contentStyle={chartTheme.tooltip} />
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
                <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} horizontal={false} />
                <XAxis type="number" tick={{ fill:chartTheme.label, fontSize:11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="person" tick={{ fill:chartTheme.label, fontSize:11 }} width={80} />
                <Tooltip contentStyle={chartTheme.tooltip} />
                <Bar dataKey="count" name="Tasks" fill={chartTheme.green} fillOpacity={0.7} radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="analytics-card card">
          <h2>Busiest Meeting Days</h2>
          <div className="chart-half">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={days} margin={{ top:4, right:4, left:-10, bottom:4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
                <XAxis dataKey="day" tick={{ fill:chartTheme.label, fontSize:11 }} />
                <YAxis tick={{ fill:chartTheme.label, fontSize:11 }} allowDecimals={false} />
                <Tooltip contentStyle={chartTheme.tooltip} />
                <Bar dataKey="count" name="Meetings" fill={chartTheme.amber} fillOpacity={0.8} radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </AnalyticsLayout>
  )
}
