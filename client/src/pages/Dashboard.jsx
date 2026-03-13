import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Layout from '../components/Layout.jsx'
import { DashboardSkeleton, ErrorBox } from '../components/KpiCard.jsx'
import { useApi, fmtTime, deadlineClass, scoreColor, backendUrl } from '../lib/utils.js'

let analyticsPrefetchPromise = null
function prefetchAnalyticsRoute() {
  if (!analyticsPrefetchPromise) {
    analyticsPrefetchPromise = import('./Analytics.jsx')
  }
  return analyticsPrefetchPromise
}

export default function Dashboard() {
  const { data, loading, refreshing, error, refresh } = useApi('/dashboard/api/team')
  const [countdown, setCountdown] = useState(60)
  const [now, setNow] = useState(new Date())

  async function markDone(id) {
    const res = await fetch(backendUrl('/dashboard/task/' + id + '/done'), {
      method: 'POST',
      headers: { Accept:'application/json', 'X-Requested-With':'fetch' },
      credentials: 'include',
    })
    if (!res.ok) throw new Error('Failed to mark task done')
    refresh()
  }

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

  useEffect(() => {
    let cancelled = false
    let idleId = null
    let timeoutId = null

    const runPrefetch = () => {
      if (!cancelled) {
        prefetchAnalyticsRoute().catch(() => {})
      }
    }

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(() => runPrefetch(), { timeout: 1200 })
    } else {
      timeoutId = window.setTimeout(runPrefetch, 700)
    }

    return () => {
      cancelled = true
      if (idleId !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId)
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [])

  if (loading) return <Layout><DashboardSkeleton /></Layout>
  if (error)   return <Layout><ErrorBox message={error} /></Layout>

  const { meetStats, taskStats, analytics, todayMeetings, meetings, tasks, productivityScore } = data
  const rate  = analytics?.completionRate ?? 0
  const pColor = scoreColor(productivityScore)
  const nowStr = now.toLocaleString('en-IN', { timeZone:'Asia/Kolkata', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true })

  const subtitle = (
    <>
      <span className="live-dot" />{' '}Updated: <span id="ts">{nowStr}</span>
      {refreshing && <span className="sync-pill"> Syncing…</span>}
    </>
  )
  const navExtra = (
    <>
      <span className="countdown">Auto-refresh in <b style={{ color:'var(--text)' }}>{countdown}s</b></span>
      <button onClick={refresh} className="refresh">Refresh</button>
    </>
  )

  return (
    <Layout subtitle={subtitle} navExtra={navExtra}>

      {/* KPIs */}
      <div className="srow">
        <div className="sc"><div className="val">{meetStats?.total ?? 0}</div><div className="lbl">Total Meetings</div></div>
        <div className="sc"><div className="val">{meetStats?.thisWeek ?? 0}</div><div className="lbl">This Week</div></div>
        <div className="sc"><div className="val">{taskStats?.pending ?? 0}</div><div className="lbl">Pending Tasks</div></div>
        <div className="sc"><div className="val">{taskStats?.doneThisMonth ?? 0}</div><div className="lbl">Done (30d)</div></div>
        <div className="sc"><div className="val">{rate}%</div><div className="lbl">Task Completion</div></div>
        <div className="sc ps" style={{'--ps-color': pColor}}><div className="val">{productivityScore}</div><div className="lbl">Productivity Score</div></div>
      </div>

      {/* Upcoming meetings */}
      <div className="fc">
        <h2>Upcoming Meetings (next 24 hours)</h2>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Meeting</th><th>Start</th><th>Organizer</th><th>Link</th></tr></thead>
            <tbody>
              {todayMeetings?.length ? todayMeetings.map((m, i) => {
                const joinUrl = m.onlineMeeting?.joinUrl || m.join_url || m.webLink
                return (
                  <tr key={i}>
                    <td>{m.subject || 'Meeting'}</td>
                    <td>{fmtTime(m.start?.dateTime || m.start_time)}</td>
                    <td>{m.organizer?.emailAddress?.name || m.organizer || '—'}</td>
                    <td>{joinUrl ? <a href={joinUrl} target="_blank" rel="noreferrer" className="join">Join</a> : '—'}</td>
                  </tr>
                )
              }) : <tr><td colSpan={4} className="empty">No upcoming meetings in the next 24 hrs</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Analytics CTA — identical to original */}
      <div className="fc analytics-cta-card">
        <div className="analytics-cta-title">Team Analytics</div>
        <p className="analytics-cta-copy">
          Meetings per week &bull; Task completion &bull; Productivity score &bull; Top assignees &bull; Busiest days<br />
          All charts in one focused, distraction-free view
        </p>
        <Link
          to="/analytics"
          onMouseEnter={prefetchAnalyticsRoute}
          onTouchStart={prefetchAnalyticsRoute}
          onFocus={prefetchAnalyticsRoute}
          className="btn-link-brand"
        >
          View Analytics &rarr;
        </Link>
      </div>

      {/* Pending Tasks */}
      <div className="fc">
        <h2>Pending Tasks <span className="muted-inline-note">(top 30 — click Done to complete)</span></h2>
        <div className="table-scroll">
          <table>
            <thead><tr><th>#</th><th>Person</th><th>Task</th><th>Deadline</th><th>Meeting</th><th></th></tr></thead>
            <tbody>
              {tasks?.length ? tasks.slice(0, 30).map(t => {
                const dlCls = deadlineClass(t.deadline)
                return (
                  <tr key={t.id}>
                    <td>{t.id}</td>
                    <td>{t.person}</td>
                    <td>{t.task}</td>
                    <td>{t.deadline ? <span className={"dlbadge" + (dlCls ? " " + dlCls : "")}>{t.deadline}</span> : '—'}</td>
                    <td>{t.meeting_subject || '—'}</td>
                    <td>
                      <button className="donebtn" type="button" title="Mark complete" onClick={() => markDone(t.id)}>Done</button>
                    </td>
                  </tr>
                )
              }) : <tr><td colSpan={6} className="empty">No pending tasks</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Meetings */}
      <div className="fc">
        <h2>Recent Meetings</h2>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Subject</th><th>Start</th><th>Organizer</th><th>Summary</th><th>Link</th></tr></thead>
            <tbody>
              {meetings?.length ? meetings.map(m => (
                <tr key={m.id}>
                  <td>{m.subject}</td>
                  <td>{fmtTime(m.start_time)}</td>
                  <td>{m.organizer || '—'}</td>
                  <td>{m.summary ? <span className="badge g">✓ AI</span> : <span className="badge gr">—</span>}</td>
                  <td>{m.join_url ? <a href={m.join_url} target="_blank" rel="noreferrer" className="join">Join</a> : '—'}</td>
                </tr>
              )) : <tr><td colSpan={5} className="empty">No meetings yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

    </Layout>
  )
}
