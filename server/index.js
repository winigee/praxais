// Praixis server — zero-dependency Node HTTP. Serves the SPA from web/ and a
// small REST + SSE API under /api. The BonesAI engine (ai/) powers drafting,
// docket extraction, intake triage, and the embedded assistant.

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const db = require('./db');
const { seed } = require('./seed');
const agents = require('./ai/agents');
const bones = require('./ai/bones');
const watcher = require('./integrations/thewatcher');
const access = require('./access');
const conflicts = require('./conflicts');

// Resolve TheWatcher's URL: runtime setting wins, then env, then unset.
function watcherUrl() {
  return db.getSetting('thewatcherUrl', process.env.THEWATCHER_URL || '') || '';
}
// Mirror a TheWatcher entry into the local store so billing survives if the
// timekeeper later goes offline. Deduped on the external id.
function mirrorEntry(entry) {
  if (!entry) return null;
  const extId = entry.id;
  const existing = extId && db.where('timeEntries', (t) => t.externalId === extId)[0];
  const row = {
    matterId: entry.matterId || null, attorney: entry.attorney || '',
    description: entry.description || '', minutes: entry.minutes || 0,
    rate: entry.rate || 0, date: (entry.endedAt || entry.date || new Date().toISOString()).slice(0, 10),
    source: 'thewatcher', externalId: extId, billable: entry.billable !== false,
  };
  return existing ? db.update('timeEntries', existing.id, row) : db.insert('timeEntries', row);
}

const PORT = process.env.PORT || 4317;
const WEB_DIR = path.join(__dirname, '..', 'web');

// Settings persisted in the _meta bag. thewatcherUrl is shared with the Time tab.
const SETTINGS_DEFAULTS = {
  firmName: '', firmAddress: '', firmEmail: '', firmPhone: '',
  defaultModel: '', defaultProtect: true, thewatcherUrl: '',
  billingCurrency: 'USD', billingDefaultRate: 0, invoicePrefix: 'INV-', invoiceNextNumber: 1001,
};

// --- helpers ----------------------------------------------------------------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 5e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (_) { resolve({}); } });
  });
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.replace(/^\/+/, ''));
  const full = path.join(WEB_DIR, rel);
  if (!full.startsWith(WEB_DIR)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(full, (err, buf) => {
    if (err) {
      // SPA fallback: unknown non-API path → index.html
      if (!rel.includes('.')) return fs.readFile(path.join(WEB_DIR, 'index.html'), (e2, b2) => {
        if (e2) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'content-type': 'text/html' }); res.end(b2);
      });
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(buf);
  });
}

// --- dashboard summary ------------------------------------------------------
// Everything matter-derived is scoped to what the acting user may see.
function buildState() {
  const user = access.currentUser();
  const matters = access.visibleMatters(user);
  const visibleIds = new Set(matters.map((m) => m.id));
  const clientIds = new Set(matters.map((m) => m.clientId).filter(Boolean));
  const events = db.where('events', (e) => visibleIds.has(e.matterId));
  const today = new Date().toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const upcoming = events
    .filter((e) => e.status !== 'done' && e.dueDate)
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  return {
    ai: { available: bones.available() },
    user: user && { id: user.id, name: user.name, role: user.role, title: user.title },
    counts: {
      matters: matters.length,
      openMatters: matters.filter((m) => m.status === 'open').length,
      clients: clientIds.size,
      documents: db.where('documents', (d) => visibleIds.has(d.matterId)).length,
      newIntake: db.all('intake').filter((i) => i.status === 'new').length,
      overdue: upcoming.filter((e) => e.dueDate < today).length,
      dueThisWeek: upcoming.filter((e) => e.dueDate >= today && e.dueDate <= in7).length,
    },
    upcoming: upcoming.slice(0, 8).map((e) => ({ ...e, matter: db.get('matters', e.matterId)?.title })),
    recentActivity: db.all('activity').filter((a) => !a.matterId || visibleIds.has(a.matterId)).slice(-12).reverse(),
  };
}

function matterDetail(id) {
  const matter = db.get('matters', id);
  if (!matter) return null;
  return {
    ...matter,
    client: matter.clientId ? db.get('clients', matter.clientId) : null,
    documents: db.where('documents', (d) => d.matterId === id),
    events: db.where('events', (e) => e.matterId === id).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))),
    notes: db.where('notes', (n) => n.matterId === id),
    timeEntries: db.where('timeEntries', (t) => t.matterId === id),
  };
}

// --- global search ----------------------------------------------------------
// Sweeps matters + their documents, notes, deadlines, and clients — but only
// across matters the acting user may see, so confidentiality holds in search.
function search(q) {
  const term = String(q).trim().toLowerCase();
  if (!term) return { query: '', results: [] };
  const user = access.currentUser();
  const matters = access.visibleMatters(user);
  const visibleIds = new Set(matters.map((m) => m.id));
  const hit = (s) => s && String(s).toLowerCase().includes(term);
  const out = [];

  for (const m of matters) {
    if (hit(m.title) || hit(m.reference) || hit(m.practiceArea) || hit(m.description) || (m.parties || []).some((p) => hit(p.name)))
      out.push({ type: 'matter', id: m.id, matterId: m.id, label: m.title, sub: `${m.reference || m.id} · ${m.practiceArea || '—'}` });
  }
  for (const c of db.all('clients')) {
    // Only surface a client if they're attached to a matter the user can see.
    const theirMatter = matters.find((m) => m.clientId === c.id);
    if (theirMatter && (hit(c.name) || hit(c.email)))
      out.push({ type: 'client', id: c.id, matterId: theirMatter.id, label: c.name, sub: `Client · ${c.type}` });
  }
  for (const d of db.where('documents', (x) => visibleIds.has(x.matterId))) {
    if (hit(d.name) || hit(d.content))
      out.push({ type: 'document', id: d.id, matterId: d.matterId, label: d.name, sub: `Document · ${db.get('matters', d.matterId)?.reference || ''}` });
  }
  for (const n of db.where('notes', (x) => visibleIds.has(x.matterId))) {
    if (hit(n.body)) out.push({ type: 'note', id: n.id, matterId: n.matterId, label: n.body.slice(0, 80), sub: `Note · ${db.get('matters', n.matterId)?.reference || ''}` });
  }
  for (const e of db.where('events', (x) => visibleIds.has(x.matterId))) {
    if (hit(e.title)) out.push({ type: 'event', id: e.id, matterId: e.matterId, label: e.title, sub: `Deadline ${e.dueDate || ''} · ${db.get('matters', e.matterId)?.reference || ''}` });
  }
  return { query: q, results: out.slice(0, 30) };
}

// --- iCalendar export -------------------------------------------------------
// Builds a VCALENDAR of all-day deadline events with a 1-day-before reminder,
// importable into Apple/Outlook/Google Calendar. Zero dependencies.
function buildICS(events) {
  const esc = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateOnly = (d) => String(d).replace(/-/g, '').slice(0, 8);
  const nextDay = (d) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10).replace(/-/g, ''); };
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Praixis//Deadlines//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Praixis deadlines'];
  for (const e of events) {
    const matter = db.get('matters', e.matterId);
    const summary = `${e.title}${matter?.reference ? ` (${matter.reference})` : ''}`;
    const desc = [matter?.title, e.type ? `Type: ${e.type}` : null, e.priority ? `Priority: ${e.priority}` : null, e.rationale].filter(Boolean).join(' — ');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@praixis`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dateOnly(e.dueDate)}`,
      `DTEND;VALUE=DATE:${nextDay(e.dueDate)}`,
      `SUMMARY:${esc(summary)}`,
      `DESCRIPTION:${esc(desc)}`,
      e.priority === 'high' ? 'PRIORITY:1' : 'PRIORITY:5',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc('Reminder: ' + summary)}`, 'TRIGGER:-P1D', 'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// --- streaming chat (SSE over POST) -----------------------------------------
async function handleChat(req, res, body) {
  const { matterId, messages = [], protect = true, model } = body;
  // Don't let the assistant reason over a matter the user can't see.
  if (matterId) {
    const m = db.get('matters', matterId);
    if (m && !access.canSeeMatter(access.currentUser(), m)) return sendJson(res, 403, { error: 'no access to this matter' });
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const system = agents.assistantSystem(matterId);

  try {
    if (!bones.available()) {
      const reply = offlineAssistantReply(matterId, messages);
      for (const tok of reply.match(/\S+\s*/g) || [reply]) { send('token', tok); await sleep(12); }
      send('done', { usedAI: false }); return res.end();
    }
    // Redact outbound user turns when protect is on; re-identify the reply.
    let replacements = [];
    let outMessages = messages.map((m) => ({ role: m.role, content: m.content }));
    if (protect) {
      const ctx = agents.matterContext(matterId);
      const ents = bones.knownEntities(ctx.matter, ctx.client);
      const seen = new Map();
      outMessages = messages.map((m) => {
        if (m.role !== 'user') return m;
        const r = bones.redact(m.content, ents);
        for (const rep of r.replacements) if (!seen.has(rep.placeholder)) { seen.set(rep.placeholder, rep.original); }
        return { role: 'user', content: r.text };
      });
      replacements = Array.from(seen, ([placeholder, original]) => ({ placeholder, original }));
    }
    let raw = '';
    await bones.stream({ system, messages: outMessages, model }, {
      onToken: (t) => {
        raw += t;
        send('token', protect ? bones.reidentify(t, replacements) : t);
      },
    });
    send('done', { usedAI: true, redactionCount: replacements.length });
  } catch (e) {
    send('error', { message: e.message });
  }
  res.end();
}
function offlineAssistantReply(matterId, messages) {
  const ctx = agents.matterContext(matterId);
  const q = messages.filter((m) => m.role === 'user').slice(-1)[0]?.content || '';
  return (
    `[BonesAI offline — no ANTHROPIC_API_KEY set]\n\n`
    + (ctx.matter
      ? `For the matter "${ctx.matter.title}", I can draft documents, extract deadlines, and answer questions once a key is configured.\n\nContext I have:\n${ctx.brief}\n\n`
      : '')
    + `You asked: "${q.slice(0, 200)}". Set ANTHROPIC_API_KEY and restart to get a real, matter-aware answer.`
  );
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- router -----------------------------------------------------------------
async function api(req, res, pathname, query) {
  const seg = pathname.split('/').filter(Boolean); // ['api', ...]
  const method = req.method;
  const r = seg.slice(1); // after 'api'

  // GET /api/state
  if (r[0] === 'state' && method === 'GET') return sendJson(res, 200, buildState());
  if (r[0] === 'ai' && r[1] === 'status' && method === 'GET')
    return sendJson(res, 200, { available: bones.available(), templates: agents.DRAFT_TEMPLATES, models: bones.MODELS });

  // Users + "acting as" session (stand-in for login until accounts land)
  if (r[0] === 'users') {
    if (method === 'GET') return sendJson(res, 200, db.all('users'));
    const me = access.currentUser();
    if (!me || me.role !== 'admin') return sendJson(res, 403, { error: 'admin only' });
    const ROLES = ['admin', 'attorney', 'staff'];
    if (!r[1] && method === 'POST') {
      const b = await readBody(req);
      if (!b.name || !b.name.trim()) return sendJson(res, 400, { error: 'name required' });
      const u = db.insert('users', { name: b.name.trim(), role: ROLES.includes(b.role) ? b.role : 'staff', title: b.title || '', email: b.email || '' });
      return sendJson(res, 201, u);
    }
    if (r[1] && method === 'PATCH') {
      const b = await readBody(req); const patch = {};
      for (const k of ['name', 'title', 'email']) if (k in b) patch[k] = b[k];
      if (b.role && ROLES.includes(b.role)) patch.role = b.role;
      const u = db.update('users', r[1], patch);
      return u ? sendJson(res, 200, u) : sendJson(res, 404, { error: 'not found' });
    }
    if (r[1] && method === 'DELETE') {
      if (r[1] === me.id) return sendJson(res, 400, { error: 'you cannot delete yourself' });
      const t = db.get('users', r[1]);
      if (!t) return sendJson(res, 404, { error: 'not found' });
      if (t.role === 'admin' && db.where('users', (u) => u.role === 'admin').length <= 1) return sendJson(res, 400, { error: 'cannot delete the last admin' });
      db.remove('users', r[1]);
      // Strip the departed user from every matter's access list.
      for (const m of db.all('matters')) if (Array.isArray(m.access) && m.access.includes(r[1])) db.update('matters', m.id, { access: m.access.filter((x) => x !== r[1]) });
      return sendJson(res, 200, { ok: true });
    }
  }
  if (r[0] === 'me' && method === 'GET') return sendJson(res, 200, access.currentUser());
  if (r[0] === 'session' && method === 'POST') {
    const b = await readBody(req);
    const u = b.userId && db.get('users', b.userId);
    if (!u) return sendJson(res, 400, { error: 'unknown user' });
    db.setSetting('currentUserId', u.id);
    return sendJson(res, 200, u);
  }

  // Data backup / restore / reset — admin only.
  if (['backup', 'restore', 'reset'].includes(r[0])) {
    const me = access.currentUser();
    if (me && me.role !== 'admin') return sendJson(res, 403, { error: 'admin only' });
    if (r[0] === 'backup' && method === 'GET') {
      const body = JSON.stringify(db.exportDb(), null, 2);
      res.writeHead(200, { 'content-type': 'application/json', 'content-disposition': `attachment; filename="praixis-backup-${new Date().toISOString().slice(0, 10)}.json"` });
      return res.end(body);
    }
    if (r[0] === 'restore' && method === 'POST') {
      const b = await readBody(req);
      try { db.importDb(b.snapshot || b); db.logActivity({ actor: me?.name || 'admin', action: 'restored-backup' }); return sendJson(res, 200, { ok: true }); }
      catch (e) { return sendJson(res, 400, { error: e.message }); }
    }
    if (r[0] === 'reset' && method === 'POST') {
      const b = await readBody(req);
      db.reset();
      if (b.mode !== 'empty') seed({ force: true });
      db.logActivity({ actor: me?.name || 'admin', action: 'reset-data', detail: b.mode || 'seed' });
      return sendJson(res, 200, { ok: true });
    }
  }

  // Settings — firm profile + app preferences (stored in the _meta bag).
  if (r[0] === 'settings') {
    if (method === 'GET') {
      const out = {}; for (const k of Object.keys(SETTINGS_DEFAULTS)) out[k] = db.getSetting(k, SETTINGS_DEFAULTS[k]);
      return sendJson(res, 200, { settings: out, ai: { available: bones.available(), models: bones.MODELS } });
    }
    if (method === 'POST') {
      const b = await readBody(req);
      for (const k of Object.keys(SETTINGS_DEFAULTS)) if (k in b) db.setSetting(k, b[k]);
      db.logActivity({ actor: access.currentUser()?.name || 'user', action: 'updated-settings' });
      const out = {}; for (const k of Object.keys(SETTINGS_DEFAULTS)) out[k] = db.getSetting(k, SETTINGS_DEFAULTS[k]);
      return sendJson(res, 200, { settings: out });
    }
  }

  // Global search — scoped to matters the acting user may see.
  if (r[0] === 'search' && method === 'GET') return sendJson(res, 200, search(query.q || ''));

  // Conflict check — firm-wide sweep, access-aware results.
  if (r[0] === 'conflicts' && r[1] === 'check' && method === 'POST') {
    const b = await readBody(req);
    return sendJson(res, 200, conflicts.check(b.names || b.name || [], access.currentUser()));
  }

  // Clients
  if (r[0] === 'clients') {
    if (method === 'GET') return sendJson(res, 200, db.all('clients'));
    if (method === 'POST') { const b = await readBody(req); return sendJson(res, 201, db.insert('clients', b)); }
  }

  // Matters
  if (r[0] === 'matters') {
    const me = access.currentUser();
    if (!r[1] && method === 'GET') {
      const list = access.visibleMatters(me).map((m) => ({ ...m, client: db.get('clients', m.clientId)?.name }));
      return sendJson(res, 200, list);
    }
    if (!r[1] && method === 'POST') {
      const b = await readBody(req);
      // A matter cannot exist without a client on file.
      if (!b.clientId || !db.get('clients', b.clientId)) return sendJson(res, 400, { error: 'A matter must be linked to a client. Create or select the client first.' });
      // The creator is granted access so they can see what they just opened.
      const acl = Array.from(new Set([...(b.access || []), me?.id].filter(Boolean)));
      const m = db.insert('matters', { status: 'open', parties: [], tags: [], ...b, access: acl });
      db.logActivity({ actor: me?.name || 'user', action: 'created-matter', matterId: m.id, detail: m.title });
      return sendJson(res, 201, m);
    }
    // Reads/writes of a specific matter are gated on access.
    if (r[1]) {
      const m0 = db.get('matters', r[1]);
      if (!m0) return sendJson(res, 404, { error: 'not found' });
      if (!access.canSeeMatter(me, m0)) return sendJson(res, 403, { error: 'no access to this matter' });
    }
    if (r[1] && method === 'GET') { const d = matterDetail(r[1]); return d ? sendJson(res, 200, d) : sendJson(res, 404, { error: 'not found' }); }
    if (r[1] && method === 'PATCH') { const b = await readBody(req); const m = db.update('matters', r[1], b); return m ? sendJson(res, 200, m) : sendJson(res, 404, { error: 'not found' }); }
    if (r[1] && method === 'DELETE') {
      const m = db.get('matters', r[1]);
      if (!m) return sendJson(res, 404, { error: 'not found' });
      // Cascade: drop everything that hangs off the matter so nothing orphans.
      for (const c of ['documents', 'events', 'notes', 'timeEntries']) {
        for (const row of db.where(c, (x) => x.matterId === r[1])) db.remove(c, row.id);
      }
      db.remove('matters', r[1]);
      db.logActivity({ actor: 'user', action: 'deleted-matter', detail: m.title });
      return sendJson(res, 200, { ok: true });
    }
  }

  // Documents
  if (r[0] === 'documents') {
    if (!r[1] && method === 'GET') return sendJson(res, 200, query.matterId ? db.where('documents', (d) => d.matterId === query.matterId) : db.all('documents'));
    if (!r[1] && method === 'POST') { const b = await readBody(req); const d = db.insert('documents', { source: 'uploaded', tags: [], ...b }); return sendJson(res, 201, d); }
    if (r[1] && method === 'GET') { const d = db.get('documents', r[1]); return d ? sendJson(res, 200, d) : sendJson(res, 404, { error: 'not found' }); }
  }

  // Events / deadlines
  if (r[0] === 'events') {
    const me = access.currentUser();
    const visible = access.visibleMatterIdSet(me);
    // Calendar export (.ics) — visible deadlines, with a day-before reminder.
    if (r[1] === 'export.ics' && method === 'GET') {
      let list = db.where('events', (e) => visible.has(e.matterId) && e.dueDate && e.status !== 'done');
      if (query.matterId) list = list.filter((e) => e.matterId === query.matterId);
      const ics = buildICS(list);
      res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': 'attachment; filename="praixis-deadlines.ics"' });
      return res.end(ics);
    }
    if (!r[1] && method === 'GET') {
      let list = query.matterId ? db.where('events', (e) => e.matterId === query.matterId) : db.all('events');
      list = list.filter((e) => visible.has(e.matterId))
        .map((e) => ({ ...e, matter: db.get('matters', e.matterId)?.title }))
        .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
      return sendJson(res, 200, list);
    }
    if (!r[1] && method === 'POST') { const b = await readBody(req); return sendJson(res, 201, db.insert('events', { status: 'pending', source: 'manual', priority: 'normal', ...b })); }
    if (r[1] && method === 'PATCH') { const b = await readBody(req); const e = db.update('events', r[1], b); return e ? sendJson(res, 200, e) : sendJson(res, 404, { error: 'not found' }); }
    if (r[1] && method === 'DELETE') { return sendJson(res, 200, { ok: db.remove('events', r[1]) }); }
  }

  // Notes / time entries
  if (r[0] === 'notes' && method === 'POST') { const b = await readBody(req); return sendJson(res, 201, db.insert('notes', b)); }
  if (r[0] === 'timeEntries') {
    if (method === 'GET') return sendJson(res, 200, query.matterId ? db.where('timeEntries', (t) => t.matterId === query.matterId) : db.all('timeEntries'));
    if (method === 'POST') { const b = await readBody(req); return sendJson(res, 201, db.insert('timeEntries', b)); }
  }

  // Intake
  if (r[0] === 'intake') {
    if (!r[1] && method === 'GET') return sendJson(res, 200, db.all('intake'));
    if (!r[1] && method === 'POST') { const b = await readBody(req); return sendJson(res, 201, db.insert('intake', { status: 'new', receivedAt: new Date().toISOString().slice(0, 10), ...b })); }
    if (r[1] && r[2] === 'triage' && method === 'POST') {
      const b = await readBody(req);
      try { return sendJson(res, 200, await agents.triageIntake({ intakeId: r[1], protect: b.protect !== false })); }
      catch (e) { return sendJson(res, 400, { error: e.message }); }
    }
    if (r[1] && r[2] === 'convert' && method === 'POST') {
      const b = await readBody(req);
      try { return sendJson(res, 200, agents.convertIntakeToMatter({ intakeId: r[1], ...b })); }
      catch (e) { return sendJson(res, 400, { error: e.message }); }
    }
  }

  // Activity log
  if (r[0] === 'activity' && method === 'GET') return sendJson(res, 200, db.all('activity').slice(-100).reverse());

  // --- TheWatcher (timekeeper) integration ---
  if (r[0] === 'watcher') {
    const base = watcherUrl();
    // Config: get/set the TheWatcher URL at runtime.
    if (r[1] === 'config' && method === 'GET') return sendJson(res, 200, { url: base, fromEnv: !!process.env.THEWATCHER_URL });
    if (r[1] === 'config' && method === 'POST') { const b = await readBody(req); db.setSetting('thewatcherUrl', (b.url || '').trim()); return sendJson(res, 200, { url: watcherUrl() }); }

    // Status / health.
    if (r[1] === 'status' && method === 'GET') return sendJson(res, 200, await watcher.status(base));

    // Live timers (running). Empty list if not connected.
    if (r[1] === 'timers' && !r[2] && method === 'GET') {
      try { return sendJson(res, 200, { connected: true, timers: await watcher.listTimers(base) }); }
      catch (e) { return sendJson(res, 200, { connected: false, timers: [], error: e.code || e.message }); }
    }
    // Start a timer for a matter.
    if (r[1] === 'timers' && r[2] === 'start' && method === 'POST') {
      const b = await readBody(req);
      const m = b.matterId ? db.get('matters', b.matterId) : null;
      const payload = {
        matterId: b.matterId || null,
        matterRef: m?.reference || b.matterRef || null,
        label: m?.title || b.label || 'Untitled',
        attorney: b.attorney || m?.responsibleAttorney || '',
        description: b.description || '',
        rate: b.rate || 0,
      };
      try {
        const t = await watcher.startTimer(base, payload);
        db.logActivity({ actor: 'user', action: 'started-timer', matterId: payload.matterId, detail: `${payload.label} (TheWatcher)` });
        return sendJson(res, 200, t);
      } catch (e) { return sendJson(res, 502, { error: e.message, code: e.code }); }
    }
    // Stop a timer → mirror the resulting entry locally for billing.
    if (r[1] === 'timers' && r[2] && r[3] === 'stop' && method === 'POST') {
      try {
        const out = await watcher.stopTimer(base, r[2]);
        const mirrored = mirrorEntry(out.entry);
        db.logActivity({ actor: 'user', action: 'stopped-timer', matterId: out.entry?.matterId, detail: `${out.entry?.minutes || 0} min logged (TheWatcher)` });
        return sendJson(res, 200, { ...out, mirrored });
      } catch (e) { return sendJson(res, 502, { error: e.message, code: e.code }); }
    }
    // Entries: prefer TheWatcher (live), fall back to local mirror/manual entries.
    if (r[1] === 'entries' && method === 'GET') {
      try {
        const live = await watcher.listEntries(base, { matterId: query.matterId });
        return sendJson(res, 200, { source: 'thewatcher', entries: live });
      } catch (e) {
        const local = query.matterId ? db.where('timeEntries', (t) => t.matterId === query.matterId) : db.all('timeEntries');
        return sendJson(res, 200, { source: 'local', entries: local, watcherError: e.code || e.message });
      }
    }
    // Webhook: TheWatcher → Praixis live push.
    if (r[1] === 'events' && method === 'POST') {
      const b = await readBody(req);
      if (b.type === 'entry.created' && b.entry) { mirrorEntry(b.entry); db.logActivity({ actor: 'thewatcher', action: 'entry.created', matterId: b.entry.matterId, detail: `${b.entry.minutes || 0} min` }); }
      return sendJson(res, 200, { ok: true });
    }
  }

  // --- AI agent endpoints ---
  if (r[0] === 'ai') {
    // Agents must not operate on a matter the acting user can't see.
    const matterDenied = (mid) => { if (!mid) return false; const m = db.get('matters', mid); return m && !access.canSeeMatter(access.currentUser(), m); };
    if (r[1] === 'draft' && method === 'POST') {
      const b = await readBody(req);
      if (matterDenied(b.matterId)) return sendJson(res, 403, { error: 'no access to this matter' });
      try { return sendJson(res, 200, await agents.draftDocument(b)); }
      catch (e) { return sendJson(res, 400, { error: e.message }); }
    }
    if (r[1] === 'extract-deadlines' && method === 'POST') {
      const b = await readBody(req);
      if (matterDenied(b.matterId)) return sendJson(res, 403, { error: 'no access to this matter' });
      try {
        let text = b.text;
        if (!text && b.documentId) text = db.get('documents', b.documentId)?.content || '';
        return sendJson(res, 200, await agents.extractDeadlines({ ...b, text }));
      } catch (e) { return sendJson(res, 400, { error: e.message }); }
    }
    if (r[1] === 'redact-preview' && method === 'POST') {
      const b = await readBody(req);
      return sendJson(res, 200, bones.redact(b.text || '', { people: b.people || [], companies: b.companies || [] }));
    }
    if (r[1] === 'chat' && method === 'POST') { const b = await readBody(req); return handleChat(req, res, b); }
  }

  return sendJson(res, 404, { error: `no route: ${method} ${pathname}` });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  if (pathname.startsWith('/api/')) {
    api(req, res, pathname, parsed.query).catch((e) => { console.error(e); if (!res.headersSent) sendJson(res, 500, { error: e.message }); });
    return;
  }
  serveStatic(req, res, pathname);
});

db.load();
seed();
server.listen(PORT, () => {
  console.log(`\n  Praixis — AI practice management suite`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  BonesAI engine: ${bones.available() ? 'ONLINE (Anthropic key detected)' : 'OFFLINE (set ANTHROPIC_API_KEY for live agents)'}`);
  console.log(`  TheWatcher:     ${watcherUrl() ? watcherUrl() + ' (configured)' : 'not configured (set THEWATCHER_URL or connect in the Time tab)'}\n`);
});
