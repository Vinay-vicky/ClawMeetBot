import { Link, useLocation } from 'react-router-dom'

const navItems = [
  { to: '/team',      label: '🏠 Dashboard' },
  { to: '/analytics', label: '📊 Analytics' },
  { to: '/me',        label: '👤 My Space' },
  { to: '/public',    label: '👥 Team View' },
]

export default function Layout({ title, subtitle, children }) {
  const { pathname } = useLocation()

  return (
    <div className="min-h-screen bg-base font-sans">
      {/* Header */}
      <header className="bg-surface border-b border-border px-6 py-3 flex items-center justify-between gap-3 flex-wrap sticky top-0 z-10">
        <div>
          <h1 className="text-accent font-bold text-lg leading-none">🤖 ClawMeet Bot</h1>
          {subtitle && <p className="text-muted text-[11px] mt-0.5">{subtitle}</p>}
        </div>
        <nav className="flex items-center gap-2 flex-wrap">
          {navItems.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={`btn ${pathname === to ? 'border-accent text-accent bg-[#21262d]' : ''}`}
            >
              {label}
            </Link>
          ))}
          <a href="/dashboard/logout" className="btn text-muted hover:text-red-400">Sign out</a>
        </nav>
      </header>

      {/* Page title */}
      {title && (
        <div className="max-w-7xl mx-auto px-6 pt-6 pb-1">
          <h2 className="text-2xl font-bold text-gray-200">{title}</h2>
        </div>
      )}

      {/* Content */}
      <main className="max-w-7xl mx-auto px-6 py-5">{children}</main>

      {/* Footer */}
      <footer className="border-t border-border text-center text-[11px] text-subtle py-4 mt-4">
        ClawMeet Bot · Microsoft Teams + AI · Node.js ·{' '}
        <a href="https://github.com/Vinay-vicky/ClawMeetBot" target="_blank" rel="noreferrer" className="text-accent hover:underline">GitHub</a>
        {' '}·{' '}
        <Link to="/developer" className="text-subtle hover:text-muted">🔧 Developer API</Link>
      </footer>
    </div>
  )
}
