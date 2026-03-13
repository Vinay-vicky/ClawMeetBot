import { Link, useLocation } from 'react-router-dom'
import { backendUrl } from '../lib/utils.js'

const endpoints = {
  'Tasks': [
    { method:'GET',   path:'/api/tasks',                     desc:'All pending team tasks' },
    { method:'POST',  path:'/api/tasks',                     desc:'Create team task — body: { person, task, deadline }' },
    { method:'PATCH', path:'/api/tasks/:id/done',            desc:'Mark team task as done' },
    { method:'GET',   path:'/api/tasks/personal/:telegramId',desc:'Personal tasks for a user', tag:'private' },
  ],
  'Notes & Transcripts': [
    { method:'GET', path:'/api/notes/meeting/:meetingId',    desc:'Notes for a meeting' },
    { method:'GET', path:'/api/notes/personal/:telegramId',  desc:'Personal notes for a user', tag:'private' },
    { method:'GET', path:'/api/notes/transcript/:meetingId', desc:'Full transcript for a meeting' },
  ],
  'Auth & Users': [
    { method:'GET',  path:'/api/auth/user/:telegramId', desc:'Fetch user profile' },
    { method:'POST', path:'/api/auth/link-token',       desc:'Generate a dashboard login link token' },
  ],
}

const badgeCls = { GET:'badge-get', POST:'badge-post', PATCH:'badge-patch', DELETE:'badge-del' }

const integrations = ['Zapier', 'n8n', 'Make.com', 'Custom AI agents', 'Postman / curl']

export default function DeveloperAPI() {
  const { search } = useLocation()
  const now = new Date().toLocaleString('en-IN', { timeZone:'Asia/Kolkata', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true })

  return (
    <div>
      <div className="hdr">
        <div>
          <h1>Developer API</h1>
          <div className="sub">ClawMeet Bot REST Reference &bull; {now}</div>
        </div>
        <div className="hdr-right">
          <Link to={'/team' + search}      className="refresh">Team Dashboard</Link>
          <Link to={'/analytics' + search} className="refresh">Analytics</Link>
          <a href={backendUrl('/dashboard/logout')} className="refresh" style={{ color:'#8b949e' }}>Sign out</a>
        </div>
      </div>

      <div className="main-narrow">
        <div className="page-title">REST API Reference</div>
        <div className="page-sub">For developers, integrations, automation &amp; external services — not intended for regular users</div>

        <div className="info-box">
          <b>Authentication</b><br />
          All endpoints require either:<br />
          &bull; Query param: <code>?token=DASHBOARD_TOKEN</code><br />
          &bull; Header: <code>Authorization: Bearer DASHBOARD_TOKEN</code>
        </div>

        <div className="warn-box">
          Important: This page is intended for developers and admins only. Do not share links to this page with regular users.
        </div>

        {Object.entries(endpoints).map(([section, items]) => (
          <div className="card" style={{ marginBottom:24 }} key={section}>
            <h2>{section}</h2>
            <table>
              <thead>
                <tr><th style={{ width:80 }}>Method</th><th style={{ width:300 }}>Endpoint</th><th>Description</th></tr>
              </thead>
              <tbody>
                {items.map(ep => (
                  <tr key={ep.path}>
                    <td><span className={badgeCls[ep.method] || 'badge'}>{ep.method}</span></td>
                    <td><code>{ep.path}</code></td>
                    <td>
                      {ep.desc}
                      {ep.tag && <span className="tag">{ep.tag}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        <div className="card" style={{ marginBottom:24 }}>
          <h2>Integrations</h2>
          <p style={{ fontSize:12, color:'#8b949e', marginBottom:14 }}>These endpoints can be used with automation tools and custom integrations:</p>
          <div className="chips">
            {integrations.map(i => <span className="chip" key={i}>{i}</span>)}
          </div>
        </div>
      </div>

      <div className="ftr">
        ClawMeet Bot &bull;{' '}
        <Link to={'/team' + search} style={{ color:'var(--brand)', textDecoration:'none' }}>← Back to Dashboard</Link>
      </div>
    </div>
  )
}
