import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Analytics from './pages/Analytics.jsx'
import PersonalDashboard from './pages/PersonalDashboard.jsx'
import PublicView from './pages/PublicView.jsx'
import DeveloperAPI from './pages/DeveloperAPI.jsx'
import { routerBasename } from './lib/config.js'

function AppRoutes() {
  const location = useLocation()

  return (
    <div className="route-fade" key={location.pathname + location.search}>
      <Routes>
        <Route path="/"          element={<Navigate to="/team" replace />} />
        <Route path="/login"     element={<Login />} />
        <Route path="/team"      element={<Dashboard />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/me"        element={<PersonalDashboard />} />
        <Route path="/public"    element={<PublicView />} />
        <Route path="/developer" element={<DeveloperAPI />} />
      </Routes>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter basename={routerBasename}>
      <AppRoutes />
    </BrowserRouter>
  )
}
