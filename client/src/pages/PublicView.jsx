import { fmtTime } from '../lib/utils.js'
import { useApi } from '../lib/utils.js'
import { Spinner, ErrorBox, KpiCard } from '../components/KpiCard.jsx'

export default function PublicView() {
  const { data, loading, error } = useApi('/dashboard/api/public')

  if (loading) return (
    <div className="min-h-screen bg-base flex items-center justify-center"><Spinner /></div>
  )
  if (error) return (
    <div className="min-h-screen bg-base p-8"><ErrorBox message={error} /></div>
  )

  const { meetStats, taskStats, analytics, meetings } = data
  const rate = analytics?.completionRate ?? 0

  return (
    <div className="min-h-screen bg-base font-sans">
      {/* Header */}
      <header className="bg-surface border-b border-border px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-accent font-bold text-lg">🤖 ClawMeet — Team Overview</h1>
          <p className="text-muted text-[11px] mt-0.5">Public view</p>
        </div>
        <a href="/dashboard/login" className="bg-green-600 hover:bg-green-500 text-white text-xs font-semibold px-4 py-2 rounded-lg no-underline transition-colors">
          🔐 My Dashboard
        </a>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-6">
        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
          <KpiCard label="Total Meetings"   value={meetStats?.total ?? 0} />
          <KpiCard label="This Week"        value={meetStats?.thisWeek ?? 0} />
          <KpiCard label="Pending Tasks"    value={taskStats?.pending ?? 0} />
          <KpiCard label="Done (30d)"       value={taskStats?.doneThisMonth ?? 0} colorClass="text-green-400" />
          <KpiCard label="Completion Rate"  value={`${rate}%`} colorClass="text-green-400" />
        </div>

        {/* Recent Meetings */}
        <div className="card mb-6">
          <h3 className="section-title">🕑 Recent Meetings</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted border-b border-[#21262d]">
                  <th className="text-left py-2 px-2 font-medium">Subject</th>
                  <th className="text-left py-2 px-2 font-medium">Start</th>
                  <th className="text-left py-2 px-2 font-medium">Organizer</th>
                  <th className="text-left py-2 px-2 font-medium">AI</th>
                </tr>
              </thead>
              <tbody>
                {meetings?.slice(0, 8).map(m => (
                  <tr key={m.id} className="border-b border-[#0d1117] hover:bg-[#1c2128]">
                    <td className="py-2 px-2 text-gray-300">{m.subject}</td>
                    <td className="py-2 px-2 text-muted">{fmtTime(m.start_time)}</td>
                    <td className="py-2 px-2 text-muted">{m.organizer || '—'}</td>
                    <td className="py-2 px-2">
                      {m.summary
                        ? <span className="bg-green-900 text-green-400 px-2 py-0.5 rounded-full text-[10px]">✓ AI</span>
                        : <span className="bg-[#21262d] text-muted px-2 py-0.5 rounded-full text-[10px]">—</span>}
                    </td>
                  </tr>
                )) ?? (
                  <tr><td colSpan={4} className="text-center text-subtle py-6">No meetings yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Login CTA */}
        <div className="card text-center py-8 border-accent/30">
          <p className="text-muted text-sm mb-4">Want to see your personal tasks and notes?</p>
          <a href="/dashboard/login" className="inline-block bg-green-600 hover:bg-green-500 text-white font-semibold px-6 py-2.5 rounded-lg no-underline transition-colors text-sm">
            🔐 Log in with Telegram Link Token
          </a>
        </div>
      </main>

      <footer className="text-center py-4 text-subtle text-[11px] border-t border-border mt-4">
        ClawMeet Bot · Real-time team meeting intelligence
      </footer>
    </div>
  )
}
