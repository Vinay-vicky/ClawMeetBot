import { Link, useLocation } from 'react-router-dom'

export default function Layout({ title, subtitle, mainClass, navExtra, children }) {
  const { pathname } = useLocation()

  const navLinks = [
    { to: '/analytics', href: null, label: '📊 Analytics' },
    { to: '/public',    href: null, label: '👥 Team View' },
    { to: '/me',        href: null, label: '👤 My Dashboard' },
  ]

  return (
    <div>
      <div className="hdr">
        <div>
          <h1>🤖 ClawMeet Bot Dashboard</h1>
          {subtitle && <div className="sub">{subtitle}</div>}
        </div>
        <div className="hdr-right">
          {navLinks.map(({ to, label }) => (
            <Link key={to} to={to} className="refresh" style={pathname === to ? { borderColor:'#58a6ff' } : {}}>
              {label}
            </Link>
          ))}
          {navExtra}
          <a href="/dashboard/logout" className="refresh" style={{ color:'#8b949e' }}>Sign out</a>
        </div>
      </div>
      <div className={mainClass || 'main'}>
        {title && <div className="page-title">{title}</div>}
        {children}
      </div>
      <div className="ftr">
        ClawMeet Bot &bull; Microsoft Teams + Gemini AI &bull; Node.js &bull;{' '}
        <a href="https://github.com/Vinay-vicky/ClawMeetBot" target="_blank" rel="noreferrer" style={{ color:'#58a6ff', textDecoration:'none' }}>GitHub</a>
        {' '}&bull;{' '}
        <Link to="/developer" style={{ color:'#484f58', textDecoration:'none', fontSize:10 }}>🔧 Developer API</Link>
      </div>
    </div>
  )
}
