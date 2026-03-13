import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { backendUrl } from '../lib/utils.js'

export default function Login() {
  const [token,   setToken]   = useState('')
  const [error,   setError]   = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const { search } = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const params = new URLSearchParams(search)
    setError(params.get('error') || '')
    setMessage(params.get('msg') || '')

    const quickToken = params.get('token')
    if (quickToken) {
      setToken(quickToken)
    }
  }, [search])

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch(backendUrl('/dashboard/auth/login'), {
        method: 'POST',
        body: new URLSearchParams({ link_token: token }),
        credentials: 'include',
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        navigate('/me', { replace: true })
      } else {
        setError(data.error || 'Invalid token. Check /myprofile in Telegram.')
      }
    } catch {
      setError('Network error, please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="box">
        <div className="logo-icon">🔐</div>
        <div className="logo-title">ClawMeet Dashboard</div>
        <div className="logo-sub">Sign in with your personal link token to view your workspace.</div>

  {error && <div className="msg-err">❌ {error}</div>}
  {!error && message && <div className="msg-ok">✓ {message}</div>}

        <form onSubmit={handleSubmit}>
          <label className="field-label">Your Link Token</label>
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="Paste your link token here"
            required
            className="field-input"
            autoComplete="off"
          />
          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In →'}
          </button>
        </form>

        <div className="hint">
          <strong>How to get your token:</strong><br />
          1. Open Telegram<br />
          2. Send <code>/myprofile</code> to your ClawMeet bot<br />
          3. Copy the token shown in the reply<br />
          4. Paste it above and sign in
        </div>

        <Link to="/public" className="pub-link">
          👁 View public team overview (no login)
        </Link>
      </div>
    </div>
  )
}
