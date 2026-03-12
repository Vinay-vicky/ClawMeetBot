import { useState } from 'react'
import Layout from '../components/Layout.jsx'
import { Spinner, ErrorBox } from '../components/KpiCard.jsx'
import { useApi, fmtTime } from '../lib/utils.js'

export default function PersonalDashboard() {
  const { data, loading, error, refresh } = useApi('/dashboard/api/me')
  const [editingTask, setEditingTask] = useState(null)
  const [editingNote, setEditingNote] = useState(null)

  if (loading) return <Layout subtitle="Loading…"><Spinner /></Layout>
  if (error)   return <Layout subtitle="Error"><ErrorBox message={error} /></Layout>

  const { user, tasks, notes } = data

  async function post(url, body) {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
      credentials: 'same-origin',
    })
    refresh()
  }

  return (
    <Layout subtitle={`Logged in as ${user?.name || 'you'}`}>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-200">👤 My Personal Workspace</h2>
        <span className="text-xs text-muted bg-purple-700/20 border border-purple-700/40 px-3 py-1 rounded-full">
          🔒 Private — only visible to you
        </span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Tasks */}
        <div className="card">
          <h3 className="section-title">✅ My Tasks</h3>

          {/* Add task form */}
          <form onSubmit={async e => { e.preventDefault(); const f = new FormData(e.target); await post('/dashboard/me/task/add', { task: f.get('task'), deadline: f.get('deadline') }); e.target.reset() }} className="flex gap-2 mb-4 flex-wrap">
            <input name="task" required placeholder="New task…" className="flex-1 min-w-0 bg-base border border-border rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent" />
            <input name="deadline" type="date" className="bg-base border border-border rounded-lg px-3 py-1.5 text-sm text-muted focus:outline-none focus:border-accent" />
            <button type="submit" className="bg-green-600 hover:bg-green-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg">+ Add</button>
          </form>

          {tasks?.length ? (
            <div className="space-y-2">
              {tasks.map(t => (
                <div key={t.id} className="bg-base border border-border rounded-lg p-3">
                  {editingTask === t.id ? (
                    <form onSubmit={async e => { e.preventDefault(); const f = new FormData(e.target); await post(`/dashboard/me/task/${t.id}/edit`, { task: f.get('task'), deadline: f.get('deadline') }); setEditingTask(null) }} className="space-y-2">
                      <input name="task" defaultValue={t.task} required className="w-full bg-surface border border-border rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent" />
                      <div className="flex gap-2 flex-wrap">
                        <input name="deadline" type="date" defaultValue={t.deadline || ''} className="bg-surface border border-border rounded px-2 py-1.5 text-xs text-muted focus:outline-none focus:border-accent" />
                        <button type="submit" className="bg-accent text-base text-xs font-semibold px-3 py-1.5 rounded">Save</button>
                        <button type="button" onClick={() => setEditingTask(null)} className="bg-[#21262d] text-muted text-xs px-3 py-1.5 rounded">Cancel</button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm text-gray-300">{t.task}</p>
                        {t.deadline && <p className="text-[11px] text-muted mt-0.5">📅 {t.deadline}</p>}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => setEditingTask(t.id)} className="text-muted hover:text-accent text-xs px-2 py-1 rounded bg-[#21262d]" title="Edit">✎</button>
                        <form onSubmit={async e => { e.preventDefault(); if(confirm('Mark done?')) await post(`/dashboard/me/task/${t.id}/done`, {}) }}>
                          <button type="submit" className="text-xs px-2 py-1 rounded bg-green-900/40 text-green-400 hover:bg-green-900" title="Done">✓</button>
                        </form>
                        <form onSubmit={async e => { e.preventDefault(); if(confirm('Delete?')) await post(`/dashboard/me/task/${t.id}/delete`, {}) }}>
                          <button type="submit" className="text-xs px-2 py-1 rounded bg-red-900/30 text-red-400 hover:bg-red-900/60" title="Delete">🗑</button>
                        </form>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-subtle text-sm text-center py-6">No tasks yet. Add one above ↑</p>
          )}
        </div>

        {/* Notes */}
        <div className="card">
          <h3 className="section-title">📝 My Notes</h3>

          {/* Add note form */}
          <form onSubmit={async e => { e.preventDefault(); const f = new FormData(e.target); await post('/dashboard/me/note/add', { note: f.get('note') }); e.target.reset() }} className="flex gap-2 mb-4">
            <textarea name="note" required placeholder="New note…" rows={2} className="flex-1 bg-base border border-border rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent resize-none" />
            <button type="submit" className="bg-green-600 hover:bg-green-500 text-white text-xs font-semibold px-3 py-2 rounded-lg self-end">+ Add</button>
          </form>

          {notes?.length ? (
            <div className="space-y-2">
              {notes.map(n => (
                <div key={n.id} className="bg-base border border-border rounded-lg p-3">
                  {editingNote === n.id ? (
                    <form onSubmit={async e => { e.preventDefault(); const f = new FormData(e.target); await post(`/dashboard/me/note/${n.id}/edit`, { note: f.get('note') }); setEditingNote(null) }} className="space-y-2">
                      <textarea name="note" defaultValue={n.note} required rows={3} className="w-full bg-surface border border-border rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent resize-none" />
                      <div className="flex gap-2">
                        <button type="submit" className="bg-accent text-base text-xs font-semibold px-3 py-1.5 rounded">Save</button>
                        <button type="button" onClick={() => setEditingNote(null)} className="bg-[#21262d] text-muted text-xs px-3 py-1.5 rounded">Cancel</button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm text-gray-300 whitespace-pre-wrap">{n.note}</p>
                        {n.created_at && <p className="text-[11px] text-subtle mt-1">{fmtTime(n.created_at)}</p>}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => setEditingNote(n.id)} className="text-muted hover:text-accent text-xs px-2 py-1 rounded bg-[#21262d]" title="Edit">✎</button>
                        <form onSubmit={async e => { e.preventDefault(); if(confirm('Delete?')) await post(`/dashboard/me/note/${n.id}/delete`, {}) }}>
                          <button type="submit" className="text-xs px-2 py-1 rounded bg-red-900/30 text-red-400 hover:bg-red-900/60" title="Delete">🗑</button>
                        </form>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-subtle text-sm text-center py-6">No notes yet. Add one above ↑</p>
          )}
        </div>
      </div>
    </Layout>
  )
}
