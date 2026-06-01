// Matter-level access control — the spine that search and the AI tools gate on.
//
// Prototype stance: there is no login yet (that's a later "Accounts" phase), so
// the "acting" user is whoever is selected in the header, stored as a single
// setting. The rules here are deliberately the only place that decides who can
// see a matter, so search, the dashboard, and every agent share one definition.

const db = require('./db');

// The user currently acting. Falls back to an admin (or the first user) so the
// app is never locked out; if no users exist at all, returns null = "open".
function currentUser() {
  const id = db.getSetting('currentUserId', null);
  const byId = id && db.get('users', id);
  if (byId) return byId;
  const users = db.all('users');
  return users.find((u) => u.role === 'admin') || users[0] || null;
}

// Can `user` see `matter`? Admins see everything; everyone else needs to be on
// the matter's access list or be its responsible attorney. No users configured
// at all → open (keeps the prototype usable before any seeding).
function canSeeMatter(user, matter) {
  if (db.all('users').length === 0) return true;
  if (!user || !matter) return false;
  if (user.role === 'admin') return true;
  if (Array.isArray(matter.access) && matter.access.includes(user.id)) return true;
  if (matter.responsibleAttorney && user.name && matter.responsibleAttorney === user.name) return true;
  return false;
}

function visibleMatters(user) {
  return db.where('matters', (m) => canSeeMatter(user, m));
}

// Set of matter ids the user may see — handy for filtering child collections.
function visibleMatterIdSet(user) {
  return new Set(visibleMatters(user).map((m) => m.id));
}

module.exports = { currentUser, canSeeMatter, visibleMatters, visibleMatterIdSet };
