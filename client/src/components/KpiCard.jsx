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

export function ErrorBox({ message }) {
  return (
    <div style={{ background:'#2d1117', border:'1px solid #f85149', color:'#f85149', padding:'14px 16px', borderRadius:8, margin:'20px 0', fontSize:13 }}>
      Error: {message}
    </div>
  )
}
