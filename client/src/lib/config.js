const standalone = import.meta.env.VITE_STANDALONE === 'true'
const rawApiBase = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')

export const routerBasename = standalone ? undefined : '/dashboard/ui'

export function appUrl(path = '/') {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return standalone ? normalized : `/dashboard/ui${normalized === '/' ? '' : normalized}`
}

export function apiUrl(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return rawApiBase ? `${rawApiBase}${normalized}` : normalized
}
