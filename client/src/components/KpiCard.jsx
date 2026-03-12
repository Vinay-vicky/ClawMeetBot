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
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'60px' }}>
      <div style={{ width:32, height:32, border:'3px solid #30363d', borderTop:'3px solid #58a6ff', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
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
