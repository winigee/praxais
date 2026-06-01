# Changelog

All notable changes to Praixis. The app is **BETA**; the version shown in the
masthead is the `version` in `package.json`. Bump it on every build.

## 0.9.0
- Versioning: app masthead now shows **BETA** and the build version; version is
  exposed via the API and this CHANGELOG tracks each build.

## 0.8.0
- Settings: user management (admin) — add/edit-role/delete firm staff, with a
  per-matter access editor on the matter page.
- Settings: billing defaults (currency, default rate, invoice numbering).
- Settings: data backup / restore / reset (export snapshot, restore, reseed, erase).

## 0.7.0
- Settings tab: firm profile, AI defaults (model + Protect), TheWatcher URL.

## 0.6.0
- Calendar view of deadlines + one-click `.ics` export (with a day-before reminder).
- A matter must be linked to a client (new-client creation enforced).

## 0.5.0
- Real conflict-of-interest checking (firm-wide sweep), access-aware; replaces
  the intake heuristic flag. New Conflicts tab.

## 0.4.0
- Matter-level access control (`server/access.js`) + an "acting as" user switcher.
- Permission-aware global search across matters, clients, documents, notes, deadlines.

## 0.3.0
- Praixis tab icon / favicon (the "Ascend" mark); replaces the placeholder emoji.

## 0.2.0
- Delete a matter, with cascade cleanup of its documents, deadlines, notes, time entries.

## 0.1.0
- Initial build: matters, AI drafting, docket extraction, intake triage, streaming
  assistant, activity log, and the TheWatcher timekeeper integration.
