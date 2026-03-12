import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Layout from '../components/Layout.jsx'
import { KpiCard, Spinner, ErrorBox } from '../components/KpiCard.jsx'
import { useApi, fmtTime, deadlineClass } from '../lib/utils.js'

function LiveDot() {
  return <span className="inline-block w-2 h-2 bg-green-400 rounded-full mr-1.5 animate-pulse" />
}

export default function Dashboard() {
  const { data, loading, error, refresh } = useApi('/dashboard/api/team')
  const [countdown, setCountdown] = useState(60)
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { refresh(); return 60 }
        return c - 1
      })
      setNow(new Date())
    }, 1000)
    return () => clearInterval(t)
  }, [refresh])

  if (loading) return <Layout subtitle="Loading…"><Spinner /></Layout>
  if (error)   return <Layout subtitle="Error"><ErrorBox message={error} /></Layout>

  const { meetStats, taskStats, analytics, todayMeetings, meetings, tasks, productivityScore } = data
  const rate  = analytics?.completionRate ?? 0
  const done  = analytics?.doneTasks ?? 0
  const total = done + (analytics?.pendingTasks ?? 0)
  const pClass = productivityScore >= 70 ? 'text-green-400' : productivityScore >= 40 ? 'text-amber-400' : 'text-red-400'

  return (
    <Layout
      subtitle={<><LiveDot />Updated: {now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true })}</>}
    >
      {/* Auto-refresh badge */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-200">👥 Team Dashboard</h2>
        <div className="flex items-center gap-3">
          <span className="text-muted text-xs">Auto-refresh in <b className="text-gray-300">{countdown}s</b></span>
          <button onClick={refresh} className="btn">↻ Refresh</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <KpiCard label="Total Meetings"   value={meetStats?.total ?? 0} />
        <KpiCard label="This Week"        value={meetStats?.thisWeek ?? 0} />
        <KpiCard label="Pending Tasks"    value={taskStats?.pending ?? 0} />
        <KpiCard label="Done (30d)"       value={taskStats?.doneThisMonth ?? 0} colorClass="text-green-400" />
        <KpiCard label="Task Completion"  value={`${rate}%`} colorClass="text-green-400" />
        <KpiCard label="Productivity"     value={productivityScore} colorClass={pClass} />
      </div>

      {/* Analytics CTA */}
      <div className="card border-accent/40 bg-gradient-to-r from-surface to-[#1c2128] text-center py-6 mb-6">
        <div className="text-3xl mb-2">📊</div>
        <p className="text-sm font-semibold text-accent mb-1">Team Analytics</p>
        <p className="text-xs text-muted mb-4">Charts: meetings/week · task completion · productivity · assignees · busiest days</p>
        <Link to="/analytics" className="inline-block bg-accent hover:bg-blue-400 text-base font-semibold text-sm px-5 py-2 rounded-lg transition-colors no-underline">
          📊 View Analytics →
        </Link>
      </div>

      {/* Upcoming Meetings */}
      <div className="card mb-6">
        <h3 className="section-title">📅 Upcoming Meetings (next 24 hrs)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted border-b border-[#21262d]">
                <th className="text-left py-2 px-2 font-medium">Meeting</th>
                <th className="text-left py-2 px-2 font-medium">Start</th>
                <th className="text-left py-2 px-2 font-medium">Organizer</th>
                <th className="text-left py-2 px-2 font-medium">Link</th>
              </tr>
            </thead>
            <tbody>
              {todayMeetings?.length ? todayMeetings.map((m, i) => {
                const joinUrl = m.onlineMeeting?.joinUrl || m.join_url || m.webLink
                return (
                  <tr key={i} className="border-b border-[#0d1117] hover:bg-[#1c2128]">
                    <td className="py-2 px-2 text-gray-300">{m.subject || 'Meeting'}</td>
                    <td className="py-2 px-2 text-muted">{fmtTime(m.start?.dateTime || m.start_time)}</td>
                    <td className="py-2 px-2 text-muted">{m.organizer?.emailAddress?.name || m.organizer || '—'}</td>
                    <td className="py-2 px-2">
                      {joinUrl ? <a href={joinUrl} target="_blank" rel="noreferrer" className="bg-green-900 text-green-400 px-2 py-0.5 rounded text-[10px] font-medium no-underline hover:bg-green-600">▶ Join</a> : '—'}
                    </td>
                  </tr>
                )
              }) : (
                <tr><td colSpan={4} className="text-center text-subtle py-6">No upcoming meetings in the next 24 hrs</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pending Tasks */}
      <div className="card mb-6">
        <h3 className="section-title">✅ Pending Tasks <span className="normal-case font-normal">(click ✅ to complete)</span></h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted border-b border-[#21262d]">
                <th className="text-left py-2 px-2 font-medium w-8">#</th>
                <th className="text-left py-2 px-2 font-medium">Person</th>
                <th className="text-left py-2 px-2 font-medium">Task</th>
                <th className="text-left py-2 px-2 font-medium">Deadline</th>
                <th className="text-left py-2 px-2 font-medium">Meeting</th>
                <th className="py-2 px-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {tasks?.length ? tasks.slice(0, 30).map(t => (
                <tr key={t.id} className="border-b border-[#0d1117] hover:bg-[#1c2128]">
                  <td className="py-2 px-2 text-subtle">{t.id}</td>
                  <td className="py-2 px-2 text-gray-300 font-medium">{t.person}</td>
                  <td className="py-2 px-2 text-gray-300">{t.task}</td>
                  <td className={`py-2 px-2 ${deadlineClass(t.deadline)}`}>{t.deadline || '—'}</td>
                  <td className="py-2 px-2 text-muted">{t.meeting_subject || '—'}</td>
                  <td className="py-2 px-2">
                    <form method="POST" action={`/dashboard/task/${t.id}/done`}>
                      <button type="submit" className="text-base hover:scale-125 transition-transform" title="Mark complete">✅</button>
                    </form>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={6} className="text-center text-subtle py-6">No pending tasks 🎉</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Meetings */}
      <div className="card">
        <h3 className="section-title">🕑 Recent Meetings</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted border-b border-[#21262d]">
                <th className="text-left py-2 px-2 font-medium">Subject</th>
                <th className="text-left py-2 px-2 font-medium">Start</th>
                <th className="text-left py-2 px-2 font-medium">Organizer</th>
                <th className="text-left py-2 px-2 font-medium">AI</th>
                <th className="text-left py-2 px-2 font-medium">Link</th>
              </tr>
            </thead>
            <tbody>
              {meetings?.length ? meetings.map(m => (
                <tr key={m.id} className="border-b border-[#0d1117] hover:bg-[#1c2128]">
                  <td className="py-2 px-2 text-gray-300">{m.subject}</td>
                  <td className="py-2 px-2 text-muted">{fmtTime(m.start_time)}</td>
                  <td className="py-2 px-2 text-muted">{m.organizer || '—'}</td>
                  <td className="py-2 px-2">
                    {m.summary
                      ? <span className="bg-green-900 text-green-400 px-2 py-0.5 rounded-full text-[10px]">✓ AI</span>
                      : <span className="bg-[#21262d] text-muted px-2 py-0.5 rounded-full text-[10px]">—</span>}
                  </td>
                  <td className="py-2 px-2">
                    {m.join_url ? <a href={m.join_url} target="_blank" rel="noreferrer" className="bg-green-900 text-green-400 px-2 py-0.5 rounded text-[10px] no-underline hover:bg-green-600">▶ Join</a> : '—'}
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={5} className="text-center text-subtle py-6">No meetings yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  )
}
