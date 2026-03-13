import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useApi, fmtTime } from '../lib/utils.js'
import { PublicSkeleton, ErrorBox } from '../components/KpiCard.jsx'

export default function PublicView() {
  const { data, loading, error } = useApi('/dashboard/api/public')
  const { search } = useLocation()
  const [memberSort, setMemberSort] = useState('active')

  const safeData = data || {}
  const { meetStats, taskStats, analytics, meetings, members = [] } = safeData
  const rate   = analytics?.completionRate ?? 0
  const maxWk  = Math.max(...(analytics?.weeks || []).map(w => w.count), 1)
  const now    = new Date().toLocaleString('en-IN', { timeZone:'Asia/Kolkata', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true })
  const done   = analytics?.doneTasks ?? 0
  const total  = done + (analytics?.pendingTasks ?? 0)

  function getLoadStatus(activeTasks) {
    const active = Number(activeTasks || 0)
    if (active >= 6) return { label: 'Overloaded', className: 'member-status overloaded' }
    if (active >= 1) return { label: 'Balanced', className: 'member-status balanced' }
    return { label: 'Free', className: 'member-status free' }
  }

  const sortedMembers = [...members].sort((a, b) => {
    if (memberSort === 'name') {
      return String(a.name || '').localeCompare(String(b.name || ''))
    }
    if (memberSort === 'completed') {
      return Number(b.completedTasks || 0) - Number(a.completedTasks || 0)
    }
    return Number(b.activeTasks || 0) - Number(a.activeTasks || 0)
  })

  if (loading) return <div className="main"><PublicSkeleton /></div>
  if (error)   return <div className="main"><ErrorBox message={error} /></div>

  return (
    <div>
      <div className="hdr">
        <div>
          <h1>ClawMeet — Team Overview</h1>
          <div className="sub">Public view &middot; {now}</div>
        </div>
        <div className="nav">
          <Link to={'/login' + search}>My Dashboard</Link>
        </div>
      </div>

      <div className="main">
        {/* KPIs */}
        <div className="srow">
          <div className="sc"><div className="val">{meetStats?.total ?? 0}</div><div className="lbl">Total Meetings</div></div>
          <div className="sc"><div className="val">{meetStats?.thisWeek ?? 0}</div><div className="lbl">This Week</div></div>
          <div className="sc"><div className="val">{taskStats?.pending ?? 0}</div><div className="lbl">Pending Tasks</div></div>
          <div className="sc"><div className="val">{taskStats?.doneThisMonth ?? 0}</div><div className="lbl">Done (30d)</div></div>
          <div className="sc"><div className="val">{rate}%</div><div className="lbl">Completion Rate</div></div>
        </div>

        <div className="g2">
          {/* Meetings per week bar chart */}
          <div className="card">
            <h2>Meetings per Week</h2>
            <div className="bc">
              {(analytics?.weeks || []).map((w, i) => {
                const h = Math.max(4, Math.round((w.count / maxWk) * 80))
                return (
                  <div className="bw" key={i}>
                    <div className="bar" style={{ height: h }} />
                    <div className="bl">{w.week}</div>
                    <div className="bv">{w.count}</div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Task completion */}
          <div className="card">
            <h2>Task Completion</h2>
            <div className="task-completion-rate">{rate}%</div>
            <div className="task-completion-meta">{done} done / {total} total</div>
            <div className="pbg"><div className="pb" style={{ width: rate + '%' }} /></div>
          </div>
        </div>

        {/* Recent Meetings */}
        <div className="fc">
          <h2>Recent Meetings</h2>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Subject</th><th>Start</th><th>Organizer</th><th>AI Summary</th></tr></thead>
              <tbody>
                {meetings?.slice(0, 8).map(m => (
                  <tr key={m.id}>
                    <td>{m.subject}</td>
                    <td>{fmtTime(m.start_time)}</td>
                    <td>{m.organizer || '—'}</td>
                    <td>{m.summary ? <span className="badge g">✓ AI</span> : <span className="badge gr">—</span>}</td>
                  </tr>
                )) || <tr><td colSpan={4} className="empty">No meetings yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* Team members snapshot */}
        <div className="fc">
          <div className="team-member-topbar">
            <h2>Team Members &amp; Public Task Engagement</h2>
            <div className="team-member-sort" role="group" aria-label="Sort members">
              <button type="button" className={`team-sort-btn ${memberSort === 'active' ? 'active' : ''}`} onClick={() => setMemberSort('active')}>Sort: Active</button>
              <button type="button" className={`team-sort-btn ${memberSort === 'completed' ? 'active' : ''}`} onClick={() => setMemberSort('completed')}>Sort: Completed</button>
              <button type="button" className={`team-sort-btn ${memberSort === 'name' ? 'active' : ''}`} onClick={() => setMemberSort('name')}>Sort: Name</button>
            </div>
          </div>
          {!members.length ? (
            <div className="empty">No team member details available yet</div>
          ) : (
            <div className="team-member-grid">
              {sortedMembers.map((m, idx) => {
                const initials = String(m.name || 'TM').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
                const load = getLoadStatus(m.activeTasks)
                return (
                  <div className="team-member-card" key={`${m.name}-${idx}`}>
                    <div className="team-member-head">
                      <div className="team-member-avatar">{initials}</div>
                      <div>
                        <strong>{m.name || 'Team Member'}</strong>
                        <small>{m.email || 'Team member'}</small>
                        <span className={load.className}>{load.label}</span>
                      </div>
                    </div>
                    <div className="team-member-stats">
                      <span><b>{m.activeTasks ?? 0}</b> active tasks</span>
                      <span><b>{m.completedTasks ?? 0}</b> completed</span>
                      <span><b>{m.totalTasks ?? 0}</b> total engaged</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Login CTA */}
        <div className="fc public-login-cta">
          <p className="public-login-copy">Want to see your personal tasks and notes?</p>
          <Link to={'/login' + search} className="btn-link-brand btn-link-brand-sm">
            Log in with Telegram Link Token
          </Link>
        </div>
      </div>

      <div className="ftr">ClawMeet Bot &middot; Real-time team meeting intelligence</div>
    </div>
  )
}
