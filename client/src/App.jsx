import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Spinner } from './components/KpiCard.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import { routerBasename } from './lib/config.js'
import { applyTheme, getStoredTheme } from './lib/utils.js'

function lazyWithRetry(loader, key) {
  return lazy(() =>
    loader().catch((error) => {
      const retryKey = `cmbt-lazy-retry-${key}`
      const hasRetried = window.sessionStorage.getItem(retryKey) === '1'

      if (!hasRetried) {
        window.sessionStorage.setItem(retryKey, '1')
        window.location.reload()
        return new Promise(() => {})
      }

      throw error
    }).then((module) => {
      window.sessionStorage.removeItem(`cmbt-lazy-retry-${key}`)
      return module
    }),
  )
}

const Analytics = lazyWithRetry(() => import('./pages/Analytics.jsx'), 'analytics')
const PersonalDashboard = lazyWithRetry(() => import('./pages/PersonalDashboard.jsx'), 'personal-dashboard')
const PublicView = lazyWithRetry(() => import('./pages/PublicView.jsx'), 'public-view')
const DeveloperAPI = lazyWithRetry(() => import('./pages/DeveloperAPI.jsx'), 'developer-api')

function RouteFallback() {
  return (
    <div className="main">
      <Spinner />
    </div>
  )
}

function AppRoutes() {
  const location = useLocation()

  return (
    <div className="route-fade" key={location.pathname + location.search}>
      <Routes>
        <Route path="/"          element={<Navigate to="/team" replace />} />
        <Route path="/login"     element={<Login />} />
        <Route path="/team"      element={<Dashboard />} />
        <Route path="/analytics" element={<Suspense fallback={<RouteFallback />}><Analytics /></Suspense>} />
        <Route path="/me"        element={<Suspense fallback={<RouteFallback />}><PersonalDashboard /></Suspense>} />
        <Route path="/public"    element={<Suspense fallback={<RouteFallback />}><PublicView /></Suspense>} />
        <Route path="/developer" element={<Suspense fallback={<RouteFallback />}><DeveloperAPI /></Suspense>} />
      </Routes>
    </div>
  )
}

export default function App() {
  useEffect(() => {
    applyTheme(getStoredTheme())
    const onThemeChange = (event) => applyTheme(event?.detail || getStoredTheme())
    const onStorage = (event) => {
      if (event.key === 'cmbt-theme') applyTheme(getStoredTheme())
    }
    window.addEventListener('cmbt-theme-change', onThemeChange)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('cmbt-theme-change', onThemeChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  return (
    <BrowserRouter basename={routerBasename}>
      <AppRoutes />
    </BrowserRouter>
  )
}
