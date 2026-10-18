import { html, raw } from 'hono/html'
import type { SessionUser } from './types'

const discordLogo = raw(`
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-discord" viewBox="0 0 16 16">
    <path d="M13.545 2.907a13.2 13.2 0 0 0-3.257-1.011.05.05 0 0 0-.052.025c-.141.25-.297.577-.406.833a12.2 12.2 0 0 0-3.658 0 8 8 0 0 0-.412-.833.05.05 0 0 0-.052-.025c-1.125.194-2.22.534-3.257 1.011a.04.04 0 0 0-.021.018C.356 6.024-.213 9.047.066 12.032q.003.022.021.037a13.3 13.3 0 0 0 3.995 2.02.05.05 0 0 0 .056-.019q.463-.63.818-1.329a.05.05 0 0 0-.01-.059l-.018-.011a9 9 0 0 1-1.248-.595.05.05 0 0 1-.02-.066l.015-.019q.127-.095.248-.195a.05.05 0 0 1 .051-.007c2.619 1.196 5.454 1.196 8.041 0a.05.05 0 0 1 .053.007q.121.1.248.195a.05.05 0 0 1-.004.085 8 8 0 0 1-1.249.594.05.05 0 0 0-.03.03.05.05 0 0 0 .003.041c.24.465.515.909.817 1.329a.05.05 0 0 0 .056.019 13.2 13.2 0 0 0 4.001-2.02.05.05 0 0 0 .021-.037c.334-3.451-.559-6.449-2.366-9.106a.03.03 0 0 0-.02-.019m-8.198 7.307c-.789 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.45.73 1.438 1.613 0 .888-.637 1.612-1.438 1.612m5.316 0c-.788 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.451.73 1.438 1.613 0 .888-.631 1.612-1.438 1.612"/>
  </svg>
`)

export const CSS = `
  :root{
    color-scheme:light dark;
    --bg:#f4f1ec;--bg-overlay:rgba(244,241,236,.12);
    --surface:rgba(255,253,250,.84);--surface-2:rgba(238,232,224,.75);--border:rgba(110,95,80,.28);
    --text:#26211c;--muted:#6b625a;--accent:#6d28d9;--accent-hover:#5b21b6;--accent-text:#fff;
    --link:#5b21b6;--danger:#c93232;--danger-hover:#a82626;--ok:#1b8a4e;--shadow:0 1px 3px rgba(40,30,20,.1),0 8px 28px rgba(40,30,20,.12)
  }
  @media (prefers-color-scheme:dark){
    :root{
      --bg:#1b1816;--bg-overlay:rgba(24,21,19,.8);
      --surface:rgba(38,34,31,.76);--surface-2:rgba(58,52,47,.7);--border:rgba(255,238,215,.14);
      --text:#f1ece5;--muted:#b3a99e;--accent:#a78bfa;--accent-hover:#c4b5fd;--accent-text:#1d0f3a;
      --link:#c4b5fd;--danger:#ef6a5f;--danger-hover:#ff8a80;--ok:#5ad68f;--shadow:0 1px 3px rgba(0,0,0,.4),0 8px 28px rgba(0,0,0,.35)
    }
  }
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;background:linear-gradient(var(--bg-overlay),var(--bg-overlay)),url(/flag-bg.png) center/cover fixed,var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
  a{color:var(--link);text-underline-offset:2px} a:hover{text-decoration-thickness:2px}
  h1{font-size:1.9rem;line-height:1.2;margin:0 0 .5rem;letter-spacing:-.02em}
  h2{font-size:1.25rem;margin:2rem 0 .75rem;letter-spacing:-.01em}
  h3{font-size:1.05rem;margin:0}
  p{margin:.5rem 0 1rem}
  code{font:.88em ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--surface-2);border:1px solid var(--border);border-radius:5px;padding:.1em .4em}
  .topbar{position:relative;z-index:10;background:var(--surface);border-bottom:1px solid var(--border);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
  .topbar-inner{max-width:860px;margin:0 auto;padding:.7rem 1rem;display:flex;align-items:center;gap:1.25rem;flex-wrap:wrap}
  .brand{display:inline-flex;align-items:center;gap:.6rem;font-weight:800;letter-spacing:-.02em;color:var(--text);text-decoration:none;font-size:1.1rem}
  .brand-logo{display:block;width:32px;height:32px}
  .brand span{color:var(--accent)}
  .nav-links{display:flex;gap:.25rem;flex:1;flex-wrap:wrap}
  .nav-links a{color:var(--muted);text-decoration:none;padding:.35rem .7rem;border-radius:8px;font-weight:500}
  .nav-links a:hover{background:var(--surface-2);color:var(--text)}
  .nav-user{display:flex;align-items:center;gap:.75rem;color:var(--muted);font-size:.92rem}
  .user-menu{position:relative}
  .user-menu summary{list-style:none;cursor:pointer;display:block;border-radius:50%}
  .user-menu summary::-webkit-details-marker{display:none}
  .user-menu summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .avatar{display:block;width:36px;height:36px;border-radius:50%;object-fit:cover;background:var(--surface-2);border:1px solid var(--border)}
  .user-menu summary:hover .avatar,.user-menu[open] .avatar{border-color:var(--accent)}
  .avatar-fallback{display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--text)}
  .user-menu-panel{position:absolute;right:0;top:calc(100% + .5rem);min-width:12rem;padding:.9rem;background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
  .user-menu-panel .signed-in{font-size:.8rem;color:var(--muted)}
  .user-menu-panel b{display:block;color:var(--text);font-size:1rem;margin-bottom:.75rem;overflow-wrap:anywhere}
  .user-menu-panel form{margin:0}
  .user-menu-panel button{width:100%}
  main{max-width:860px;margin:0 auto;padding:2rem 1rem 4rem}
  main>.hero{margin-top:1rem}
  .lead{color:var(--muted);font-size:1.05rem}
  .panel,.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:1.5rem;box-shadow:var(--shadow);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
  .panel+.panel{margin-top:1.25rem}
  .panel>:first-child{margin-top:0}
  .panel>:last-child{margin-bottom:0}
  .panel .card{background:var(--surface-2);box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none}
  .card{padding:1.25rem;margin:1rem 0}
  .card-head{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:.25rem}
  .meta{color:var(--muted);font-size:.9rem;margin:.75rem 0 0}
  label{display:block;margin:1rem 0 0;font-weight:600;font-size:.92rem}
  label>input,label>textarea{margin-top:.35rem}
  input,textarea{display:block;width:100%;padding:.6rem .75rem;background:var(--surface-2);color:var(--text);border:1px solid var(--border);border-radius:9px;font:inherit;font-weight:400}
  textarea{resize:vertical;min-height:5.5rem}
  input:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:transparent}
  input[type=file]{padding:.45rem;cursor:pointer}
  input[type=file]::file-selector-button{margin-right:.75rem;padding:.4rem .8rem;border:0;border-radius:7px;background:var(--surface);color:var(--text);border:1px solid var(--border);font:inherit;font-size:.9rem;cursor:pointer}
  input[type=file]::file-selector-button:hover{border-color:var(--accent)}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:0 1rem}
  .grid .full{grid-column:1/-1}
  @media (max-width:600px){.grid{grid-template-columns:1fr}}
  button{font:inherit;font-weight:600;padding:.55rem 1.1rem;border-radius:9px;border:1px solid transparent;background:var(--accent);color:var(--accent-text);cursor:pointer;transition:background .12s,border-color .12s}
  button:hover{background:var(--accent-hover)}
  button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  button.ghost{background:transparent;color:var(--text);border-color:var(--border);padding:.35rem .8rem;font-weight:500;font-size:.9rem}
  button.ghost:hover{background:var(--surface-2)}
  button.danger{background:transparent;color:var(--danger);border-color:var(--danger)}
  button.danger:hover{background:var(--danger);color:#fff}
  .actions{display:flex;gap:.6rem;margin-top:1.25rem;flex-wrap:wrap}
  .table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:10px}
  table{border-collapse:collapse;width:100%}
  th{font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600}
  td,th{padding:.8rem 1rem;text-align:left;border-bottom:1px solid var(--border)}
  tbody tr:last-child td{border-bottom:0}
  tbody tr:hover{background:var(--surface-2)}
  td:last-child{text-align:right}
  .badge{display:inline-block;padding:.15rem .6rem;border-radius:999px;font-size:.8rem;font-weight:600;background:var(--surface-2);color:var(--muted);border:1px solid var(--border)}
  .badge.ok{color:var(--ok);border-color:currentColor;background:transparent}
  .empty{color:var(--muted);text-align:center;padding:1.5rem}
  .msg{margin-top:1rem;font-weight:600;min-height:1.5em}
  .hero{padding:2.5rem;display:flex;align-items:center;gap:2rem;flex-wrap:wrap}
  .hero-logo{display:block;width:160px;height:160px;flex:none}
  .hero h1{font-size:2.4rem}
  .hero .actions{margin-top:1.5rem}
  .btn-link{display:inline-block;padding:.55rem 1.1rem;border-radius:9px;background:var(--accent);color:var(--accent-text);font-weight:600;text-decoration:none}
  .with-icon{display:inline-flex;align-items:center;gap:.45rem}
  .btn-link:hover{background:var(--accent-hover)}
  .btn-link.ghost{background:transparent;color:var(--text);border:1px solid var(--border)}
  .btn-link.ghost:hover{background:var(--surface-2)}
`

const layout = (title: string, nav: unknown, body: unknown) => html`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link rel="icon" type="image/webp" href="/favicon.webp">
<style>${raw(CSS)}</style></head><body>${nav}<main>${body}</main></body></html>`

const guestNav = html`<header class="topbar"><div class="topbar-inner">
  <a class="brand" href="/"><img class="brand-logo" src="/logo.png" alt="" width="32" height="32">Custom Team Racing API</a>
  <nav class="nav-links"><a href="/docs">Docs</a><a href="/submit">Submit</a></nav>
  <div class="nav-user"><a class="with-icon" href="/auth/login">${discordLogo} Log In</a></div>
</div></header>`

const nav = (u: SessionUser) => html`<header class="topbar"><div class="topbar-inner">
  <a class="brand" href="/"><img class="brand-logo" src="/logo.png" alt="" width="32" height="32">Custom Team Racing API</a>
  <nav class="nav-links">
    <a href="/docs">Docs</a>
    <a href="/submit">Submit</a>
    ${u.approved || u.isAdmin ? html`<a href="/upload">Upload</a>` : ''}
    ${u.isAdmin ? html`<a href="/admin">Admin</a>` : ''}
  </nav>
  <div class="nav-user">
    <details class="user-menu">
      <summary aria-label="Account menu for ${u.username}">${u.avatarUrl
        ? html`<img class="avatar" src="${u.avatarUrl}" alt="" width="36" height="36" referrerpolicy="no-referrer">`
        : html`<span class="avatar avatar-fallback" aria-hidden="true">${[...u.username][0]?.toUpperCase() ?? '?'}</span>`}</summary>
      <div class="user-menu-panel">
        <span class="signed-in">Signed in as</span><b>${u.username}</b>
        <form method="post" action="/auth/logout"><button class="ghost">Log out</button></form>
      </div>
    </details>
  </div>
</div></header>`

export const homePage = (u: SessionUser | null) =>
  layout('Custom Team Racing API', u ? nav(u) : guestNav, html`<section class="hero panel">
    <img class="hero-logo" src="/logo.png" alt="Custom Team Racing logo" width="160" height="160">
    <div class="hero-text">
    <h1>Custom Team Racing API</h1>
    <p class="lead">An API for Crash Team Racing custom tracks and other custom content.</p>
    <div class="actions">
      <a class="btn-link" href="/docs">View the Docs</a>
      ${u && (u.approved || u.isAdmin)
        ? html`<a class="btn-link ghost" href="/upload">Upload a track</a>`
        : html`<a class="btn-link ghost" href="/submit">Submit Content</a>`}
    </div>
    </div>
  </section>`)

export const submitPage = (u: SessionUser | null) =>
  layout('Submit content - Custom Team Racing API', u ? nav(u) : guestNav, html`<section class="panel">
    <h1>Submit content</h1>
    <p class="lead">Want to add your own custom track to the API? Here's how.</p>
    <ol>
      <li><b>Get approved.</b> Uploading is limited to approved creators. Ask a site admin in the
        <a href="https://customteamracing.com/discord">Custom Team Racing Discord server</a> to approve you.</li>
      <li><b>Sign in.</b> Log in to the CTR API with your Discord account.</li>
      <li><b>Upload.</b> Once you're approved, the Upload page will appear and you can submit your files.</li>
    </ol>
    <div class="actions">
      ${u
        ? (u.approved || u.isAdmin
          ? html`<a class="btn-link" href="/upload">Go to Upload</a>`
          : html`<a class="btn-link" href="https://customteamracing.com/discord">Join the Discord</a>`)
        : html`<a class="btn-link with-icon" href="/auth/login">${discordLogo} Log In</a>
          <a class="btn-link ghost" href="https://customteamracing.com/discord">Join the Discord</a>`}
    </div>
  </section>`)

const SWAGGER_VERSION = '5.17.14'
export const SWAGGER_BASE = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_VERSION}/`
export const DOCS_CSS = 'body{margin:0}'
export const DOCS_JS = "SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui' });"

export const docsPage = () => html`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Docs - Custom Team Racing API</title>
<link rel="icon" type="image/webp" href="/favicon.webp">
<link rel="stylesheet" href="${SWAGGER_BASE}swagger-ui.css" integrity="sha384-wxLW6kwyHktdDGr6Pv1zgm/VGJh99lfUbzSn6HNHBENZlCN7W602k9VkGdxuFvPn" crossorigin="anonymous">
<style>${raw(DOCS_CSS)}</style></head><body>
<div id="swagger-ui"></div>
<script src="${SWAGGER_BASE}swagger-ui-bundle.js" integrity="sha384-wmyclcVGX/WhUkdkATwhaK1X1JtiNrr2EoYJ+diV3vj4v6OC5yCeSu+yW13SYJep" crossorigin="anonymous"></script>
<script>${raw(DOCS_JS)}</script>
</body></html>`

export const pendingPage =(u: SessionUser) =>
  layout('Pending approval', nav(u), html`<div class="panel">
    <h1>Waiting for approval</h1>
    <p>You're logged in, but an admin hasn't approved your account for uploads yet.
    Send them your Discord user ID: <code>${u.discordId}</code></p></div>`)

export const forbiddenPage = (u: SessionUser) =>
  layout('Forbidden', nav(u), html`<div class="panel">
    <h1>Admins only</h1>
    <p>Your account doesn't have access to this page.</p></div>`)

export const UPLOAD_JS = `
document.getElementById('f').addEventListener('submit', async function (e) {
  e.preventDefault();
  var msg = document.getElementById('msg');
  msg.textContent = 'Uploading...';
  var res = await fetch('/upload', { method: 'POST', body: new FormData(e.target) });
  var data = await res.json().catch(function () { return {}; });
  msg.textContent = res.ok ? 'Uploaded! Track id: ' + data.id : 'Error: ' + (data.error || res.status);
  if (res.ok) e.target.reset();
});`

export const uploadPage = (u: SessionUser) =>
  layout('Upload a track', nav(u), html`<form id="f" class="panel">
    <h1>Upload a track</h1>
    <p class="lead">Share a custom track with the community.</p>
    <div class="grid">
      <label class="full">Track name <input name="name" required maxlength="100"></label>
      <label class="full">Description <textarea name="description" rows="4" maxlength="2000"></textarea></label>
      <label>Creator name <input name="creatorName" required maxlength="100" value="${u.username}"></label>
      <label>Date the track was created <input name="createdDate" type="date" required></label>
      <label class="full">.lev file <input name="lev" type="file" accept=".lev" required></label>
      <label class="full">.vrm file (optional) <input name="vrm" type="file" accept=".vrm"></label>
      <label class="full">.sca file (optional) <input name="sca" type="file" accept=".sca"></label>
    </div>
    <p class="meta">Unfamiliar with .sca files? See the
      <a href="https://github.com/Garma1337/howl-editor/blob/main/documentation/formats/sca.md" target="_blank">.sca format documentation</a>.
      <a href="https://customteamracing.com/discord" target="_blank">Join our Discord server</a> if you have questions.</p>
    <div class="actions"><button type="submit">Upload</button></div>
    <div id="msg" class="msg" role="status"></div>
  </form>
  <script>${raw(UPLOAD_JS)}</script>`)

export const ADMIN_JS = `
async function api(method, url, body) {
  var res = await fetch(url, { method: method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) { alert(data.error || ('Error ' + res.status)); throw new Error('request failed'); }
  return data;
}
function h(tag, attrs, kids) {
  var n = document.createElement(tag);
  for (var k in (attrs || {})) {
    if (k === 'text') n.textContent = attrs[k];
    else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
    else n[k] = attrs[k];
  }
  (kids || []).forEach(function (c) { n.appendChild(c); });
  return n;
}
async function loadUsers() {
  var data = await api('GET', '/admin/api/users');
  var tbody = document.getElementById('users');
  tbody.replaceChildren();
  if (!data.users.length) tbody.appendChild(h('tr', {}, [h('td', { colSpan: 4, className: 'empty', text: 'No creators yet.' })]));
  data.users.forEach(function (u) {
    var btn = h('button', { className: u.approved ? 'ghost' : '', text: u.approved ? 'Remove approval' : 'Approve', onclick: async function () {
      await api('POST', '/admin/api/users/' + u.discordId + '/approval', { approved: !u.approved });
      loadUsers();
    } });
    tbody.appendChild(h('tr', {}, [
      h('td', { text: u.username }), h('td', { text: u.discordId }),
      h('td', {}, [h('span', { className: 'badge' + (u.approved ? ' ok' : ''), text: u.approved ? 'Approved' : 'Pending' })]), h('td', {}, [btn])
    ]));
  });
}
async function loadTracks() {
  var data = await (await fetch('/v1/tracks?limit=100')).json();
  var box = document.getElementById('tracks');
  box.replaceChildren();
  if (!data.tracks.length) box.appendChild(h('p', { className: 'empty', text: 'No tracks uploaded yet.' }));
  data.tracks.forEach(function (t) {
    var f = {};
    function field(label, key, kind) {
      var input = h(kind === 'textarea' ? 'textarea' : 'input', { value: t[key] });
      if (kind === 'date') input.type = 'date';
      f[key] = input;
      return h('label', { text: label }, [input]);
    }
    box.appendChild(h('div', { className: 'card' }, [
      h('div', { className: 'card-head' }, [h('h3', { text: t.name }), h('code', { text: t.id })]),
      field('Track name', 'name'), field('Description', 'description', 'textarea'),
      h('div', { className: 'grid' }, [field('Creator name', 'creatorName'), field('Created date', 'createdDate', 'date')]),
      h('p', { className: 'meta', text: 'Uploaded by ' + t.uploadedBy + ' on ' + t.uploadedDate }),
      h('div', { className: 'actions' }, [
      h('button', { text: 'Save', onclick: async function () {
        await api('PATCH', '/admin/api/tracks/' + t.id, { name: f.name.value, description: f.description.value, creatorName: f.creatorName.value, createdDate: f.createdDate.value });
        alert('Saved');
      } }),
      h('button', { className: 'danger', text: 'Delete', onclick: async function () {
        if (!confirm('Delete "' + t.name + '" and its files?')) return;
        await api('DELETE', '/admin/api/tracks/' + t.id);
        loadTracks();
      } })
      ])
    ]));
  });
}
loadUsers(); loadTracks();`

export const adminPage = (u: SessionUser) =>
  layout('Admin', nav(u), html`<div class="panel"><h1>Admin</h1></div>
  <section class="panel"><h2>Creators</h2>
  <div class="table-wrap"><table><thead><tr><th>Name</th><th>Discord ID</th><th>Status</th><th></th></tr></thead><tbody id="users"></tbody></table></div></section>
  <section class="panel"><h2>Tracks</h2><div id="tracks"></div></section>
  <script>${raw(ADMIN_JS)}</script>`)