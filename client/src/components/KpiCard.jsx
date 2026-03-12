export function KpiCard({ label, value, colorClass = 'text-accent' }) {
  return (
    <div className="kpi">
      <div className={`text-3xl font-bold ${colorClass}`}>{value}</div>
      <div className="text-[10px] text-muted uppercase tracking-wide mt-1">{label}</div>
    </div>
  )
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center h-40 text-muted text-sm">
      <span className="animate-pulse">Loading…</span>
    </div>
  )
}

export function ErrorBox({ message }) {
  return (
    <div className="bg-red-900/30 border border-red-400/40 rounded-lg p-4 text-red-400 text-sm">
      ⚠️ {message}
    </div>
  )
}
