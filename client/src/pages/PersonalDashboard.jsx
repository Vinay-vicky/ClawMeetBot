import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { PersonalSkeleton, ErrorBox } from '../components/KpiCard.jsx'
import { useApi, backendUrl, getStoredTheme, setStoredTheme } from '../lib/utils.js'

const defaultAvatar = {
  shape: 'circle',
  pattern: 'gradient',
  bg: '#f6d37a',
  accent: '#e6b84e',
  fg: '#1a1305',
  symbol: '',
}

const avatarPalette = ['#f6d37a', '#7dd3fc', '#a7f3d0', '#fca5a5', '#c4b5fd', '#f9a8d4']

const presetThemes = [
  {
    name: 'Executive',
    profileTheme: 'dark',
    avatarConfig: { shape: 'rounded', pattern: 'gradient', bg: '#d6b25e', accent: '#7b5b24', fg: '#18120a', symbol: '' },
  },
  {
    name: 'Ocean',
    profileTheme: 'light',
    avatarConfig: { shape: 'circle', pattern: 'gradient', bg: '#7dd3fc', accent: '#0f766e', fg: '#06263a', symbol: '' },
  },
  {
    name: 'Neon',
    profileTheme: 'dark',
    avatarConfig: { shape: 'square', pattern: 'ring', bg: '#111827', accent: '#22d3ee', fg: '#f5f3ff', symbol: '' },
  },
  {
    name: 'Minimal',
    profileTheme: 'light',
    avatarConfig: { shape: 'rounded', pattern: 'solid', bg: '#e2e8f0', accent: '#94a3b8', fg: '#0f172a', symbol: '' },
  },
]

function safeAvatar(rawAvatar) {
  if (!rawAvatar || typeof rawAvatar !== 'object') return { ...defaultAvatar }
  return {
    shape: ['circle', 'rounded', 'square'].includes(rawAvatar.shape) ? rawAvatar.shape : defaultAvatar.shape,
    pattern: ['solid', 'gradient', 'ring'].includes(rawAvatar.pattern) ? rawAvatar.pattern : defaultAvatar.pattern,
    bg: typeof rawAvatar.bg === 'string' ? rawAvatar.bg : defaultAvatar.bg,
    accent: typeof rawAvatar.accent === 'string' ? rawAvatar.accent : defaultAvatar.accent,
    fg: typeof rawAvatar.fg === 'string' ? rawAvatar.fg : defaultAvatar.fg,
    symbol: typeof rawAvatar.symbol === 'string' ? rawAvatar.symbol.slice(0, 2).toUpperCase() : '',
  }
}

function avatarStyle(config) {
  const radius = config.shape === 'square' ? '10px' : config.shape === 'rounded' ? '14px' : '999px'
  if (config.pattern === 'solid') {
    return { borderRadius: radius, background: config.bg, color: config.fg }
  }
  if (config.pattern === 'ring') {
    return {
      borderRadius: radius,
      background: config.bg,
      color: config.fg,
      boxShadow: `inset 0 0 0 3px ${config.accent}`,
    }
  }
  return {
    borderRadius: radius,
    background: `linear-gradient(145deg, ${config.accent}, ${config.bg})`,
    color: config.fg,
  }
}

function matchesPreset(theme, avatarConfig, preset) {
  return theme === preset.profileTheme && JSON.stringify(safeAvatar(avatarConfig)) === JSON.stringify(safeAvatar(preset.avatarConfig))
}

export default function PersonalDashboard() {
  const { data, loading, error, refresh } = useApi('/dashboard/api/me')
  const [editingTask, setEditingTask] = useState(null)
  const [editingNote, setEditingNote] = useState(null)
  const [theme, setTheme] = useState(getStoredTheme())
  const [avatarConfig, setAvatarConfig] = useState(defaultAvatar)
  const [saveStatus, setSaveStatus] = useState({ saving: false, error: '', ok: '' })
  const { search } = useLocation()

  const user = data?.user || null
  const tasks = data?.tasks || []
  const notes = data?.notes || []
  const name     = user?.name || 'Team Member'
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  const overdueCount = tasks.filter(t => t.deadline && new Date(t.deadline) < new Date()).length
  const now = new Date().toLocaleString('en-IN', { timeZone:'Asia/Kolkata', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true })

  useEffect(() => {
    const savedTheme = user?.profile_theme === 'light' ? 'light' : 'dark'
    setTheme(savedTheme)
    setStoredTheme(savedTheme)

    let parsed = null
    if (user?.avatar_config) {
      try { parsed = JSON.parse(user.avatar_config) } catch { parsed = null }
    }
    const nextAvatar = safeAvatar(parsed)
    setAvatarConfig(nextAvatar)
  }, [user?.profile_theme, user?.avatar_config])

  const avatarPreviewStyle = useMemo(() => avatarStyle(avatarConfig), [avatarConfig])
  const activePreset = useMemo(
    () => presetThemes.find(preset => matchesPreset(theme, avatarConfig, preset))?.name || '',
    [theme, avatarConfig],
  )

  if (loading) return <div className="main"><PersonalSkeleton /></div>
  if (error)   return <div className="main"><ErrorBox message={error} /></div>

  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    setStoredTheme(next)
    setSaveStatus({ saving: false, error: '', ok: '' })
  }

  function randomizeAvatar() {
    const a = avatarPalette[Math.floor(Math.random() * avatarPalette.length)]
    const b = avatarPalette[Math.floor(Math.random() * avatarPalette.length)]
    const c = avatarPalette[Math.floor(Math.random() * avatarPalette.length)]
    const shape = ['circle', 'rounded', 'square'][Math.floor(Math.random() * 3)]
    const pattern = ['solid', 'gradient', 'ring'][Math.floor(Math.random() * 3)]
    setAvatarConfig({
      shape,
      pattern,
      bg: a,
      accent: b,
      fg: c,
      symbol: initials,
    })
    setSaveStatus({ saving: false, error: '', ok: '' })
  }

  function resetAvatar() {
    setAvatarConfig({ ...defaultAvatar })
    setSaveStatus({ saving: false, error: '', ok: '' })
  }

  function applyPreset(preset) {
    setTheme(preset.profileTheme)
    setStoredTheme(preset.profileTheme)
    setAvatarConfig({ ...safeAvatar(preset.avatarConfig) })
    setSaveStatus({ saving: false, error: '', ok: `${preset.name} preset ready to save` })
  }

  async function saveProfileSettings() {
    setSaveStatus({ saving: true, error: '', ok: '' })
    try {
      const res = await fetch(backendUrl('/dashboard/api/me/profile'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Requested-With': 'fetch' },
        credentials: 'include',
        body: JSON.stringify({ profileTheme: theme, avatarConfig }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(payload.error || 'Unable to save profile settings')
      setSaveStatus({ saving: false, error: '', ok: 'Profile updated' })
      refresh()
    } catch (e) {
      setSaveStatus({ saving: false, error: e.message || 'Save failed', ok: '' })
    }
  }

  async function post(url, body) {
    const res = await fetch(backendUrl(url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'X-Requested-With': 'fetch',
      },
      body: new URLSearchParams(body),
      credentials: 'include',
    })
    if (!res.ok) throw new Error('Request failed')
    refresh()
  }

  return (
    <div>
      <div className="hdr">
        <div className="hdr-left">
          <div className="avatar" style={avatarPreviewStyle}>{avatarConfig.symbol || initials}</div>
          <div>
            <div className="hdr-title">Welcome, {name}</div>
            <div className="hdr-sub">My Workspace &middot; {now}</div>
          </div>
        </div>
        <div className="nav">
          <Link to={'/public' + search}>Team View</Link>
          <Link to={'/team' + search}>Team Dashboard</Link>
          <button type="button" className="refresh" onClick={toggleTheme}>{theme === 'light' ? 'Dark Mode' : 'Light Mode'}</button>
          <a href={backendUrl('/dashboard/logout')} className="danger">Logout</a>
        </div>
      </div>

      <div className="main">
        {/* KPI cards */}
        <div className="srow">
          <div className="sc"><div className="val">{tasks?.length ?? 0}</div><div className="lbl">Pending Tasks</div></div>
          <div className="sc"><div className="val">{notes?.length ?? 0}</div><div className="lbl">My Notes</div></div>
          <div className={"sc" + (overdueCount > 0 ? " ov" : "")}><div className="val">{overdueCount}</div><div className="lbl">Overdue</div></div>
          <div className="sc"><div className="val" style={{ fontSize:14 }}>{String(user?.telegram_id || '—')}</div><div className="lbl">Telegram ID</div></div>
        </div>

        <div className="card avatar-studio">
          <div className="card-hdr">
            <h2>Avatar Studio</h2>
            <span>{activePreset ? `${activePreset} preset selected` : 'Customize your profile look'}</span>
          </div>
          <div className="preset-gallery">
            {presetThemes.map((preset) => {
              const previewStyle = avatarStyle(preset.avatarConfig)
              const isActive = activePreset === preset.name
              return (
                <button
                  key={preset.name}
                  type="button"
                  className={`preset-card${isActive ? ' active' : ''}`}
                  onClick={() => applyPreset(preset)}
                >
                  <div className="preset-card-top">
                    <div className="avatar preset-avatar" style={previewStyle}>{preset.avatarConfig.symbol || initials}</div>
                    <div>
                      <strong>{preset.name}</strong>
                      <span>{preset.profileTheme === 'light' ? 'Light mode' : 'Dark mode'}</span>
                    </div>
                  </div>
                  <small>{preset.avatarConfig.pattern} &middot; {preset.avatarConfig.shape}</small>
                </button>
              )
            })}
          </div>
          <div className="avatar-studio-grid">
            <div className="avatar-preview-wrap">
              <div className="avatar avatar-preview" style={avatarPreviewStyle}>{avatarConfig.symbol || initials}</div>
              <small>Live preview</small>
            </div>
            <div className="avatar-controls">
              <label>Style
                <select value={avatarConfig.pattern} onChange={e => setAvatarConfig(v => ({ ...v, pattern: e.target.value }))}>
                  <option value="gradient">Gradient</option>
                  <option value="solid">Solid</option>
                  <option value="ring">Ring</option>
                </select>
              </label>
              <label>Shape
                <select value={avatarConfig.shape} onChange={e => setAvatarConfig(v => ({ ...v, shape: e.target.value }))}>
                  <option value="circle">Circle</option>
                  <option value="rounded">Rounded Square</option>
                  <option value="square">Square</option>
                </select>
              </label>
              <label>Initials / Symbol
                <input value={avatarConfig.symbol} maxLength={2} onChange={e => setAvatarConfig(v => ({ ...v, symbol: e.target.value.toUpperCase() }))} placeholder={initials} />
              </label>
              <label>Primary Color <input type="color" value={avatarConfig.bg} onChange={e => setAvatarConfig(v => ({ ...v, bg: e.target.value }))} /></label>
              <label>Accent Color <input type="color" value={avatarConfig.accent} onChange={e => setAvatarConfig(v => ({ ...v, accent: e.target.value }))} /></label>
              <label>Text Color <input type="color" value={avatarConfig.fg} onChange={e => setAvatarConfig(v => ({ ...v, fg: e.target.value }))} /></label>
            </div>
          </div>
          <div className="avatar-actions">
            <button type="button" className="btn btn-edit" onClick={randomizeAvatar}>Randomize</button>
            <button type="button" className="btn btn-cancel" onClick={resetAvatar}>Reset Avatar</button>
            <button type="button" className="btn btn-save" onClick={saveProfileSettings} disabled={saveStatus.saving}>
              {saveStatus.saving ? 'Saving...' : 'Save Profile Settings'}
            </button>
            {saveStatus.ok && <span className="profile-ok">{saveStatus.ok}</span>}
            {saveStatus.error && <span className="profile-err">{saveStatus.error}</span>}
          </div>
        </div>

        {/* Tasks + Notes */}
        <div className="g2">

          {/* TASKS CARD */}
          <div className="card">
            <div className="card-hdr">
              <h2>My Tasks</h2>
              <span>{tasks?.length ?? 0} pending</span>
            </div>
            <form onSubmit={async e => { e.preventDefault(); const f = new FormData(e.target); await post('/dashboard/me/task/add', { task: f.get('task'), deadline: f.get('deadline') || '' }); e.target.reset() }} className="add-form">
              <input name="task" className="inp" placeholder="New task..." required />
              <input name="deadline" type="date" className="inp inp-sm" title="Deadline (optional)" />
              <button type="submit" className="btn btn-add">+ Add</button>
            </form>
            <div style={{ overflowX:'auto' }}>
              <table>
                <thead><tr><th>Task</th><th>Deadline</th><th>Actions</th></tr></thead>
                <tbody>
                  {tasks?.length ? tasks.map(t => {
                    const isOverdue = t.deadline && new Date(t.deadline) < new Date()
                    return [
                      <tr key={"row-" + t.id}>
                        <td>{t.task}</td>
                        <td className={isOverdue ? "overdue" : ""}>{t.deadline || '—'}</td>
                        <td className="task-actions">
                          <button type="button" className="btn btn-done" onClick={() => post('/dashboard/me/task/' + t.id + '/done', {})}>✓ Done</button>
                          {' '}
                          <button type="button" className="btn btn-edit" onClick={() => setEditingTask(editingTask === t.id ? null : t.id)}>Edit</button>
                          {' '}
                          <button type="button" className="btn btn-del" onClick={async () => { if (window.confirm('Delete this task?')) await post('/dashboard/me/task/' + t.id + '/delete', {}) }}>Delete</button>
                        </td>
                      </tr>,
                      editingTask === t.id && (
                        <tr key={"edit-" + t.id} className="edit-row">
                          <td colSpan={3}>
                            <form onSubmit={async e => { e.preventDefault(); const f = new FormData(e.target); await post("/dashboard/me/task/" + t.id + "/edit", { task: f.get('task'), deadline: f.get('deadline') || '' }); setEditingTask(null) }} className="inline-form">
                              <input name="task" defaultValue={t.task} required className="inp" placeholder="Task text" />
                              <input name="deadline" defaultValue={t.deadline || ''} className="inp inp-sm" type="date" />
                              <button type="submit" className="btn btn-save">Save</button>
                              <button type="button" className="btn btn-cancel" onClick={() => setEditingTask(null)}>Cancel</button>
                            </form>
                          </td>
                        </tr>
                      )
                    ]
                  }) : <tr><td colSpan={3} className="empty">No pending tasks<br/><small>Use the form above to add one</small></td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* NOTES CARD */}
          <div className="card">
            <div className="card-hdr">
              <h2>My Notes</h2>
              <span>{notes?.length ?? 0} notes</span>
            </div>
            <div className="notes-scroll">
              {notes?.length ? notes.map(n => (
                <div className="note-item" key={n.id}>
                  <div className="note-body">
                    {editingNote === n.id ? (
                      <form onSubmit={async e => { e.preventDefault(); const f = new FormData(e.target); await post("/dashboard/me/note/" + n.id + "/edit", { note: f.get('note') }); setEditingNote(null) }} className="note-edit-form">
                        <textarea name="note" defaultValue={n.note} required className="note-ta" />
                        <div className="note-edit-btns">
                          <button type="submit" className="btn btn-save">Save</button>
                          <button type="button" className="btn btn-cancel" onClick={() => setEditingNote(null)}>Cancel</button>
                        </div>
                      </form>
                    ) : (
                      <div className="note-text">{n.note}</div>
                    )}
                  </div>
                  <div className="note-meta">
                    <span className="note-date">{n.created_at ? n.created_at.substring(0, 10) : ''}</span>
                    <div className="note-act">
                      <button type="button" className="btn btn-edit" onClick={() => setEditingNote(editingNote === n.id ? null : n.id)} title="Edit">Edit</button>
                      <button type="button" className="btn btn-del" title="Delete" onClick={async () => { if (window.confirm('Delete this note?')) await post('/dashboard/me/note/' + n.id + '/delete', {}) }}>Delete</button>
                    </div>
                  </div>
                </div>
              )) : <div className="empty">No notes yet.<br /><small>Use the form below to add one</small></div>}
            </div>
            <div className="note-add-form">
              <form onSubmit={async e => { e.preventDefault(); const f = new FormData(e.target); await post('/dashboard/me/note/add', { note: f.get('note') }); e.target.reset() }}>
                <textarea name="note" placeholder="Write a new note..." required></textarea>
                <button type="submit" className="btn btn-add">+ Add Note</button>
              </form>
            </div>
          </div>

        </div>
      </div>

      <div className="ftr">ClawMeet Bot &middot; My Personal Workspace &middot; Data is private to you</div>
    </div>
  )
}
