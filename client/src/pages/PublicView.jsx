import { Link, useLocation } from 'react-router-dom'
import { useApi, fmtTime } from '../lib/utils.js'
import { Spinner, ErrorBox } from '../components/KpiCard.jsx'

export default function PublicView() {
  const { data, loading, error } = useApi('/dashboard/api/public')
  const { search } = useLocation()

  if (loading) return <div className="main"><Spinner /></div>
  if (error)   return <div className="main"><ErrorBox message={error} /></div>

  const { meetStats, taskStats, analytics, meetings } = data
  const rate   = analytics?.completionRate ?? 0
  const maxWk  = Math.max(...(analytics?.weeks || []).map(w => w.count), 1)
  const now    = new Date().toLocaleString('en-IN', { timeZone:'Asia/Kolkata', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true })
  const done   = analytics?.doneTasks ?? 0
  const total  = done + (analytics?.pendingTasks ?? 0)

  return (
    <div>
      <div className="hdr">
        <div>
          <h1>🤖 ClawMeet — Team Overview</h1>
          <div className="sub">Public view &middot; {now}</div>
        </div>
        <div className="nav">
          <Link to={'/login' + search}>🔐 My Dashboard</Link>
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
            <h2>📊 Meetings per Week</h2>
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
            <h2>✅ Task Completion</h2>
            <div style={{ fontSize:28, fontWeight:700, color:'#3fb950' }}>{rate}%</div>
            <div style={{ fontSize:11, color:'#8b949e', marginTop:2 }}>{done} done / {total} total</div>
            <div className="pbg"><div className="pb" style={{ width: rate + '%' }} /></div>
          </div>
        </div>

        {/* Recent Meetings */}
        <div className="fc">
          <h2>🕒 Recent Meetings</h2>
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

        {/* Login CTA */}
        <div className="fc" style={{ textAlign:'center' }}>
          <p style={{ color:'#8b949e', fontSize:13, marginBottom:12 }}>Want to see your personal tasks and notes?</p>
          <Link to={'/login' + search} style={{ background:'#238636', color:'#fff', padding:'9px 22px', borderRadius:6, textDecoration:'none', fontSize:13, display:'inline-block' }}>
            🔐 Log in with Telegram Link Token
          </Link>
        </div>
      </div>

      <div className="ftr">ClawMeet Bot &middot; Real-time team meeting intelligence</div>
    </div>
  )
}
