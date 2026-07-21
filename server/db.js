// JSON-file backed data store. Zero dependencies, in the spirit of BonesAI's
// "JSON on disk for everything". The whole database is one object held in
// memory and flushed to data/db.json on every write. Fine for a prototype;
// swap for SQLite/Postgres when this needs concurrency.
//
// Multi-tenancy: this is built to become a platform many firms subscribe to, so
// the store enforces a HARD tenant boundary. Every tenant-scoped read/write runs
// inside a tenant context (see `withTenant`), and `all/get/where` only ever
// return rows belonging to that tenant. This is the software equivalent of
// Postgres row-level security — the isolation lives in the store, not in each
// call site, so a feature built later cannot accidentally read across firms.
// Cross-tenant/system work must opt in explicitly via `asPlatform`.

const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const COLLECTIONS = [
  'tenants',    // subscribing firms — the top of the isolation tree (NOT tenant-scoped)
  'users',      // firm staff + their role (basis for matter-level access)
  'clients',
  'matters',
  'documents',
  'events',     // deadlines, hearings, tasks
  'intake',     // inbound email / new-business enquiries
  'timeEntries',
  'notes',      // matter notes / "brain"
  'activity',   // audit log of agent + user actions
];

// Collections whose every row belongs to exactly one firm. `tenants` is the
// registry itself and is deliberately NOT in this set.
const TENANT_SCOPED = new Set(COLLECTIONS.filter((c) => c !== 'tenants'));

// The active tenant for the current async call-chain. A string tenant id means
// "scope everything to this firm"; the PLATFORM sentinel means "system/cross-
// tenant work, no filtering"; undefined (e.g. at startup) behaves like platform.
const tenantCtx = new AsyncLocalStorage();
const PLATFORM = Symbol('platform');

function currentTenant() { return tenantCtx.getStore(); }
// Run `fn` scoped to one firm. All db calls inside see only that firm's rows.
function withTenant(tenantId, fn) { return tenantCtx.run(tenantId, fn); }
// Run `fn` with the tenant boundary lifted — for migrations, the tenant
// registry, and whole-database admin tools. Use sparingly and deliberately.
function asPlatform(fn) { return tenantCtx.run(PLATFORM, fn); }
function scoped() { return typeof currentTenant() === 'string'; }

let db = null;

function emptyDb() {
  const out = { _meta: { createdAt: new Date().toISOString(), seq: {}, settings: {}, tenantSettings: {} } };
  for (const c of COLLECTIONS) out[c] = [];
  return out;
}

function load() {
  if (db) return db;
  try {
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      for (const c of COLLECTIONS) if (!Array.isArray(db[c])) db[c] = [];
      if (!db._meta) db._meta = {};
      if (!db._meta.seq) db._meta.seq = {};
      if (!db._meta.settings) db._meta.settings = {};
      if (!db._meta.tenantSettings) db._meta.tenantSettings = {};
      return db;
    }
  } catch (e) {
    console.error('[db] failed to read, starting fresh:', e.message);
  }
  db = emptyDb();
  return db;
}

// One-time backfill for databases created before multi-tenancy: fold every
// existing row into a single "legacy" tenant and move firm settings into that
// tenant's bag, so an in-place upgrade keeps working and becomes isolated.
let migrated = false;
function migrate() {
  load();
  if (migrated) return;
  migrated = true;
  const hasBusinessRows = [...TENANT_SCOPED].some((c) => (db[c] || []).length > 0);
  if (db.tenants.length === 0 && hasBusinessRows) {
    const now = new Date().toISOString();
    const tid = nextId('ten');
    const name = (db._meta.settings && db._meta.settings.firmName) || 'Your Firm';
    db.tenants.push({ id: tid, name, plan: 'legacy', createdAt: now, updatedAt: now });
    for (const c of TENANT_SCOPED) for (const row of db[c]) if (row.tenantId == null) row.tenantId = tid;
    // Existing global settings become this firm's settings; only platform-level
    // keys stay global.
    const old = db._meta.settings || {};
    db._meta.tenantSettings[tid] = { ...old };
    delete db._meta.tenantSettings[tid].currentTenantId;
    db._meta.settings = { currentTenantId: tid };
    console.log(`[db] migrated existing data into tenant ${tid} (${name}).`);
    scheduleFlush();
  }
}

let flushTimer = null;
function flush() {
  if (!db) return;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
// Debounced flush so a burst of writes hits disk once.
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 50);
}

// Raw id minter (no scoping). Ids are globally unique across tenants so a value
// can never collide with, or be guessed from, another firm's sequence.
function nextId(prefix) {
  const seq = (db._meta.seq[prefix] || 0) + 1;
  db._meta.seq[prefix] = seq;
  return `${prefix}_${String(seq).padStart(4, '0')}`;
}
function id(prefix) { load(); return nextId(prefix); }

function all(collection) {
  load();
  const rows = db[collection] || [];
  if (!TENANT_SCOPED.has(collection)) return rows;
  const t = currentTenant();
  // Platform / no-context (startup, migrations, admin tools) sees everything;
  // every ordinary request runs inside withTenant, so it is filtered.
  if (typeof t !== 'string') return rows;
  return rows.filter((r) => r.tenantId === t);
}

function get(collection, recordId) {
  return all(collection).find((r) => r.id === recordId) || null;
}

function where(collection, predicate) {
  return all(collection).filter(predicate);
}

function insert(collection, record) {
  load();
  const now = new Date().toISOString();
  const recordId = record.id || nextId(collection.slice(0, 3));
  const row = { createdAt: now, updatedAt: now, ...record, id: recordId };
  // Stamp the owning firm from context. Platform/system inserts may set (or
  // omit) tenantId deliberately; request inserts are always stamped.
  if (TENANT_SCOPED.has(collection) && scoped() && row.tenantId == null) row.tenantId = currentTenant();
  db[collection].push(row);
  scheduleFlush();
  return row;
}

function update(collection, recordId, patch) {
  load();
  const row = get(collection, recordId); // tenant-scoped: can't reach another firm's row
  if (!row) return null;
  const clean = { ...patch };
  delete clean.id; delete clean.tenantId; // identity + ownership are never patchable
  Object.assign(row, clean, { updatedAt: new Date().toISOString() });
  scheduleFlush();
  return row;
}

function remove(collection, recordId) {
  load();
  if (TENANT_SCOPED.has(collection) && !get(collection, recordId)) return false; // not ours → no-op
  const before = db[collection].length;
  db[collection] = db[collection].filter((r) => r.id !== recordId);
  scheduleFlush();
  return db[collection].length < before;
}

// Append-only activity / audit log. Used by agents to record what they did.
function logActivity(entry) {
  return insert('activity', { ts: new Date().toISOString(), ...entry });
}

// Settings bag. Tenant-scoped by default (firm profile, acting user, TheWatcher
// URL, billing prefs all belong to one firm); platform-level keys use the
// *Platform helpers. Outside a request (startup) this reads the platform bag.
function bagFor(write) {
  load();
  const t = currentTenant();
  if (typeof t === 'string') {
    if (!db._meta.tenantSettings[t]) db._meta.tenantSettings[t] = {};
    return db._meta.tenantSettings[t];
  }
  return db._meta.settings;
}
function getSetting(key, def = null) { const b = bagFor(false); return key in b ? b[key] : def; }
function setSetting(key, val) { bagFor(true)[key] = val; scheduleFlush(); return val; }

// Platform-wide settings (e.g. which tenant the app is acting as — a stand-in
// for auth/subdomain routing until real login lands).
function getPlatformSetting(key, def = null) { load(); return key in db._meta.settings ? db._meta.settings[key] : def; }
function setPlatformSetting(key, val) { load(); db._meta.settings[key] = val; scheduleFlush(); return val; }

function reset() {
  db = emptyDb();
  migrated = true; // a fresh db needs no migration
  flush();
  return db;
}

// Whole-database snapshot, for backup/export. Platform-level (all tenants).
function exportDb() { load(); return db; }

// Replace the whole database from a snapshot (restore). Normalises shape so a
// partial/old backup can't corrupt the store.
function importDb(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('invalid backup');
  const meta = obj._meta && typeof obj._meta === 'object' ? obj._meta : {};
  if (!meta.seq) meta.seq = {};
  if (!meta.settings) meta.settings = {};
  if (!meta.tenantSettings) meta.tenantSettings = {};
  const next = { _meta: meta };
  for (const c of COLLECTIONS) next[c] = Array.isArray(obj[c]) ? obj[c] : [];
  db = next;
  migrated = false; // re-run backfill in case an old snapshot predates tenancy
  flush();
  migrate();
  return db;
}

module.exports = {
  COLLECTIONS, TENANT_SCOPED, DATA_DIR, DB_FILE, PLATFORM,
  load, migrate, flush, reset, id, exportDb, importDb,
  all, get, where, insert, update, remove, logActivity,
  getSetting, setSetting, getPlatformSetting, setPlatformSetting,
  withTenant, asPlatform, currentTenant,
};
