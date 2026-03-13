export function KpiCard({ label, value, style }) {
  return (
    <div className="sc" style={style}>
      <div className="val">{value}</div>
      <div className="lbl">{label}</div>
    </div>
  )
}

export function Spinner() {
  return (
    <div className="zuno-loader-wrap" aria-label="Loading Zunoverse dashboard">
      <div className="zuno-loader" role="img" aria-hidden="true">
        <span className="zl-ring r1" />
        <span className="zl-ring r2" />
        <span className="zl-ring r3" />
        <span className="zl-ring r4" />
        <span className="zl-star">★</span>
      </div>
    </div>
  )
}

function SkCard({ className = '' }) {
  return (
    <div className={`sk-card ${className}`.trim()}>
      <div className="sk-line w40" />
      <div className="sk-line w70" />
      <div className="sk-line w55" />
    </div>
  )
}

export function DashboardSkeleton() {
  return (
    <div className="sk-page">
      <div className="sk-grid six">
        {Array.from({ length: 6 }).map((_, i) => <SkCard key={i} />)}
      </div>
      <SkCard className="h180" />
      <SkCard className="h220" />
      <SkCard className="h220" />
    </div>
  )
}

export function AnalyticsSkeleton() {
  return (
    <div className="sk-page">
      <div className="sk-grid six">
        {Array.from({ length: 6 }).map((_, i) => <SkCard key={i} />)}
      </div>
      <SkCard className="h300" />
      <div className="sk-grid two">
        <SkCard className="h240" />
        <SkCard className="h240" />
      </div>
    </div>
  )
}

export function PublicSkeleton() {
  return (
    <div className="sk-page">
      <div className="sk-grid five">
        {Array.from({ length: 5 }).map((_, i) => <SkCard key={i} />)}
      </div>
      <div className="sk-grid two">
        <SkCard className="h200" />
        <SkCard className="h200" />
      </div>
      <SkCard className="h220" />
    </div>
  )
}

export function PersonalSkeleton() {
  return (
    <div className="sk-page">
      <div className="sk-grid four">
        {Array.from({ length: 4 }).map((_, i) => <SkCard key={i} />)}
      </div>
      <div className="sk-grid two">
        <SkCard className="h280" />
        <SkCard className="h280" />
      </div>
    </div>
  )
}

export function DeveloperSkeleton() {
  return (
    <div className="sk-page">
      <SkCard className="h120" />
      <SkCard className="h240" />
      <SkCard className="h240" />
      <SkCard className="h180" />
    </div>
  )
}

export function ErrorBox({ message }) {
  return (
    <div style={{ background:'#2d1117', border:'1px solid #f85149', color:'#f85149', padding:'14px 16px', borderRadius:8, margin:'20px 0', fontSize:13 }}>
      Error: {message}
    </div>
  )
}
