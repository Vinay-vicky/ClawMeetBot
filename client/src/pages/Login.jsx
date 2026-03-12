import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

export default function Login() {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const form = new FormData()
    form.append('link_token', token)
    try {
      const res = await fetch('/dashboard/auth/login', {
        method: 'POST',
        body: new URLSearchParams({ link_token: token }),
        credentials: 'same-origin',
        redirect: 'manual',
      })
      if (res.ok) {
        navigate('/me', { replace: true })
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Invalid token. Check /myprofile in Telegram.')
      }
    } catch {
      setError('Network error, please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-base flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🤖</div>
          <h1 className="text-2xl font-bold text-accent">ClawMeet Bot</h1>
          <p className="text-muted text-sm mt-1">Sign in with your Telegram link token</p>
        </div>

        <div className="card">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-muted mb-1.5 uppercase tracking-wide">
                Link Token
              </label>
              <input
                type="password"
                value={token}
                onChange={e => setToken(e.target.value)}
                placeholder="Paste token from /myprofile"
                required
                className="w-full bg-base border border-border rounded-lg px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-accent transition-colors"
              />
            </div>

            {error && (
              <div className="bg-red-900/30 border border-red-400/30 rounded-lg px-3 py-2 text-red-400 text-xs">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
            >
              {loading ? 'Signing in…' : '🔐 Sign In'}
            </button>
          </form>

          <p className="text-center text-muted text-xs mt-4">
            Get your token via <code>/myprofile</code> in Telegram
          </p>
        </div>

        <p className="text-center mt-4">
          <a href="/dashboard/public" className="text-muted text-xs hover:text-accent">
            👥 View public team dashboard →
          </a>
        </p>
      </div>
    </div>
  )
}
