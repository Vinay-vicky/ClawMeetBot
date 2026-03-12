import Layout from '../components/Layout.jsx'
import { KpiCard, Spinner, ErrorBox } from '../components/KpiCard.jsx'
import { useApi, scoreColor } from '../lib/utils.js'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts'

const GRID   = 'rgba(255,255,255,0.05)'
const LABEL  = '#8b949e'
const BLUE   = '#58a6ff'
const GREEN  = '#3fb950'
const AMBER  = '#d29922'

export default function Analytics() {
  const { data, loading, error } = useApi('/dashboard/api/team')

  if (loading) return <Layout subtitle="Loading…"><Spinner /></Layout>
  if (error)   return <Layout subtitle="Error"><ErrorBox message={error} /></Layout>

  const { meetStats, taskStats, analytics, productivityScore } = data
  const rate  = analytics?.completionRate ?? 0
  const done  = analytics?.doneTasks ?? 0
  const total = done + (analytics?.pendingTasks ?? 0)
  const weeks = analytics?.weeks ?? []
  const assignees = analytics?.topAssignees ?? []
  const days  = analytics?.busiestDays ?? []

  const aiCoverage    = data.summaryCount && data.meetings?.length ? Math.round(data.summaryCount / data.meetings.length * 100) : 0
  const activityScore = Math.min(100, Math.round(((meetStats?.thisWeek ?? 0) / 5) * 100))

  const radarData = [
    { subject: 'Tasks ✅',    A: Math.round(rate) },
    { subject: 'AI Coverage 🤖', A: aiCoverage },
    { subject: 'Activity 📅', A: activityScore },
  ]
  const donutData = [
    { name: 'Done',    value: done },
    { name: 'Pending', value: total - done },
  ]
  const pClass = scoreColor(productivityScore)

  const tooltipStyle = { backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: 6, fontSize: 11 }

  return (
    <Layout subtitle="Team Analytics — all charts in one focused view">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-200">📊 Analytics Overview</h2>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        <KpiCard label="Total Meetings"  value={meetStats?.total ?? 0} />
        <KpiCard label="This Week"       value={meetStats?.thisWeek ?? 0} />
        <KpiCard label="Pending Tasks"   value={taskStats?.pending ?? 0} />
        <KpiCard label="Done (30d)"      value={taskStats?.doneThisMonth ?? 0} colorClass="text-green-400" />
        <KpiCard label="Completion Rate" value={`${rate}%`} colorClass="text-green-400" />
        <KpiCard label="Productivity"    value={productivityScore} colorClass={pClass} />
      </div>

      {/* 1. Meetings Per Week — full width */}
      <div className="card mb-6">
        <h3 className="section-title">📊 Meetings Per Week</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={weeks} margin={{ top: 4, right: 4, left: -10, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis dataKey="week" tick={{ fill: LABEL, fontSize: 11 }} />
            <YAxis tick={{ fill: LABEL, fontSize: 11 }} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="count" name="Meetings" fill={BLUE} fillOpacity={0.8} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 2 + 3. Task Completion + Productivity Score */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="card">
          <h3 className="section-title">✅ Task Completion</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={donutData} cx="50%" cy="50%" innerRadius={65} outerRadius={95} dataKey="value">
                <Cell fill="rgba(63,185,80,0.85)" stroke="#3fb950" strokeWidth={2} />
                <Cell fill="rgba(33,38,45,0.9)"   stroke="#30363d" strokeWidth={2} />
              </Pie>
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11, color: LABEL }} />
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <p className="text-center text-xs text-muted mt-1">{done} completed / {total} total tasks</p>
        </div>

        <div className="card">
          <h3 className="section-title">🏆 Productivity Score</h3>
          <div className="flex items-center gap-5 mb-4">
            <div>
              <div className={`text-5xl font-bold ${pClass}`}>{productivityScore}</div>
              <div className="text-xs text-muted mt-1">out of 100</div>
            </div>
            <div className="text-sm text-muted leading-8">
              Task completion:&nbsp;<b className="text-gray-300">{rate}%</b><br />
              AI meeting coverage:&nbsp;<b className="text-gray-300">{aiCoverage}%</b><br />
              Meeting activity:&nbsp;<b className="text-gray-300">{activityScore}%</b>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <RadarChart data={radarData} cx="50%" cy="50%" outerRadius={70}>
              <PolarGrid stroke={GRID} />
              <PolarAngleAxis dataKey="subject" tick={{ fill: LABEL, fontSize: 10 }} />
              <PolarRadiusAxis domain={[0, 100]} tick={{ fill: LABEL, fontSize: 8 }} tickCount={4} />
              <Radar dataKey="A" stroke={BLUE} fill={BLUE} fillOpacity={0.15} strokeWidth={2} />
              <Tooltip contentStyle={tooltipStyle} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 4 + 5. Top Assignees + Busiest Days */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="section-title">👤 Top Assignees</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={assignees} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
              <XAxis type="number" tick={{ fill: LABEL, fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="person" tick={{ fill: LABEL, fontSize: 11 }} width={80} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" name="Tasks" fill={GREEN} fillOpacity={0.7} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="section-title">📆 Busiest Meeting Days</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={days} margin={{ top: 4, right: 4, left: -10, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="day" tick={{ fill: LABEL, fontSize: 11 }} />
              <YAxis tick={{ fill: LABEL, fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" name="Meetings" fill={AMBER} fillOpacity={0.8} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Layout>
  )
}
