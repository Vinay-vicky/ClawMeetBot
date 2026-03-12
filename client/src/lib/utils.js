import { useState, useEffect, useCallback } from 'react'

export function useApi(url, deps = []) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [tick,    setTick]    = useState(0)

  const refresh = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(url, { credentials: 'same-origin' })
      .then(r => {
        if (r.status === 401) { window.location.href = '/dashboard/login'; return null }
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      })
      .then(d => { if (!cancelled && d) { setData(d); setError(null) } })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick, ...deps])

  return { data, loading, error, refresh }
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
