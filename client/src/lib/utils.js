import { useState, useEffect, useCallback } from 'react'

export function useApi(path, deps = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [ts, setTs] = useState(Date.now())

  const refresh = useCallback(() => setTs(Date.now()), [])

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(path, { credentials: 'same-origin' })
      .then(r => {
        if (r.status === 401) { window.location.href = '/dashboard/login'; return null; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => d && setData(d))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ts, ...deps])

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
    const today = new Date(); today.setHours(0,0,0,0)
    const dd = new Date(d); dd.setHours(0,0,0,0)
    if (dd < today)  return 'text-red-400 font-semibold'
    if (dd.getTime() === today.getTime()) return 'text-amber-400 font-semibold'
    return 'text-muted'
  } catch { return '' }
}

export function scoreColor(score) {
  if (score >= 70) return 'text-green-400'
  if (score >= 40) return 'text-amber-400'
  return 'text-red-400'
}
