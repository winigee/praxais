// Conflict-of-interest checking — a real sweep over the whole firm's client and
// party index, replacing the old heuristic flag in intake.
//
// Two entry points:
//   check(names, user)    — vet explicit prospective names (new-business check)
//   scanText(text, user)  — surface known names mentioned in free text (intake)
//
// Both are firm-wide (a conflict you can't see is still a conflict), but they
// honour matter-level access: a clash inside a matter the acting user can't see
// comes back as "restricted" — conflict confirmed, details withheld, escalate.

const db = require('./db');
const access = require('./access');

const SUFFIXES = /\b(ltd|limited|inc|incorporated|llc|llp|plc|corp|corporation|co|company|gmbh|ag|sa|bv|nv|pty|group|holdings)\b/gi;
// Tokens too generic to be a reliable mention on their own.
const GENERIC = new Set(['property', 'holdings', 'group', 'partners', 'associates', 'solutions', 'services',
  'legal', 'company', 'components', 'systems', 'technologies', 'industries', 'enterprises', 'estate',
  'agents', 'dept', 'claims', 'department', 'the', 'and']);

function norm(s) {
  return String(s || '').toLowerCase().replace(/[.,&'"\/-]/g, ' ').replace(SUFFIXES, ' ').replace(/\s+/g, ' ').trim();
}
function tokens(s) { return norm(s).split(' ').filter((t) => t.length >= 3); }

// Strength of match between two names, or null.
function nameMatch(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return null;
  if (na === nb) return 'strong';
  if (na.includes(nb) || nb.includes(na)) return 'strong';
  const ta = new Set(tokens(a)), tb = tokens(b);
  const shared = [...tb].filter((t) => ta.has(t));
  if (shared.length >= 2) return 'strong';
  if (shared.some((t) => t.length >= 5)) return 'possible';
  return null;
}

// Build the searchable index: existing clients + every matter party.
function buildIndex() {
  const idx = [];
  for (const c of db.all('clients')) {
    idx.push({ name: c.name, email: c.email, kind: 'client', matterIds: db.where('matters', (m) => m.clientId === c.id).map((m) => m.id) });
  }
  for (const m of db.all('matters')) {
    for (const p of (m.parties || [])) idx.push({ name: p.name, kind: 'party', role: p.role, matterIds: [m.id] });
  }
  return idx;
}

// Turn an index entry + matter into an access-aware result row.
function row(query, entry, mid, strength, user) {
  const m = mid && db.get('matters', mid);
  const visible = m ? access.canSeeMatter(user, m) : true;
  return {
    query, against: entry.name, kind: entry.kind, role: entry.role || null, strength,
    matterId: mid || null,
    matterRef: visible ? (m && m.reference) || null : null,
    matterTitle: visible ? (m && m.title) || null : null,
    responsible: (m && m.responsibleAttorney) || null,
    restricted: m ? !visible : false,
  };
}

function dedupe(rows) {
  const seen = new Set();
  return rows.filter((r) => { const k = `${r.against}|${r.matterId}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// Vet a list of prospective names against the firm index.
function check(names, user) {
  const idx = buildIndex();
  const list = (Array.isArray(names) ? names : [names]).map((n) => String(n || '').trim()).filter(Boolean);
  const matches = [];
  for (const q of list) {
    for (const entry of idx) {
      const strength = nameMatch(q, entry.name) || (entry.email ? nameMatch(q, entry.email) : null);
      if (!strength) continue;
      const ids = entry.matterIds.length ? entry.matterIds : [null];
      for (const mid of ids) matches.push(row(q, entry, mid, strength, user));
    }
  }
  const out = dedupe(matches);
  return { query: list, clear: out.length === 0, matches: out };
}

// Find known firm names mentioned anywhere in free text (used on intake).
function scanText(text, user) {
  const nt = norm(text);
  if (!nt) return { clear: true, matches: [] };
  const idx = buildIndex();
  const matches = [];
  for (const entry of idx) {
    const distinctive = tokens(entry.name).filter((t) => t.length >= 4 && !GENERIC.has(t));
    if (!distinctive.length || !distinctive.some((t) => nt.includes(t))) continue;
    const ids = entry.matterIds.length ? entry.matterIds : [null];
    for (const mid of ids) matches.push(row(entry.name, entry, mid, 'possible', user));
  }
  const out = dedupe(matches);
  return { clear: out.length === 0, matches: out };
}

// One-line summary for the intake triage card.
function summarize(matches) {
  if (!matches.length) return '';
  return matches.slice(0, 4).map((m) => {
    if (m.restricted) return `possible conflict in a restricted matter — escalate to ${m.responsible || 'a partner'}`;
    const who = m.kind === 'client' ? 'an existing client' : `a party [${m.role || 'party'}]`;
    return `"${m.against}" is ${who}${m.matterRef ? ` in ${m.matterRef}` : ''}`;
  }).join('; ');
}

module.exports = { check, scanText, summarize };
