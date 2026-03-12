import { Link } from 'react-router-dom'
import Layout from '../components/Layout.jsx'

const endpoints = {
  Tasks: [
    { method: 'GET',   path: '/api/tasks',                    desc: 'All pending team tasks' },
    { method: 'POST',  path: '/api/tasks',                    desc: 'Create team task — body: { person, task, deadline }' },
    { method: 'PATCH', path: '/api/tasks/:id/done',           desc: 'Mark team task as done' },
    { method: 'GET',   path: '/api/tasks/personal/:telegramId', desc: 'Personal tasks for a user', tag: 'private' },
  ],
  'Notes & Transcripts': [
    { method: 'GET', path: '/api/notes/meeting/:meetingId',   desc: 'Notes for a meeting' },
    { method: 'GET', path: '/api/notes/personal/:telegramId', desc: 'Personal notes for a user', tag: 'private' },
    { method: 'GET', path: '/api/notes/transcript/:meetingId',desc: 'Full transcript for a meeting' },
  ],
  'Auth & Users': [
    { method: 'GET',  path: '/api/auth/user/:telegramId', desc: 'Fetch user profile' },
    { method: 'POST', path: '/api/auth/link-token',       desc: 'Generate a dashboard login link token' },
  ],
}

const badgeClass = { GET: 'badge-get', POST: 'badge-post', PATCH: 'badge-patch', DELETE: 'badge-del' }

const integrations = ['⚡ Zapier', '🧶 n8n', '🔄 Make.com', '🤖 Custom AI agents', '📋 Postman / curl']

export default function DeveloperAPI() {
  return (
    <Layout subtitle="REST API Reference — for developers and admins only">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
          <h2 className="text-xl font-bold text-gray-200">🔧 REST API Reference</h2>
        </div>

        {/* Auth info */}
        <div className="bg-[#0d1117] border border-accent/40 rounded-xl p-5 mb-5 text-sm text-muted leading-8">
          <p className="font-semibold text-accent mb-1">Authentication</p>
          All endpoints require one of:<br />
          <span className="text-gray-300">• Query param:</span> <code>?token=DASHBOARD_TOKEN</code><br />
          <span className="text-gray-300">• Header:</span> <code>Authorization: Bearer DASHBOARD_TOKEN</code>
        </div>

        {/* Warning */}
        <div className="bg-amber-900/20 border border-amber-400/30 rounded-xl p-4 mb-6 text-amber-400 text-sm">
          ⚠️ This page is intended for <b>developers and admins only</b>. Do not share links with regular users.
        </div>

        {/* Endpoint groups */}
        {Object.entries(endpoints).map(([section, items]) => (
          <div className="card mb-5" key={section}>
            <h3 className="section-title">{section}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted border-b border-[#21262d]">
                    <th className="text-left py-2 px-2 font-medium w-16">Method</th>
                    <th className="text-left py-2 px-2 font-medium">Endpoint</th>
                    <th className="text-left py-2 px-2 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(ep => (
                    <tr key={ep.path} className="border-b border-[#0d1117] hover:bg-[#1c2128]">
                      <td className="py-2 px-2">
                        <span className={badgeClass[ep.method]}>{ep.method}</span>
                      </td>
                      <td className="py-2 px-2 font-mono text-gray-300">{ep.path}</td>
                      <td className="py-2 px-2 text-muted">
                        {ep.desc}
                        {ep.tag && <span className="ml-2 bg-[#21262d] border border-border rounded px-1.5 py-0.5 text-[10px] text-subtle">{ep.tag}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {/* Integrations */}
        <div className="card">
          <h3 className="section-title">📡 Works With</h3>
          <p className="text-xs text-muted mb-4">These endpoints can be used with automation tools and custom integrations:</p>
          <div className="flex flex-wrap gap-2">
            {integrations.map(i => (
              <span key={i} className="bg-[#21262d] border border-border rounded-lg px-4 py-2 text-xs text-gray-300">{i}</span>
            ))}
          </div>
        </div>

        <p className="text-center text-subtle text-xs mt-6">
          <Link to="/team" className="text-accent hover:underline no-underline">← Back to Dashboard</Link>
        </p>
      </div>
    </Layout>
  )
}
