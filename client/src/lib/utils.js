import { useState, useEffect, useCallback } from 'react'
import { apiUrl, appUrl } from './config.js'

export function getDashboardSearch() {
  if (typeof window === 'undefined') return ''
  const params = new URLSearchParams(window.location.search)
  const token = params.get('token')
  return token ? `?token=${encodeURIComponent(token)}` : ''
}

export function withDashboardQuery(path) {
  const search = getDashboardSearch()
  if (!search) return path
  return path.includes('?') ? `${path}&${search.slice(1)}` : `${path}${search}`
}

export function backendUrl(path) {
  return withDashboardQuery(apiUrl(path))
}

export function frontendUrl(path) {
  return withDashboardQuery(appUrl(path))
}

export function useApi(url, deps = []) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error,   setError]   = useState(null)
  const [tick,    setTick]    = useState(0)

  const refresh = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    let cancelled = false
    const initialLoad = data == null
    if (initialLoad) setLoading(true)
    else setRefreshing(true)
    fetch(backendUrl(url), { credentials: 'include' })
      .then(r => {
        if (r.status === 401) {
          window.location.href = getDashboardSearch() ? backendUrl('/dashboard') : frontendUrl('/login')
          return null
        }
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      })
      .then(d => { if (!cancelled && d) { setData(d); setError(null) } })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
          setRefreshing(false)
        }
      })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick, ...deps])

  return { data, loading, refreshing, error, refresh }
}

export function fmtTime(t) {
  if (!t) return '—'
  try {
    return new Date(t).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
    })
  } catch { return String(t) }
}

export function deadlineClass(deadline) {
  if (!deadline) return ''
  try {
    const d = new Date(deadline)
    if (isNaN(d)) return ''
    const now   = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const dd    = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    if (dd < today)              return 'dl-overdue'
    if (dd.getTime() === today.getTime()) return 'dl-today'
    return ''
  } catch { return '' }
}

export function scoreColor(score) {
  if (score >= 70) return '#3fb950'
  if (score >= 40) return '#d29922'
  return '#f85149'
}

const THEME_KEY = 'cmbt-theme'

export function getStoredTheme() {
  if (typeof window === 'undefined') return 'dark'
  const saved = window.localStorage.getItem(THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function applyTheme(theme) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark')
}

export function setStoredTheme(theme) {
  if (typeof window === 'undefined') return
  const next = theme === 'light' ? 'light' : 'dark'
  window.localStorage.setItem(THEME_KEY, next)
  applyTheme(next)
  window.dispatchEvent(new CustomEvent('cmbt-theme-change', { detail: next }))
}
