import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Spinner } from './components/KpiCard.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import { routerBasename } from './lib/config.js'
import { applyTheme, getStoredTheme } from './lib/utils.js'

const Analytics = lazy(() => import('./pages/Analytics.jsx'))
const PersonalDashboard = lazy(() => import('./pages/PersonalDashboard.jsx'))
const PublicView = lazy(() => import('./pages/PublicView.jsx'))
const DeveloperAPI = lazy(() => import('./pages/DeveloperAPI.jsx'))

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
