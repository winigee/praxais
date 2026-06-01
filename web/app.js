// Praixis front-end — vanilla JS SPA. No build step.

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) { if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid)); }
  return n;
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const api = {
  async get(p) { const r = await fetch('/api' + p); if (!r.ok) throw new Error((await r.json()).error || r.statusText); return r.json(); },
  async post(p, b) { const r = await fetch('/api' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText); return r.json(); },
  async patch(p, b) { const r = await fetch('/api' + p, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) }); return r.json(); },
  async del(p) { const r = await fetch('/api' + p, { method: 'DELETE' }); return r.json(); },
};

const state = { view: 'dashboard', matterId: null, aiAvailable: false, chat: [] };

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

// --- views ------------------------------------------------------------------
const views = {};

views.dashboard = async () => {
  const s = await api.get('/state');
  const c = s.counts;
  const stat = (n, l, cls = '') => el('div', { class: `stat ${cls}` }, el('div', { class: 'n' }, String(n)), el('div', { class: 'l' }, l));
  const grid = el('div', { class: 'stat-grid' },
    stat(c.openMatters, 'Open matters'),
    stat(c.clients, 'Clients'),
    stat(c.documents, 'Documents'),
    stat(c.newIntake, 'New intake', c.newIntake ? 'warn' : ''),
    stat(c.dueThisWeek, 'Due this week', c.dueThisWeek ? 'warn' : ''),
    stat(c.overdue, 'Overdue', c.overdue ? 'alert' : ''),
  );

  const deadlines = el('div', { class: 'card grow' },
    el('h3', {}, 'Upcoming deadlines'),
    s.upcoming.length ? table(
      ['Due', 'Item', 'Matter', 'Type'],
      s.upcoming.map((e) => [dueCell(e.dueDate), e.title, e.matter || '—', el('span', { class: `badge ${e.priority}` }, e.type)]),
    ) : el('div', { class: 'empty' }, 'Nothing scheduled.'),
  );
  const activity = el('div', { class: 'card grow' },
    el('h3', {}, 'Recent activity'),
    s.recentActivity.length ? el('div', {}, ...s.recentActivity.map((a) => el('div', { class: 'muted', style: 'padding:6px 0;border-bottom:1px solid var(--border);font-size:13px' },
      `${a.actor || 'system'} · ${a.action} — ${a.detail || ''}`))) : el('div', { class: 'empty' }, 'No activity yet.'),
  );

  return el('div', {}, grid, el('div', { class: 'row' }, deadlines, activity));
};

views.matters = async () => {
  if (state.matterId) return matterDetail(state.matterId);
  const list = await api.get('/matters');
  const head = el('div', { class: 'section-head' },
    el('h2', {}, 'Matters'),
    el('button', { class: 'btn primary', onclick: showNewMatter }, '+ New matter'));
  if (!list.length) return el('div', {}, head, el('div', { class: 'empty' }, 'No matters yet.'));
  const t = table(
    ['Reference', 'Title', 'Client', 'Practice area', 'Attorney', 'Status'],
    list.map((m) => ({
      cells: [m.reference || m.id, m.title, m.client || '—', m.practiceArea || '—', m.responsibleAttorney || '—', el('span', { class: `badge ${m.status}` }, m.status)],
      onclick: () => { state.matterId = m.id; render(); },
    })),
  );
  return el('div', {}, head, el('div', { class: 'card' }, t));
};

async function matterDetail(id) {
  const m = await api.get('/matters/' + id);
  setAssistantContext(m);
  const back = el('a', { class: 'pill-link', onclick: () => { state.matterId = null; setAssistantContext(null); render(); } }, '← All matters');

  const header = el('div', { class: 'card' },
    el('div', { class: 'section-head' },
      el('div', {}, el('h2', { style: 'margin:0' }, m.title),
        el('div', { class: 'muted' }, `${m.reference || m.id} · ${m.practiceArea || '—'} · ${m.responsibleAttorney || 'unassigned'}`)),
      el('span', { class: `badge ${m.status}` }, m.status)),
    m.description ? el('p', { class: 'muted' }, m.description) : null,
    m.client ? el('div', {}, el('strong', {}, 'Client: '), `${m.client.name} (${m.client.type})`, m.client.email ? el('span', { class: 'muted' }, ` · ${m.client.email}`) : null) : null,
    m.parties?.length ? el('div', { style: 'margin-top:6px' }, el('strong', {}, 'Other parties: '), m.parties.map((p) => `${p.name} [${p.role}]`).join('; ')) : null,
    el('div', { class: 'btn-row' },
      el('button', { class: 'btn primary', onclick: () => { openAssistant(); } }, '🦴 Ask BonesAI about this matter'),
      el('button', { class: 'btn', onclick: () => { state.view = 'drafting'; state.draftMatter = id; setNav(); render(); } }, '✍️ Draft document'),
      el('button', { class: 'btn', onclick: async () => {
        try { await api.post('/watcher/timers/start', { matterId: id, attorney: m.responsibleAttorney, description: m.title }); toast('Timer started in TheWatcher.'); state.view = 'time'; setNav(); render(); }
        catch (e) { toast(e.message.includes('unreachable') || e.message.includes('configured') ? 'Connect TheWatcher in the Time tab first.' : 'Error: ' + e.message); }
      } }, '⏱️ Start timer'),
      el('button', { class: 'btn danger', style: 'margin-left:auto', onclick: async () => {
        if (!confirm(`Delete "${m.title}"?\n\nThis also removes its documents, deadlines, notes and time entries. This cannot be undone.`)) return;
        try { await api.del('/matters/' + id); toast('Matter deleted.'); state.matterId = null; setAssistantContext(null); render(); }
        catch (e) { toast('Error: ' + e.message); }
      } }, '🗑 Delete matter'),
    ),
  );

  const docs = el('div', { class: 'card grow' },
    el('h3', {}, `Documents (${m.documents.length})`),
    m.documents.length ? el('div', {}, ...m.documents.map((d) => el('div', { class: 'row', style: 'padding:8px 0;border-bottom:1px solid var(--border);align-items:center' },
      el('div', { class: 'grow' }, el('a', { onclick: () => showDoc(d) }, d.name), el('div', { class: 'muted', style: 'font-size:12px' }, `${d.type} · ${d.source}`)),
      el('button', { class: 'btn', onclick: () => extractFromDoc(d.id, m.id) }, '📅 Extract dates'),
    ))) : el('div', { class: 'empty' }, 'No documents.'),
  );
  const events = el('div', { class: 'card grow' },
    el('h3', {}, `Deadlines (${m.events.length})`),
    m.events.length ? table(['Due', 'Item', 'Type', ''], m.events.map((e) => [
      dueCell(e.dueDate),
      el('span', { style: e.status === 'done' ? 'text-decoration:line-through;color:var(--muted)' : '' }, e.title),
      el('span', { class: `badge ${e.priority}` }, e.type),
      el('button', { class: 'btn', onclick: async () => { await api.patch('/events/' + e.id, { status: e.status === 'done' ? 'pending' : 'done' }); render(); } }, e.status === 'done' ? '↺' : '✓'),
    ])) : el('div', { class: 'empty' }, 'No deadlines.'),
  );

  // Access control: admins and the responsible attorney can set who sees this matter.
  const canManage = state.me && (state.me.role === 'admin' || state.me.name === m.responsibleAttorney);
  let accessCard = null;
  if (canManage) {
    const users = await api.get('/users');
    const acl = new Set(m.access || []);
    const rows = users.map((u) => {
      const auto = u.name === m.responsibleAttorney || u.role === 'admin';
      const cb = el('input', { type: 'checkbox' }); cb.checked = auto || acl.has(u.id); cb.disabled = auto ? '' : null;
      cb.addEventListener('change', async () => {
        const next = new Set(m.access || []);
        if (cb.checked) next.add(u.id); else next.delete(u.id);
        try { await api.patch('/matters/' + id, { access: [...next] }); m.access = [...next]; toast('Access updated.'); }
        catch (e) { toast('Error: ' + e.message); cb.checked = !cb.checked; }
      });
      return el('label', { class: 'access-row' }, cb, ` ${u.name} `, el('span', { class: 'muted', style: 'font-size:12px' }, auto ? `(${u.role === 'admin' ? 'admin — always' : 'responsible — always'})` : u.title || u.role));
    });
    accessCard = el('div', { class: 'card grow' }, el('h3', {}, 'Who can access this matter'),
      el('p', { class: 'muted', style: 'font-size:12px' }, 'Admins and the responsible attorney always have access. Tick others to grant it.'),
      ...rows);
  }

  return el('div', {}, back, header,
    el('div', { class: 'row', style: 'margin-top:16px' }, docs, events),
    accessCard ? el('div', { class: 'row', style: 'margin-top:16px' }, accessCard) : null);
}

views.drafting = async () => {
  const status = await api.get('/ai/status');
  const matters = await api.get('/matters');
  const tmplOpts = Object.entries(status.templates).map(([k, v]) => el('option', { value: k }, v));
  const matterOpts = [el('option', { value: '' }, '— select matter —'), ...matters.map((m) => el('option', { value: m.id, selected: state.draftMatter === m.id ? '' : null }, `${m.reference || m.id} · ${m.title}`))];

  const out = el('pre', { class: 'doc', id: 'draft-out' }, 'Draft output appears here.');
  const matterSel = el('select', {}, ...matterOpts);
  const tmplSel = el('select', {}, ...tmplOpts);
  const instr = el('textarea', { rows: '4', placeholder: 'Special instructions (tone, key points, recipient, amounts)…' });
  const protect = el('input', { type: 'checkbox', checked: '' });
  const genBtn = el('button', { class: 'btn primary' }, 'Generate draft');

  genBtn.addEventListener('click', async () => {
    if (!matterSel.value) return toast('Pick a matter first.');
    genBtn.disabled = true; out.innerHTML = ''; out.append(el('span', { class: 'spinner' }), ' BonesAI is drafting…');
    try {
      const res = await api.post('/ai/draft', { matterId: matterSel.value, template: tmplSel.value, instructions: instr.value, protect: protect.checked });
      out.textContent = res.document.content;
      toast(`Draft saved to matter${res.usedAI ? '' : ' (offline template)'}${res.redactionCount ? ` · ${res.redactionCount} entities protected` : ''}`);
    } catch (e) { out.textContent = 'Error: ' + e.message; }
    genBtn.disabled = false;
  });

  const form = el('div', { class: 'card' },
    el('label', { class: 'field' }, el('span', {}, 'Matter'), matterSel),
    el('label', { class: 'field' }, el('span', {}, 'Document type'), tmplSel),
    el('label', { class: 'field' }, el('span', {}, 'Instructions'), instr),
    el('label', { class: 'protect-toggle', style: 'margin-bottom:8px' }, protect, ' 🛡 De-identify (redact) before sending to the model'),
    el('div', { class: 'btn-row' }, genBtn),
  );
  return el('div', {}, el('h2', {}, '✍️ AI Document Drafting'),
    el('p', { class: 'muted' }, 'The drafter agent uses matter context to produce a reviewable first draft. Generated drafts are saved to the matter file.'),
    el('div', { class: 'grid-2' }, form, el('div', { class: 'card' }, el('h3', {}, 'Output'), out)));
};

views.docket = async () => {
  const events = await api.get('/events');
  const matters = await api.get('/matters');
  const matterOpts = [el('option', { value: '' }, '— select matter —'), ...matters.map((m) => el('option', { value: m.id }, `${m.reference || m.id} · ${m.title}`))];
  const matterSel = el('select', {}, ...matterOpts);
  const text = el('textarea', { rows: '6', placeholder: 'Paste a court order, contract clause, or letter. The docket agent extracts dates & computes relative deadlines.' });
  const extractBtn = el('button', { class: 'btn primary' }, 'Extract deadlines');
  const extractOut = el('div', { id: 'extract-out' });

  extractBtn.addEventListener('click', async () => {
    if (!text.value.trim()) return toast('Paste some text first.');
    extractBtn.disabled = true; extractOut.innerHTML = ''; extractOut.append(el('span', { class: 'spinner' }), ' Extracting…');
    try {
      const res = await api.post('/ai/extract-deadlines', { matterId: matterSel.value || null, text: text.value, commit: !!matterSel.value });
      extractOut.innerHTML = '';
      extractOut.append(el('div', { class: 'muted', style: 'margin:8px 0' }, `${res.events.length} item(s)${res.committed ? ` · added to matter` : ' (no matter selected — preview only)'}${res.usedAI ? '' : ' (offline heuristics)'}`));
      extractOut.append(table(['Due', 'Item', 'Type', 'Rationale'], res.events.map((e) => [
        e.dueDate || '—', e.title, el('span', { class: `badge ${e.priority || 'normal'}` }, e.type), el('span', { class: 'muted', style: 'font-size:12px' }, e.rationale || ''),
      ])));
    } catch (e) { extractOut.textContent = 'Error: ' + e.message; }
    extractBtn.disabled = false;
  });

  const extractor = el('div', { class: 'card' },
    el('h3', {}, 'Docket extraction agent'),
    el('label', { class: 'field' }, el('span', {}, 'Add results to matter (optional)'), matterSel),
    el('label', { class: 'field' }, el('span', {}, 'Source text'), text),
    el('div', { class: 'btn-row' }, extractBtn), extractOut,
  );

  const today = new Date().toISOString().slice(0, 10);
  const calendar = el('div', { class: 'card' },
    el('h3', {}, 'All deadlines'),
    events.length ? table(['Due', 'Item', 'Matter', 'Type', 'Status'], events.map((e) => [
      dueCell(e.dueDate), el('span', { style: e.status === 'done' ? 'text-decoration:line-through;color:var(--muted)' : '' }, e.title),
      e.matter || '—', el('span', { class: `badge ${e.priority}` }, e.type),
      el('span', { class: 'badge ' + (e.status === 'done' ? 'closed' : e.dueDate < today ? 'overdue' : 'normal') }, e.status === 'done' ? 'done' : e.dueDate < today ? 'overdue' : 'pending'),
    ])) : el('div', { class: 'empty' }, 'No deadlines.'),
  );
  return el('div', {}, el('h2', {}, '📅 Docket & Deadlines'), el('div', { class: 'grid-2' }, extractor, calendar));
};

views.calendar = async () => {
  const events = await api.get('/events');
  const byDay = {};
  for (const e of events) { if (e.dueDate) (byDay[e.dueDate] = byDay[e.dueDate] || []).push(e); }

  if (!state.calMonth) state.calMonth = new Date(); // first of currently shown month tracked by year/mon
  const cur = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth(), 1);
  const monthName = cur.toLocaleString('en', { month: 'long', year: 'numeric' });
  const today = new Date().toISOString().slice(0, 10);

  const setMonth = (delta) => { state.calMonth = new Date(cur.getFullYear(), cur.getMonth() + delta, 1); render(); };

  const head = el('div', { class: 'section-head' },
    el('div', { class: 'cal-nav' },
      el('button', { class: 'btn', onclick: () => setMonth(-1) }, '‹'),
      el('h2', { style: 'margin:0;min-width:200px;text-align:center' }, monthName),
      el('button', { class: 'btn', onclick: () => setMonth(1) }, '›'),
      el('button', { class: 'btn', onclick: () => { state.calMonth = new Date(); render(); } }, 'Today')),
    el('a', { class: 'btn primary', href: '/api/events/export.ics', download: 'praixis-deadlines.ics' }, '📤 Export to calendar (.ics)'),
  );

  // grid: weekday headers + leading blanks + days
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const grid = el('div', { class: 'cal-grid' }, ...dow.map((d) => el('div', { class: 'cal-dow' }, d)));
  const firstDow = (cur.getDay() + 6) % 7; // Monday-start
  const daysInMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
  for (let i = 0; i < firstDow; i++) grid.append(el('div', { class: 'cal-cell empty' }));
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const evs = byDay[iso] || [];
    const cell = el('div', { class: 'cal-cell' + (iso === today ? ' is-today' : '') },
      el('div', { class: 'cal-date' }, String(d)),
      ...evs.slice(0, 4).map((e) => el('div', {
        class: `cal-event ${e.priority || 'normal'}` + (e.status === 'done' ? ' done' : iso < today ? ' overdue' : ''),
        title: `${e.title} — ${e.matter || ''}`,
        onclick: () => gotoMatter(e.matterId),
      }, e.title)),
      evs.length > 4 ? el('div', { class: 'muted', style: 'font-size:11px' }, `+${evs.length - 4} more`) : null,
    );
    grid.append(cell);
  }

  return el('div', {}, head,
    el('p', { class: 'muted' }, 'Deadlines and hearings across the matters you can access. The export drops them into Apple/Outlook/Google Calendar, each with a reminder the day before.'),
    el('div', { class: 'card' }, grid));
};

views.intake = async () => {
  const items = await api.get('/intake');
  const head = el('div', { class: 'section-head' }, el('h2', {}, '📨 Intake & Triage'),
    el('button', { class: 'btn', onclick: showNewIntake }, '+ Simulate inbound'));
  if (!items.length) return el('div', {}, head, el('div', { class: 'empty' }, 'No intake.'));
  const cards = items.map(renderIntakeCard);
  return el('div', {}, head, el('p', { class: 'muted' }, 'The intake agent classifies inbound messages, flags conflicts, suggests matter links, and drafts replies.'), ...cards);
};

function renderIntakeCard(item) {
  const body = el('div', { class: 'card' });
  body.append(
    el('div', { class: 'section-head' },
      el('div', {}, el('strong', {}, item.subject), el('div', { class: 'muted', style: 'font-size:13px' }, `From: ${item.fromName || item.from} <${item.from}> · ${item.receivedAt || ''}`)),
      el('span', { class: `badge ${item.status === 'new' ? 'warn pending' : item.status === 'converted' ? 'open' : 'normal'}` }, item.status)),
    el('p', { class: 'muted', style: 'white-space:pre-wrap' }, item.body),
  );
  const triageArea = el('div');
  body.append(triageArea);
  if (item.triage) renderTriage(triageArea, item);

  const actions = el('div', { class: 'btn-row' });
  if (item.status !== 'converted') {
    const tBtn = el('button', { class: 'btn primary' }, item.triage ? 'Re-triage' : '🦴 Triage with BonesAI');
    tBtn.addEventListener('click', async () => {
      tBtn.disabled = true; tBtn.innerHTML = ''; tBtn.append(el('span', { class: 'spinner' }), ' Triaging…');
      try { const res = await api.post(`/intake/${item.id}/triage`, {}); item.triage = res.triage; renderTriage(triageArea, item); toast(`Triaged: ${res.triage.category}${res.usedAI ? '' : ' (offline)'}`); }
      catch (e) { toast('Error: ' + e.message); }
      tBtn.disabled = false; tBtn.textContent = 'Re-triage';
    });
    actions.append(tBtn);
    if (item.triage && item.triage.category !== 'spam') {
      actions.append(el('button', { class: 'btn', onclick: () => convertIntake(item) }, '→ Open as matter'));
    }
  } else if (item.matterId) {
    actions.append(el('button', { class: 'btn', onclick: () => { state.view = 'matters'; state.matterId = item.matterId; setNav(); render(); } }, 'View matter →'));
  }
  body.append(actions);
  return body;
}

function renderTriage(container, item) {
  const t = item.triage; container.innerHTML = '';
  container.append(el('div', { class: 'card', style: 'background:var(--panel-2);margin-top:12px' },
    el('div', { class: 'row' },
      el('div', {}, el('span', { class: `badge normal` }, t.category), ' ', el('span', { class: `badge ${t.urgency}` }, t.urgency + ' urgency'),
        t.conflictFlag ? el('span', { class: 'badge high', style: 'margin-left:6px' }, '⚠ CONFLICT') : null),
    ),
    t.practiceArea ? el('div', { style: 'margin-top:6px' }, el('strong', {}, 'Practice area: '), t.practiceArea) : null,
    t.summary ? el('div', { style: 'margin-top:4px' }, el('strong', {}, 'Summary: '), t.summary) : null,
    t.conflictNote ? el('div', { class: 'muted', style: 'margin-top:4px' }, '⚠ ' + t.conflictNote) : null,
    t.draftReply ? el('details', { style: 'margin-top:8px' }, el('summary', { style: 'cursor:pointer' }, 'Draft reply'), el('pre', { class: 'doc', style: 'margin-top:8px' }, t.draftReply)) : null,
  ));
}

views.conflicts = async () => {
  const names = el('textarea', { rows: '4', placeholder: 'Prospective client and adverse party names — one per line.\ne.g.\nMeridian Property Holdings\nJohn Carter' });
  const runBtn = el('button', { class: 'btn primary' }, 'Run conflict check');
  const out = el('div', { id: 'conflict-out' });

  runBtn.addEventListener('click', async () => {
    const list = names.value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!list.length) return toast('Enter at least one name.');
    runBtn.disabled = true; out.innerHTML = ''; out.append(el('span', { class: 'spinner' }), ' Checking the firm index…');
    try {
      const res = await api.post('/conflicts/check', { names: list });
      out.innerHTML = '';
      out.append(renderConflictReport(res));
    } catch (e) { out.textContent = 'Error: ' + e.message; }
    runBtn.disabled = false;
  });

  const form = el('div', { class: 'card' },
    el('h3', {}, 'New-business conflict check'),
    el('p', { class: 'muted', style: 'font-size:13px' }, 'Sweeps every client and matter party across the whole firm. A clash inside a matter you can’t access is confirmed but its details are withheld — escalate to the responsible attorney.'),
    el('label', { class: 'field' }, el('span', {}, 'Names to vet'), names),
    el('div', { class: 'btn-row' }, runBtn), out,
  );
  return el('div', {}, el('h2', {}, '⚔️ Conflict Check'), el('div', { class: 'grid-2' }, form, el('div', { class: 'card' }, el('h3', {}, 'How it works'),
    el('p', { class: 'muted', style: 'font-size:13px;line-height:1.6' }, 'Enter the prospective client plus any opposing parties. Praixis flags where a name already appears — as an existing client (acting against them may be a conflict) or as a party in a live matter. Strong matches are exact/contained names; possible matches share a distinctive name part and warrant a human look.'))));
};

function renderConflictReport(res) {
  if (res.clear) {
    return el('div', { class: 'card', style: 'background:var(--panel-2);border-color:var(--accent-dim);margin-top:12px' },
      el('div', { style: 'font-size:15px;color:var(--ok);font-weight:600' }, '✓ No conflicts found'),
      el('div', { class: 'muted', style: 'font-size:13px;margin-top:4px' }, `Checked ${res.query.length} name(s) against the firm index.`));
  }
  const rows = res.matches.map((m) => {
    const strongBadge = el('span', { class: `badge ${m.strength === 'strong' ? 'high' : 'warn'}` }, m.strength);
    const where = m.restricted
      ? el('span', { class: 'muted' }, `in a restricted matter — escalate to ${m.responsible || 'a partner'}`)
      : el('span', {}, m.kind === 'client' ? 'existing client' : `party [${m.role || 'party'}]`, m.matterRef ? el('span', { class: 'muted' }, ` · ${m.matterRef}${m.matterTitle ? ' — ' + m.matterTitle : ''}`) : null);
    return [el('strong', {}, m.against), el('span', { class: 'muted' }, `matched “${m.query}”`), strongBadge, where];
  });
  return el('div', { style: 'margin-top:12px' },
    el('div', { class: 'card', style: 'background:var(--panel-2);border-color:var(--danger)' },
      el('div', { style: 'font-size:15px;color:var(--danger);font-weight:600' }, `⚠ ${res.matches.length} potential conflict(s)`),
      el('div', { class: 'muted', style: 'font-size:13px;margin-top:4px' }, 'Review before opening the matter.')),
    table(['Name on file', 'Matched', 'Strength', 'Appears as'], rows));
}

views.time = async () => {
  const [st, cfg, matters] = await Promise.all([api.get('/watcher/status'), api.get('/watcher/config'), api.get('/matters')]);

  // Connection card
  const urlInput = el('input', { value: cfg.url || '', placeholder: 'http://localhost:4400' });
  const connDot = el('span', { class: 'badge ' + (st.connected ? 'open' : st.configured ? 'high' : 'low') },
    st.connected ? `connected · ${st.service || 'thewatcher'} ${st.version || ''}` : st.configured ? `unreachable (${st.error || '—'})` : 'not configured');
  const connCard = el('div', { class: 'card' },
    el('div', { class: 'section-head' }, el('h3', { style: 'margin:0' }, 'TheWatcher connection'), connDot),
    el('p', { class: 'muted', style: 'font-size:13px' }, 'TheWatcher is an independent timekeeper. Praixis drives timers and pulls entries over its API. When it’s offline, Praixis falls back to local time entries.'),
    el('div', { class: 'row', style: 'align-items:flex-end' },
      el('label', { class: 'field grow', style: 'margin:0' }, el('span', {}, 'TheWatcher URL'), urlInput),
      el('button', { class: 'btn primary', onclick: async () => { await api.post('/watcher/config', { url: urlInput.value }); toast('Saved. Reconnecting…'); render(); } }, 'Save & connect')),
  );

  // Start-timer card (only useful when connected)
  const matterSel = el('select', {}, el('option', { value: '' }, '— no matter (free-form) —'), ...matters.map((m) => el('option', { value: m.id }, `${m.reference || m.id} · ${m.title}`)));
  const desc = el('input', { placeholder: 'What are you working on?' });
  const att = el('input', { placeholder: 'Attorney' });
  const rate = el('input', { type: 'number', placeholder: 'Rate/hr', style: 'max-width:120px' });
  const startBtn = el('button', { class: 'btn primary', disabled: st.connected ? null : '' }, '▶ Start timer');
  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    try { await api.post('/watcher/timers/start', { matterId: matterSel.value, description: desc.value, attorney: att.value, rate: Number(rate.value) || 0 }); desc.value = ''; toast('Timer started.'); render(); }
    catch (e) { toast('Error: ' + e.message); startBtn.disabled = false; }
  });
  const startCard = el('div', { class: 'card' },
    el('h3', {}, 'Start a timer'),
    st.connected ? null : el('p', { class: 'muted' }, 'Connect TheWatcher above to start timers.'),
    el('label', { class: 'field' }, el('span', {}, 'Matter'), matterSel),
    el('label', { class: 'field' }, el('span', {}, 'Description'), desc),
    el('div', { class: 'row' }, el('label', { class: 'field grow' }, el('span', {}, 'Attorney'), att), el('label', { class: 'field' }, el('span', {}, 'Rate'), rate)),
    el('div', { class: 'btn-row' }, startBtn),
  );

  const running = el('div', { class: 'card', id: 'running-timers' });
  const entriesCard = el('div', { class: 'card', id: 'time-entries' });
  const refresh = async () => { await renderRunningTimers(running); await renderTimeEntries(entriesCard); };
  await refresh();
  // Live tick while on this view: update running timers + entries every 5s.
  if (st.connected) state._tick = setInterval(() => { tickElapsed(); }, 1000), state._poll = setInterval(refresh, 5000);

  return el('div', {}, el('h2', {}, '⏱️ Time & Billing'),
    el('div', { class: 'grid-2' }, connCard, startCard),
    running, entriesCard);
};

function fmtElapsed(s) { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`; }
function tickElapsed() { document.querySelectorAll('[data-started]').forEach((n) => { const s = (Date.now() - new Date(n.dataset.started)) / 1000; n.textContent = fmtElapsed(s); }); }

async function renderRunningTimers(card) {
  const res = await api.get('/watcher/timers').catch(() => ({ connected: false, timers: [] }));
  card.innerHTML = '';
  card.append(el('h3', {}, `Running timers (${res.timers?.length || 0})`));
  if (!res.connected) { card.append(el('div', { class: 'empty' }, 'TheWatcher not connected.')); return; }
  if (!res.timers.length) { card.append(el('div', { class: 'empty' }, 'No timers running.')); return; }
  card.append(table(['Elapsed', 'Matter / label', 'Attorney', 'Description', ''], res.timers.map((t) => [
    el('span', { 'data-started': t.startedAt, style: 'font-family:monospace;color:var(--accent)' }, fmtElapsed(t.elapsedSeconds)),
    t.matterRef ? `${t.matterRef} · ${t.label}` : t.label, t.attorney || '—', t.description || '—',
    el('button', { class: 'btn danger', onclick: async () => { try { const out = await api.post(`/watcher/timers/${t.id}/stop`, {}); toast(`Logged ${out.entry?.minutes || 0} min.`); render(); } catch (e) { toast('Error: ' + e.message); } } }, '■ Stop'),
  ])));
}

async function renderTimeEntries(card) {
  const res = await api.get('/watcher/entries').catch(() => ({ source: 'local', entries: [] }));
  const matters = {}; (await api.get('/matters')).forEach((m) => (matters[m.id] = m.reference || m.title));
  card.innerHTML = '';
  let totalMin = 0, totalAmt = 0;
  for (const e of res.entries) { totalMin += e.minutes || 0; totalAmt += ((e.minutes || 0) / 60) * (e.rate || 0); }
  card.append(el('div', { class: 'section-head' }, el('h3', { style: 'margin:0' }, 'Time entries'),
    el('span', { class: 'muted', style: 'font-size:13px' }, `source: ${res.source}${res.watcherError ? ` (TheWatcher: ${res.watcherError})` : ''}`)));
  if (!res.entries.length) { card.append(el('div', { class: 'empty' }, 'No time entries yet.')); return; }
  card.append(table(['Date', 'Matter', 'Attorney', 'Description', 'Min', 'Rate', 'Amount'], res.entries.map((e) => [
    (e.endedAt || e.date || '').slice(0, 10) || '—', matters[e.matterId] || e.matterRef || '—', e.attorney || '—', e.description || '—',
    String(e.minutes || 0), e.rate ? '$' + e.rate : '—', e.rate ? '$' + (((e.minutes || 0) / 60) * e.rate).toFixed(2) : '—',
  ])));
  card.append(el('div', { style: 'text-align:right;margin-top:10px;font-weight:600' }, `Total: ${(totalMin / 60).toFixed(2)} h${totalAmt ? ` · $${totalAmt.toFixed(2)}` : ''}`));
}

views.activity = async () => {
  const log = await api.get('/activity');
  return el('div', {}, el('h2', {}, '🕘 Activity Log'),
    el('div', { class: 'card' }, log.length ? table(['Time', 'Actor', 'Action', 'Detail'], log.map((a) => [
      el('span', { class: 'muted', style: 'font-size:12px' }, (a.ts || '').replace('T', ' ').slice(0, 16)), a.actor || 'system', a.action, a.detail || '',
    ])) : el('div', { class: 'empty' }, 'No activity.')));
};

views.settings = async () => {
  const { settings: s, ai } = await api.get('/settings');
  const me = await api.get('/me').catch(() => null);

  const firmName = el('input', { value: s.firmName || '', placeholder: 'Firm name' });
  const firmEmail = el('input', { value: s.firmEmail || '', placeholder: 'Contact email' });
  const firmPhone = el('input', { value: s.firmPhone || '', placeholder: 'Phone' });
  const firmAddress = el('textarea', { rows: '2', placeholder: 'Address (used on letterhead)' }); firmAddress.value = s.firmAddress || '';

  const modelSel = el('select', {}, el('option', { value: '' }, 'Server default'),
    ...Object.entries(ai.models || {}).map(([k, v]) => el('option', { value: k, selected: s.defaultModel === k ? '' : null }, `${k} · ${v}`)));
  const protect = el('input', { type: 'checkbox' }); protect.checked = s.defaultProtect !== false;
  const watcher = el('input', { value: s.thewatcherUrl || '', placeholder: 'http://localhost:4400' });
  // Billing defaults
  const currency = el('select', {}, ...['USD', 'GBP', 'EUR', 'AUD', 'CAD'].map((c) => el('option', { value: c, selected: s.billingCurrency === c ? '' : null }, c)));
  const defRate = el('input', { type: 'number', value: s.billingDefaultRate || 0 });
  const invPrefix = el('input', { value: s.invoicePrefix || 'INV-' });
  const invNext = el('input', { type: 'number', value: s.invoiceNextNumber || 1001 });

  const isAdmin = me && me.role === 'admin';

  const save = el('button', { class: 'btn primary' }, 'Save settings');
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await api.post('/settings', {
        firmName: firmName.value, firmEmail: firmEmail.value, firmPhone: firmPhone.value, firmAddress: firmAddress.value,
        defaultModel: modelSel.value, defaultProtect: protect.checked, thewatcherUrl: watcher.value,
        billingCurrency: currency.value, billingDefaultRate: Number(defRate.value) || 0,
        invoicePrefix: invPrefix.value, invoiceNextNumber: Number(invNext.value) || 1001,
      });
      await loadSettings();
      toast('Settings saved.');
    } catch (e) { toast('Error: ' + e.message); }
    save.disabled = false;
  });

  const firmCard = el('div', { class: 'card' }, el('h3', {}, 'Firm profile'),
    el('p', { class: 'muted', style: 'font-size:13px' }, 'Identifies your firm; will feed document letterhead and invoices.'),
    el('label', { class: 'field' }, el('span', {}, 'Firm name'), firmName),
    el('div', { class: 'grid-2' }, el('label', { class: 'field' }, el('span', {}, 'Email'), firmEmail), el('label', { class: 'field' }, el('span', {}, 'Phone'), firmPhone)),
    el('label', { class: 'field' }, el('span', {}, 'Address'), firmAddress));

  const aiCard = el('div', { class: 'card' }, el('h3', {}, 'AI / BonesAI engine'),
    el('div', { style: 'margin-bottom:8px' }, 'Status: ', el('span', { class: 'badge ' + (ai.available ? 'open' : 'high') }, ai.available ? 'online' : 'offline (set ANTHROPIC_API_KEY)')),
    el('label', { class: 'field' }, el('span', {}, 'Default model'), modelSel),
    el('label', { class: 'protect-toggle', style: 'margin-top:8px' }, protect, ' 🛡 De-identify by default (Protect on)'));

  const billingCard = el('div', { class: 'card' }, el('h3', {}, 'Billing defaults'),
    el('div', { class: 'grid-2' }, el('label', { class: 'field' }, el('span', {}, 'Currency'), currency), el('label', { class: 'field' }, el('span', {}, 'Default rate / hr'), defRate)),
    el('div', { class: 'grid-2' }, el('label', { class: 'field' }, el('span', {}, 'Invoice prefix'), invPrefix), el('label', { class: 'field' }, el('span', {}, 'Next invoice #'), invNext)));

  const intCard = el('div', { class: 'card' }, el('h3', {}, 'Integrations'),
    el('label', { class: 'field' }, el('span', {}, 'TheWatcher URL (timekeeper)'), watcher),
    el('p', { class: 'muted', style: 'font-size:12px' }, 'Shared with the Time tab. Leave blank to run on local time entries.'));

  const acctCard = el('div', { class: 'card' }, el('h3', {}, 'Account'),
    el('div', {}, 'Acting as: ', el('strong', {}, me ? `${me.name} (${me.role})` : '—')),
    el('p', { class: 'muted', style: 'font-size:12px' }, isAdmin ? 'You are an administrator — you can manage users and firm data below.' : 'Switch users from the header. User management is admin-only.'));

  const cards = [firmCard, aiCard, billingCard, intCard, acctCard];
  if (isAdmin) cards.push(await usersCard(me), dataCard());

  return el('div', {}, el('h2', {}, '⚙️ Settings'),
    el('div', { class: 'btn-row', style: 'margin-bottom:12px' }, save),
    el('div', { class: 'settings-grid' }, ...cards));
};

async function usersCard(me) {
  const users = await api.get('/users');
  const ROLES = ['admin', 'attorney', 'staff'];
  const rows = users.map((u) => [
    el('div', {}, el('strong', {}, u.name), el('div', { class: 'muted', style: 'font-size:12px' }, `${u.title || ''} ${u.email ? '· ' + u.email : ''}`)),
    (() => { const sel = el('select', {}, ...ROLES.map((r) => el('option', { value: r, selected: u.role === r ? '' : null }, r)));
      sel.addEventListener('change', async () => { try { await api.patch('/users/' + u.id, { role: sel.value }); toast('Role updated.'); } catch (e) { toast('Error: ' + e.message); } }); return sel; })(),
    el('button', { class: 'btn danger', onclick: async () => { if (u.id === me.id) return toast('You cannot delete yourself.'); if (!confirm(`Remove ${u.name}?`)) return; try { await api.del('/users/' + u.id); toast('User removed.'); render(); } catch (e) { toast('Error: ' + e.message); } } }, '🗑'),
  ]);
  const nName = el('input', { placeholder: 'Full name' });
  const nRole = el('select', {}, ...ROLES.map((r) => el('option', { value: r }, r)));
  const nTitle = el('input', { placeholder: 'Title' });
  const nEmail = el('input', { placeholder: 'Email' });
  const add = el('button', { class: 'btn primary' }, '+ Add user');
  add.addEventListener('click', async () => {
    if (!nName.value.trim()) return toast('Name required.');
    try { await api.post('/users', { name: nName.value, role: nRole.value, title: nTitle.value, email: nEmail.value }); toast('User added.'); render(); }
    catch (e) { toast('Error: ' + e.message); }
  });
  return el('div', { class: 'card', style: 'grid-column:1/-1' }, el('h3', {}, 'User management'),
    el('p', { class: 'muted', style: 'font-size:13px' }, 'Firm staff and their roles. Admins see every matter; attorneys/staff see only matters they’re on (set access on each matter’s page).'),
    table(['Name', 'Role', ''], rows),
    el('div', { class: 'row', style: 'margin-top:12px;align-items:flex-end;flex-wrap:wrap' },
      el('label', { class: 'field', style: 'margin:0' }, el('span', {}, 'Name'), nName),
      el('label', { class: 'field', style: 'margin:0' }, el('span', {}, 'Role'), nRole),
      el('label', { class: 'field', style: 'margin:0' }, el('span', {}, 'Title'), nTitle),
      el('label', { class: 'field', style: 'margin:0' }, el('span', {}, 'Email'), nEmail),
      add));
}

function dataCard() {
  const file = el('input', { type: 'file', accept: 'application/json', style: 'display:none' });
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    if (!confirm('Restore will REPLACE all current data with the backup. Continue?')) { file.value = ''; return; }
    try { const snapshot = JSON.parse(await f.text()); await api.post('/restore', { snapshot }); toast('Backup restored.'); render(); }
    catch (e) { toast('Restore failed: ' + e.message); }
    file.value = '';
  });
  return el('div', { class: 'card', style: 'grid-column:1/-1' }, el('h3', {}, 'Data — backup & reset'),
    el('p', { class: 'muted', style: 'font-size:13px' }, 'Download a full snapshot, restore from one, or reset the demo. Resets and restores replace everything — there is no undo.'),
    el('div', { class: 'btn-row' },
      el('a', { class: 'btn primary', href: '/api/backup', download: '' }, '⬇ Export backup'),
      el('button', { class: 'btn', onclick: () => file.click() }, '⬆ Restore from file'),
      el('button', { class: 'btn', onclick: async () => { if (!confirm('Reset to fresh demo data? This wipes current data.')) return; await api.post('/reset', { mode: 'seed' }); toast('Reset to demo data.'); render(); } }, '↻ Reset to demo'),
      el('button', { class: 'btn danger', onclick: async () => { if (!confirm('Erase ALL data to an empty firm? This cannot be undone.')) return; await api.post('/reset', { mode: 'empty' }); toast('All data erased.'); render(); } }, '⚠ Erase all'),
      file));
}

// --- shared UI helpers ------------------------------------------------------
function table(headers, rows) {
  const thead = el('thead', {}, el('tr', {}, ...headers.map((h) => el('th', {}, h))));
  const tbody = el('tbody', {}, ...rows.map((r) => {
    const cells = Array.isArray(r) ? r : r.cells;
    const tr = el('tr', r.onclick ? { class: 'clickable', onclick: r.onclick } : {}, ...cells.map((c) => el('td', {}, c)));
    return tr;
  }));
  return el('table', {}, thead, tbody);
}
function dueCell(d) {
  if (!d) return el('span', { class: 'muted' }, '—');
  const today = new Date().toISOString().slice(0, 10);
  const overdue = d < today;
  return el('span', { class: overdue ? 'badge overdue' : '' }, d);
}

function showDoc(d) {
  modal(d.name, el('pre', { class: 'doc' }, d.content || '(no text)'));
}
async function extractFromDoc(docId, matterId) {
  toast('Extracting deadlines…');
  try { const res = await api.post('/ai/extract-deadlines', { documentId: docId, matterId, commit: true }); toast(`Added ${res.committed} deadline(s) to matter.`); render(); }
  catch (e) { toast('Error: ' + e.message); }
}
async function convertIntake(item) {
  const title = prompt('Matter title:', item.triage?.summary || item.subject);
  if (!title) return;
  try { const res = await api.post(`/intake/${item.id}/convert`, { title, practiceArea: item.triage?.practiceArea }); toast('Matter opened: ' + res.matter.reference); state.view = 'matters'; state.matterId = res.matter.id; setNav(); render(); }
  catch (e) { toast('Error: ' + e.message); }
}

// --- modals -----------------------------------------------------------------
function modal(title, content) {
  const overlay = el('div', { style: 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:200;display:flex;align-items:center;justify-content:center;padding:24px' });
  const box = el('div', { class: 'card', style: 'max-width:720px;width:100%;max-height:85vh;overflow:auto' },
    el('div', { class: 'section-head' }, el('h2', { style: 'margin:0' }, title), el('button', { class: 'icon-btn', onclick: () => overlay.remove() }, '✕')),
    content);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.append(box); document.body.append(overlay);
  return overlay;
}

async function showNewMatter() {
  const clients = await api.get('/clients');
  const title = el('input', { placeholder: 'Matter title' });
  const ref = el('input', { placeholder: 'Reference (optional)' });
  const area = el('input', { placeholder: 'Practice area' });
  const att = el('input', { placeholder: 'Responsible attorney' });
  const desc = el('textarea', { rows: '3', placeholder: 'Description' });

  // Every matter must belong to a client: either pick an existing one, or fill
  // in a proper new client record. No free-floating "client name" shortcut.
  const clientSel = el('select', {}, el('option', { value: '' }, '— select a client —'), ...clients.map((c) => el('option', { value: c.id }, `${c.name} (${c.type})`)));
  const ncName = el('input', { placeholder: 'Client full name' });
  const ncType = el('select', {}, el('option', { value: 'individual' }, 'Individual'), el('option', { value: 'organization' }, 'Organization'));
  const ncEmail = el('input', { placeholder: 'Email' });
  const ncPhone = el('input', { placeholder: 'Phone' });
  const ncAddr = el('input', { placeholder: 'Address' });

  const existingBlock = el('label', { class: 'field' }, el('span', {}, 'Existing client'), clientSel);
  const newBlock = el('div', { class: 'card', style: 'background:var(--panel-2);padding:12px' },
    el('label', { class: 'field' }, el('span', {}, 'Client name *'), ncName),
    el('div', { class: 'grid-2' }, el('label', { class: 'field' }, el('span', {}, 'Type'), ncType), el('label', { class: 'field' }, el('span', {}, 'Email'), ncEmail)),
    el('div', { class: 'grid-2' }, el('label', { class: 'field' }, el('span', {}, 'Phone'), ncPhone), el('label', { class: 'field' }, el('span', {}, 'Address'), ncAddr)));

  const mode = el('select', {},
    el('option', { value: 'existing' }, 'Use an existing client'),
    el('option', { value: 'new' }, 'Create a new client'));
  const applyMode = () => { const isNew = mode.value === 'new'; newBlock.style.display = isNew ? '' : 'none'; existingBlock.style.display = isNew ? 'none' : ''; };
  mode.addEventListener('change', applyMode);
  if (!clients.length) mode.value = 'new'; // nothing to pick yet → force creation

  const overlay = modal('New matter', el('div', {},
    el('label', { class: 'field' }, el('span', {}, 'Title *'), title),
    el('div', { class: 'grid-2' }, el('label', { class: 'field' }, el('span', {}, 'Reference'), ref), el('label', { class: 'field' }, el('span', {}, 'Practice area'), area)),
    el('label', { class: 'field' }, el('span', {}, 'Client *'), mode),
    existingBlock, newBlock,
    el('label', { class: 'field' }, el('span', {}, 'Attorney'), att),
    el('label', { class: 'field' }, el('span', {}, 'Description'), desc),
    el('div', { class: 'btn-row' }, el('button', {
      class: 'btn primary', onclick: async () => {
        if (!title.value.trim()) return toast('Matter title is required.');
        let clientId;
        try {
          if (mode.value === 'new') {
            if (!ncName.value.trim()) return toast('A new client needs a name.');
            const c = await api.post('/clients', { name: ncName.value.trim(), type: ncType.value, email: ncEmail.value.trim(), phone: ncPhone.value.trim(), address: ncAddr.value.trim() });
            clientId = c.id;
          } else {
            if (!clientSel.value) return toast('Select a client, or switch to “Create a new client”.');
            clientId = clientSel.value;
          }
          const m = await api.post('/matters', { title: title.value, reference: ref.value, practiceArea: area.value, responsibleAttorney: att.value, clientId, description: desc.value });
          overlay.remove(); toast('Matter created.'); state.view = 'matters'; state.matterId = m.id; render();
        } catch (e) { toast('Error: ' + e.message); }
      },
    }, 'Create matter'))));
  applyMode();
}

function showNewIntake() {
  const from = el('input', { placeholder: 'sender@example.com' });
  const subject = el('input', { placeholder: 'Subject' });
  const bodyT = el('textarea', { rows: '5', placeholder: 'Message body' });
  const overlay = modal('Simulate inbound message', el('div', {},
    el('label', { class: 'field' }, el('span', {}, 'From'), from),
    el('label', { class: 'field' }, el('span', {}, 'Subject'), subject),
    el('label', { class: 'field' }, el('span', {}, 'Body'), bodyT),
    el('div', { class: 'btn-row' }, el('button', {
      class: 'btn primary', onclick: async () => {
        if (!from.value || !subject.value) return toast('From and subject required.');
        await api.post('/intake', { from: from.value, subject: subject.value, body: bodyT.value });
        overlay.remove(); toast('Inbound added.'); render();
      },
    }, 'Add'))));
}

// --- assistant (BonesAI chat) ----------------------------------------------
const assistant = $('#assistant');
function openAssistant() { assistant.classList.remove('assistant-closed'); $('#chat-input').focus(); }
function closeAssistant() { assistant.classList.add('assistant-closed'); }
function setAssistantContext(matter) {
  state.assistantMatter = matter ? matter.id : null;
  $('#assistant-ctx').textContent = matter ? `Matter: ${matter.title}` : 'No matter in context';
}
function addChatMsg(role, text) {
  const log = $('#chat-log');
  const node = el('div', { class: 'msg ' + role }, text);
  log.append(node); log.scrollTop = log.scrollHeight;
  return node;
}
async function sendChat(e) {
  e.preventDefault();
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addChatMsg('user', text);
  state.chat.push({ role: 'user', content: text });
  const protect = $('#protect-toggle').checked;
  const node = addChatMsg('assistant', '');
  node.append(el('span', { class: 'spinner' }));

  try {
    const resp = await fetch('/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ matterId: state.assistantMatter, messages: state.chat, protect, model: state.settings?.defaultModel || undefined }) });
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '', acc = '', first = true;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const ev = /event: (.*)/.exec(chunk); const dl = /data: (.*)/s.exec(chunk);
        if (!dl) continue;
        const data = JSON.parse(dl[1]);
        const type = ev ? ev[1] : 'token';
        if (type === 'token') { if (first) { node.innerHTML = ''; first = false; } acc += data; node.textContent = acc; $('#chat-log').scrollTop = 1e9; }
        else if (type === 'error') { node.textContent = '⚠ ' + data.message; }
        else if (type === 'done') { state.chat.push({ role: 'assistant', content: acc }); if (data.redactionCount) node.append(el('div', { class: 'muted', style: 'font-size:11px;margin-top:6px' }, `🛡 ${data.redactionCount} entities de-identified in transit`)); }
      }
    }
  } catch (err) { node.textContent = '⚠ ' + err.message; }
}

// --- shell ------------------------------------------------------------------
function setNav() {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  $('#crumb').textContent = { dashboard: 'Dashboard', matters: 'Matters', drafting: 'Drafting', docket: 'Docket & Deadlines', calendar: 'Calendar', intake: 'Intake', conflicts: 'Conflict Check', time: 'Time & Billing', activity: 'Activity', settings: 'Settings' }[state.view] || state.view;
}
async function render() {
  if (state._tick) { clearInterval(state._tick); state._tick = null; }
  if (state._poll) { clearInterval(state._poll); state._poll = null; }
  setNav();
  const host = $('#view');
  host.innerHTML = '';
  host.append(el('div', { class: 'muted' }, el('span', { class: 'spinner' }), ' Loading…'));
  try {
    const node = await views[state.view]();
    host.innerHTML = ''; host.append(node);
  } catch (e) { host.innerHTML = ''; host.append(el('div', { class: 'empty' }, 'Error: ' + e.message)); }
}

// --- acting user (stand-in for login) --------------------------------------
async function initUserSwitch() {
  const sel = $('#user-switch');
  try {
    const [users, me] = await Promise.all([api.get('/users'), api.get('/me')]);
    state.me = me;
    sel.innerHTML = '';
    for (const u of users) sel.append(el('option', { value: u.id, selected: me && u.id === me.id ? '' : null }, `${u.name} · ${u.title || u.role}`));
    sel.onchange = async () => {
      await api.post('/session', { userId: sel.value });
      state.me = users.find((u) => u.id === sel.value) || state.me;
      state.matterId = null; setAssistantContext(null); state.chat = [];
      const name = sel.options[sel.selectedIndex].textContent.split(' · ')[0];
      toast(`Now acting as ${name}`);
      render();
    };
  } catch (_) { sel.style.display = 'none'; }
}

// --- settings (loaded once; supplies UI defaults) --------------------------
async function loadSettings() {
  try {
    const { settings } = await api.get('/settings');
    state.settings = settings;
    const pt = $('#protect-toggle');
    if (pt) pt.checked = settings.defaultProtect !== false;
  } catch (_) { state.settings = {}; }
}

// --- global search ----------------------------------------------------------
function initSearch() {
  const input = $('#global-search');
  const box = $('#search-results');
  const hide = () => box.classList.remove('show');
  let t = null;
  input.addEventListener('input', () => {
    clearTimeout(t);
    const q = input.value.trim();
    if (!q) return hide();
    t = setTimeout(async () => {
      try {
        const { results } = await api.get('/search?q=' + encodeURIComponent(q));
        box.innerHTML = '';
        if (!results.length) { box.append(el('div', { class: 'search-empty' }, 'No matches.')); }
        else for (const r of results) {
          box.append(el('div', { class: 'search-row', onclick: () => { hide(); input.value = ''; gotoMatter(r.matterId); } },
            el('div', { class: 'sr-label' }, el('span', { class: 'sr-type' }, r.type), r.label),
            el('div', { class: 'sr-sub' }, r.sub || '')));
        }
        box.classList.add('show');
      } catch (e) { box.innerHTML = ''; box.append(el('div', { class: 'search-empty' }, 'Error: ' + e.message)); box.classList.add('show'); }
    }, 180);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; hide(); } });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search-wrap')) hide(); });
}
function gotoMatter(id) {
  if (!id) return;
  state.view = 'matters'; state.matterId = id; setNav(); render();
}

async function init() {
  document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; if (b.dataset.view !== 'matters') state.matterId = null; render(); }));
  $('#ask-bones').addEventListener('click', openAssistant);
  $('#assistant-close').addEventListener('click', closeAssistant);
  $('#chat-form').addEventListener('submit', sendChat);
  $('#chat-input').addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') sendChat(e); });
  initSearch();
  await initUserSwitch();
  await loadSettings();

  try {
    const s = await api.get('/ai/status');
    state.aiAvailable = s.available;
    if (s.version) { const bv = $('#brand-version'); if (bv) bv.textContent = `v${s.version} · beta`; }
    const pill = $('#engine-pill');
    pill.textContent = s.available ? 'BonesAI: online' : 'BonesAI: offline';
    pill.classList.add(s.available ? 'online' : 'offline');
    addChatMsg('system', s.available ? 'BonesAI engine online. Ask me about a matter.' : 'BonesAI offline — set ANTHROPIC_API_KEY for live answers. Demo replies are stubbed.');
  } catch (_) {}
  render();
}
init();
