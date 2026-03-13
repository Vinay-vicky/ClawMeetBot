import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { backendUrl } from '../lib/utils.js'
import { getStoredTheme, setStoredTheme } from '../lib/utils.js'

export default function Layout({ title, subtitle, mainClass, navExtra, children }) {
  const { pathname, search } = useLocation()
  const [theme, setTheme] = useState(() => getStoredTheme())

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    setStoredTheme(next)
  }

  const navLinks = [
    { to: '/analytics', href: null, label: 'Analytics' },
    { to: '/public',    href: null, label: 'Team View' },
    { to: '/me',        href: null, label: 'My Dashboard' },
  ]

  return (
    <div>
      <div className="hdr">
        <div>
          <h1>Zunoverse • ClawMeet Dashboard</h1>
          {subtitle && <div className="sub">{subtitle}</div>}
        </div>
        <div className="hdr-right">
          {navLinks.map(({ to, label }) => (
            <Link key={to} to={to + search} className="refresh" style={pathname === to ? { borderColor:'#58a6ff' } : {}}>
              {label}
            </Link>
          ))}
          <button type="button" className="refresh" onClick={toggleTheme}>
            {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
          </button>
          {navExtra}
          <a href={backendUrl('/dashboard/logout')} className="refresh" style={{ color:'#8b949e' }}>Sign out</a>
        </div>
      </div>
      <div className={mainClass || 'main'}>
        {title && <div className="page-title">{title}</div>}
        {children}
      </div>
      <div className="ftr">
        Zunoverse x ClawMeet &bull; Human-first AI &bull; Node.js &bull;{' '}
        <a href="https://github.com/Vinay-vicky/ClawMeetBot" target="_blank" rel="noreferrer" style={{ color:'var(--brand)', textDecoration:'none' }}>GitHub</a>
        {' '}&bull;{' '}
        <Link to={'/developer' + search} style={{ color:'var(--text-subtle)', textDecoration:'none', fontSize:10 }}>Developer API</Link>
      </div>
    </div>
  )
}
