import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { PersonalSkeleton, ErrorBox } from '../components/KpiCard.jsx'
import { useApi, backendUrl } from '../lib/utils.js'

export default function PersonalDashboard() {
  const { data, loading, error, refresh } = useApi('/dashboard/api/me')
  const [editingTask, setEditingTask] = useState(null)
  const [editingNote, setEditingNote] = useState(null)
  const { search } = useLocation()

  if (loading) return <div className="main"><PersonalSkeleton /></div>
  if (error)   return <div className="main"><ErrorBox message={error} /></div>

  const { user, tasks, notes } = data
  const name     = user?.name || 'Team Member'
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  const overdueCount = (tasks || []).filter(t => t.deadline && new Date(t.deadline) < new Date()).length
  const now = new Date().toLocaleString('en-IN', { timeZone:'Asia/Kolkata', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true })

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
          <div className="avatar">{initials}</div>
          <div>
            <div className="hdr-title">Welcome, {name}</div>
            <div className="hdr-sub">My Workspace &middot; {now}</div>
          </div>
        </div>
        <div className="nav">
          <Link to={'/public' + search}>👥 Team View</Link>
          <Link to={'/team' + search}>🏠 Team Dashboard</Link>
          <a href={backendUrl('/dashboard/logout')} className="danger">⏏ Logout</a>
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

        {/* Tasks + Notes */}
        <div className="g2">

          {/* TASKS CARD */}
          <div className="card">
            <div className="card-hdr">
              <h2>📋 My Tasks</h2>
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
                          <button type="button" className="btn btn-edit" onClick={() => setEditingTask(editingTask === t.id ? null : t.id)}>✎ Edit</button>
                          {' '}
                          <button type="button" className="btn btn-del" onClick={async () => { if (window.confirm('Delete this task?')) await post('/dashboard/me/task/' + t.id + '/delete', {}) }}>🗑</button>
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
                  }) : <tr><td colSpan={3} className="empty">No pending tasks 🎉<br/><small>Use the form above to add one</small></td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* NOTES CARD */}
          <div className="card">
            <div className="card-hdr">
              <h2>🗒 My Notes</h2>
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
                      <button type="button" className="btn btn-edit" onClick={() => setEditingNote(editingNote === n.id ? null : n.id)} title="Edit">✎</button>
                      <button type="button" className="btn btn-del" title="Delete" onClick={async () => { if (window.confirm('Delete this note?')) await post('/dashboard/me/note/' + n.id + '/delete', {}) }}>🗑</button>
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
