# Praixis — Functional Specification

**Product:** Praixis — AI agentic practice-management suite for law firms
**Repository:** `winigee/praxais` (the product/repo spelling mismatch is intentional)
**Version at time of writing:** v0.10.0 (BETA)
**Date:** 2 August 2026
**Companions:** `CLAUDE.md` (project memory) · `ROADMAP.md` (build sequence) ·
`INTEGRATION.md` (TheWatcher contract) · the CSWICS spec (north-star target)

---

## 1. Purpose & scope

This document specifies what Praixis **does today** and what it **will do**, at
the level of functional behaviour (features, users, workflows, data) rather than
implementation. It is the bridge between the working prototype and the CSWICS
platform vision.

Status legend, used throughout:

- **✅ Built** — implemented and working in v0.10.0.
- **🟡 Partial** — a working slice exists; material gaps remain.
- **⬜ Planned** — specified here, not yet built (see `ROADMAP.md` for stage).

## 2. Product overview

Praixis is a matter-centric practice-management suite with an embedded AI layer
(the **BonesAI engine**). Matters are the backbone; clients, documents, events,
notes and time all hang off a matter. A privacy round-trip de-identifies
confidential material before it reaches the AI model and re-identifies replies
locally. Today it runs as a single zero-dependency Node web app; it is being
re-founded as a multi-firm SaaS (see §11, §12 and `ROADMAP.md`).

**Design tenets**
1. Matter-centric — confidentiality is decided in one place and honoured
   everywhere (search, dashboard, agents).
2. Privacy by default — real client/party names need not leave the building.
3. AI proposes; humans decide — agents draft, extract and triage; they do not
   take irreversible action.
4. Works offline — with no AI key, every feature falls back to a deterministic
   result so the app is always demonstrable.
5. Tenant-isolated — every firm's data is walled off at the data layer (v0.10.0).

## 3. Users & roles

### 3.1 Roles (✅ Built)
| Role | Capability |
|---|---|
| **admin** (partner) | Sees every matter in the firm; manages users, settings, data backup/restore. |
| **attorney** | Sees matters they are responsible for or explicitly granted. |
| **staff** (e.g. paralegal) | Sees only matters they are explicitly granted. |

The **acting user** is currently chosen in the header (a stand-in for login).
Firm-level (tenant) context is resolved per request.

### 3.2 Planned roles (⬜)
Client-portal users; finance/cashier; compliance (COLP/COFA/MLRO/DPO);
marketing/BD; HR; auditor; external counsel — per the CSWICS actor model, gated
by the permission model in §11.

## 4. Functional requirements by area

### 4.1 Dashboard / "My Briefing"
- **FR-DSH-1 ✅** Show counts scoped to the acting user: matters, open matters,
  clients, documents, new intake, overdue and due-this-week deadlines.
- **FR-DSH-2 ✅** List upcoming deadlines (next 8) and recent activity (last 12),
  filtered to visible matters.
- **FR-DSH-3 ✅** Show AI engine availability (online/offline).
- **FR-DSH-4 ⬜** Full "My Briefing": waiting approvals, unanswered client
  communications, WIP/billing actions, relationship follow-ups, "changes since
  yesterday", agent runs needing attention. *(Roadmap Stage 5.)*

### 4.2 Matters
- **FR-MAT-1 ✅** Create a matter (must be linked to an existing client); list,
  view, edit, delete (delete cascades to child records).
- **FR-MAT-2 ✅** Matter fields: title, reference, client, practice area, status,
  responsible attorney, description, parties (name/role/type), tags, access list.
- **FR-MAT-3 ✅** Matter detail aggregates client, documents, events, notes and
  time entries.
- **FR-MAT-4 ✅** Per-matter access editor (grant/revoke staff).
- **FR-MAT-5 🟡** Matter as a rich record: jurisdiction/governing law, security
  classification/barriers, scope/assumptions/exclusions, pricing/budget, work
  plan/milestones/dependencies, issues/facts/evidence/chronology, commitments/
  undertakings, health/stage. *(Currently basic fields only; Roadmap Stage 5.)*

### 4.3 Clients
- **FR-CLI-1 ✅** Create and list clients (individual or organization) with
  contact details.
- **FR-CLI-2 🟡** A client is surfaced in search only via a matter the user can
  see. *(No standalone Client 360 view yet.)*
- **FR-CLI-3 ⬜** CRM depth: organisations/groups/ownership, contacts with
  multiple roles, relationships, aliases/former names, consent/preferences,
  referrers, relationship team, client-specific terms & billing rules,
  duplicate detection, full change history. *(Roadmap Stage 7.)*

### 4.4 Documents & DMS
- **FR-DOC-1 ✅** Upload/create documents against a matter (name, type, tags,
  text content); list by matter; view.
- **FR-DOC-2 ✅** AI-drafted documents are saved back as matter documents with
  provenance tags (`ai-drafted`).
- **FR-DOC-3 ⬜** Immutable versioning + content hashes; document states
  (Captured→Draft→In Review→Approved→Issued→Signed→Filed→Superseded→Disposed).
- **FR-DOC-4 ⬜** Email/MIME ingestion & filing (Outlook/M365), threads, dedup.
- **FR-DOC-5 ⬜** Metadata model, privilege/sensitivity labels, redaction/
  anonymisation, retention + legal hold, secure external sharing, defensible
  export. *(Roadmap Stage 3.)*

### 4.5 Search ("Ask the firm")
- **FR-SRCH-1 ✅** Global keyword search across matters, clients, documents,
  notes and events, **security-trimmed** to matters the acting user may see.
- **FR-SRCH-2 ✅** A client is not revealed unless attached to a visible matter.
- **FR-SRCH-3 ⬜** Semantic/vector + hybrid search, citations to exact version/
  passage, "why did this match", entity/graph/version-aware search, "search only
  within this matter" scope. *(Roadmap Stage 3.)*

### 4.6 Calendar & deadlines
- **FR-CAL-1 ✅** Events (deadline/hearing/filing/task) with due date, priority,
  status, source; list per matter or firm-wide (access-scoped); edit/delete.
- **FR-CAL-2 ✅** Calendar view of deadlines.
- **FR-CAL-3 ✅** iCalendar (`.ics`) export of visible deadlines with a
  day-before reminder (Apple/Outlook/Google importable).
- **FR-CAL-4 ⬜** Rule-based date computation with jurisdiction rules; critical
  dates require a source and explicit confirmation status. *(Roadmap Stage 5.)*

### 4.7 Time & billing
- **FR-TIME-1 ✅** Manual time entries (matter, attorney, minutes, rate,
  description, date); list per matter or firm-wide.
- **FR-TIME-2 ✅** TheWatcher integration: start/stop timers, list live timers &
  entries, receive push via webhook, mirror entries locally so billing survives
  if the timekeeper is offline. Falls back to local entries when disconnected.
- **FR-TIME-3 ✅** Billing defaults in settings (currency, default rate, invoice
  prefix & next number).
- **FR-TIME-4 ⬜** Invoicing UI, pre-bills, WIP, collections, and the
  deterministic double-entry legal ledger + client-money controls.
  *(Roadmap Stage 6; integrate a proven legal-accounts system first.)*

### 4.8 Intake (new business)
- **FR-INT-1 ✅** Inbound enquiries list; create enquiries (from/subject/body).
- **FR-INT-2 ✅** AI triage: category (new-enquiry/existing-matter/spam/admin),
  practice area, one-line summary, urgency, suggested matching matter, and a
  draft reply. Runs with a deterministic fallback offline.
- **FR-INT-3 ✅** Real firm-wide **conflict sweep** during triage (see §4.9),
  overriding the model's guess; result flagged on the triage card.
- **FR-INT-4 ✅** Convert a triaged enquiry into a new client + matter.
- **FR-INT-5 ⬜** Concierge; enquiry quarantine before conflict clearance;
  KYC/AML/sanctions/PEP/beneficial-ownership; scope & pricing; engagement +
  e-signature; onboarding automation; client portal. *(Roadmap Stage 4.)*

### 4.9 Conflicts
- **FR-CNF-1 ✅** `check(names)` — vet prospective names against the firm index
  (all clients + every matter party), with strong/possible match strength.
- **FR-CNF-2 ✅** `scanText(text)` — surface known firm names mentioned in free
  text (used by intake), ignoring over-generic tokens.
- **FR-CNF-3 ✅** Access-aware results: a clash inside a matter the user cannot
  see returns as **restricted** (conflict confirmed, details withheld, escalate
  to the responsible attorney/partner) — confidentiality preserved.
- **FR-CNF-4 ⬜** Full conflict engine: former clients, counterparties,
  witnesses, experts, funders, affiliates, directors, aliases; barriers &
  waivers; lateral-hire declarations. *(Roadmap Stage 4.)*

### 4.10 AI agents (BonesAI engine)
- **FR-AI-1 ✅ Drafter** — generates first drafts from matter context across 8
  templates (engagement letter, demand letter, client update, memo, discovery
  request, settlement proposal, NDA, motion outline). Never invents citations;
  appends "⚠ Review notes". Saved as a matter document.
- **FR-AI-2 ✅ Docket/deadline extraction** — extracts dates, deadlines,
  hearings and filing obligations from pasted text; computes relative dates
  ("within 30 days of service") from a reference date; commits them as events.
- **FR-AI-3 ✅ Intake triage** — see §4.8.
- **FR-AI-4 ✅ Matter assistant** — streamed (SSE) matter-aware chat: answers,
  summarises, drafts snippets, suggests next steps; refuses matters the user
  can't see; flags items needing human verification.
- **FR-AI-5 ✅** Every agent runs offline with a deterministic stub and records
  what it did to the activity log.
- **FR-AI-6 ⬜** The wider agent estate (persistent Matter/Client agents,
  functional squads) and the agent control plane — identity, delegation, tool
  gateway with risk classes, autonomy levels L0–L5, approval centre, model
  gateway, evaluations, kill switch. *(Roadmap Stages 2 & 5.)*

### 4.11 Privacy / "Protect" (BonesAI privacy invariant)
- **FR-PRV-1 ✅** With Protect on, client/party names, phone numbers and known
  entities are replaced with stable tokens (e.g. `[PERSON_1]`) **before** any
  text is sent to the AI model; replies are re-identified **locally**. The
  replacement map is in-memory only and never persisted.
- **FR-PRV-2 ✅** Applies to drafting, intake triage and the assistant chat
  round-trip; a redaction preview endpoint exists.
- **FR-PRV-3 ✅** Protect default is a per-firm setting.
- **FR-PRV-4 ⬜** Model gateway hardening: provider-neutral routing, no-training
  guarantees, region pinning, classification-based routing. *(Roadmap Stage 2.)*

### 4.12 Activity / audit
- **FR-ACT-1 ✅** Append-only activity log of agent and user actions; last 100
  via API, access-scoped on the dashboard.
- **FR-ACT-2 ⬜** Immutable, tamper-evident audit of 100% of state-changing
  actions and all reads of sealed data, with full actor/delegation chain.
  *(Roadmap Stage 1.)*

### 4.13 Settings & administration
- **FR-SET-1 ✅** Firm profile (name/address/email/phone); AI defaults (model +
  Protect); TheWatcher URL; billing defaults — all per firm (tenant).
- **FR-SET-2 ✅** User management (admin): add, edit role, delete staff; last
  admin and self-delete protected; removing a user strips them from matter ACLs.
- **FR-SET-3 ✅** Data backup (export snapshot), restore, and reset/reseed/erase
  (admin). *(Whole-database today; becomes per-tenant before a second firm —
  see §12.)*
- **FR-SET-4 ✅** Masthead shows `BETA · v<version>`; version & changelog served
  from the API.

### 4.14 Integrations
- **FR-INTG-1 ✅ TheWatcher** (independent timekeeper) — full client of its v1
  HTTP API; degrades gracefully to local time entries when offline.
- **FR-INTG-2 ⬜** Microsoft 365/Graph (email, calendar, Outlook & Word add-ins);
  IDV/KYC, sanctions/PEP, company data, e-signature, open-banking feeds, OCR,
  malware scanning, legal research. *(Roadmap Stages 3–6; see `ROADMAP.md` §Infra.)*

## 5. Core workflows (as built)

1. **Open a matter** — create/select client → create matter → creator granted
   access → appears on dashboard and in search for authorised users. ✅
2. **Intake → matter** — enquiry arrives → AI triage + conflict sweep → review →
   convert to client + matter. ✅
3. **Draft a document** — pick matter + template + instructions → (Protect
   redacts) → AI draft → saved as a matter document with review notes. ✅
4. **Extract deadlines** — paste text (e.g. a court letter) → agent extracts &
   computes dates → committed to the calendar → exportable as `.ics`. ✅
5. **Ask the assistant** — open a matter → chat → streamed, matter-grounded
   answers with the privacy round-trip. ✅
6. **Capture time** — start/stop a TheWatcher timer or add a manual entry →
   mirrored locally for billing. ✅

Planned end-to-end workflows (enquiry-to-matter with KYC/engagement,
draft-to-issue with approval states, time-to-cash, client-money, matter closing
& knowledge capture) are specified in the CSWICS spec and sequenced in
`ROADMAP.md`.

## 6. Data model

### 6.1 Collections (✅ Built)
`tenants` (firms) · `users` · `clients` · `matters` · `documents` · `events` ·
`intake` · `timeEntries` · `notes` · `activity`. Every business record carries a
`tenantId`; ids are globally unique; per-firm settings live in a tenant-scoped
settings bag.

### 6.2 Key relationships
Client 1—* Matters; Matter 1—* {Documents, Events, Notes, TimeEntries}; Matter
*—* Users (access list + responsible attorney); Intake → (converts to) Client +
Matter. Everything is owned by exactly one Tenant.

### 6.3 Planned entities (⬜)
Profiles/auth, roles, permission policies, information barriers, delegations,
agent definitions/runs, tool calls, approvals; conflict checks/decisions, KYC
cases, engagements, pricing; matter parties/stages/plans/milestones,
commitments/undertakings, issues, assertions, chronology; document versions,
email/attachment/thread, templates/clauses, external shares, retention/legal
hold, export packages; the full finance ledger; CRM/BD and risk/compliance
entities. *(Per CSWICS §21; introduced across Roadmap Stages 1–7.)*

## 7. External interfaces

- **REST + SSE API** under `/api` (✅). Representative: `/api/state`,
  `/api/matters`, `/api/documents`, `/api/events`, `/api/search`,
  `/api/conflicts/check`, `/api/intake/*`, `/api/ai/*` (draft, extract-deadlines,
  chat, redact-preview), `/api/watcher/*`, `/api/settings`, `/api/users`,
  `/api/backup|restore|reset`, `/api/version`.
- **Tenant selector header** `x-praixis-tenant` (✅, forward-looking) — resolves
  the acting firm; otherwise the configured/only tenant.
- **Single-page web UI** (✅) with views: Dashboard, Matters, Drafting, Docket,
  Calendar, Intake, Conflicts, Time, Activity, Settings.
- **Planned (⬜):** versioned OpenAPI, CloudEvents event bus, idempotency keys,
  webhooks, MCP domain servers. *(Roadmap Stages 1–2.)*

## 8. Non-functional requirements

- **NFR-1 Offline capability ✅** — full deterministic behaviour with no AI key.
- **NFR-2 Zero runtime dependencies ✅** — pure Node built-ins + vanilla JS.
- **NFR-3 Tenant isolation ✅ (app-level)** — see §11; hardens to DB-level RLS in
  Roadmap Stage 1.
- **NFR-4 Confidentiality ✅** — matter-level access gates search, dashboard,
  conflicts and agents uniformly.
- **NFR-5 ⬜ Availability/durability, search & authorisation latency targets,
  access-revocation within 60s, WCAG 2.2 AA, UK/EU data residency, encryption &
  key management, per-tenant cost budgets, DR/business continuity.** *(CSWICS
  §22; Roadmap Stage 1 onward.)*

## 9. Assumptions & constraints

- Single Node process, JSON-on-disk store — prototype-grade concurrency.
- No real authentication yet — the acting user is a header selector.
- Drafting/docket take pasted text; no PDF/DOCX ingest yet.
- Intake is simulated; no live mailbox yet.
- Conflict checking is a heuristic index sweep, not a full conflicts engine.
- AI features require `ANTHROPIC_API_KEY`; otherwise deterministic stubs.

## 10. Known limitations (intentional for the prototype)

As §9, plus: whole-database backup/restore (not yet per-tenant); no invoicing/
ledger; no client portal; no durable workflow engine or approval centre. These
are deliberate prototype boundaries, not defects, and are addressed in
`ROADMAP.md`.

## 11. Security & permissions model

- **✅ Built:** matter-level access (admin sees all in-firm; others need to be on
  the access list or be the responsible attorney), enforced as the single gate
  for matters, search, dashboard, conflicts and agents. Tenant boundary in the
  store (§12).
- **⬜ Planned (CSWICS §11):** the four gates (visibility/use/action/disclosure);
  ReBAC+RBAC+ABAC; information barriers & sealed domains; capability tokens for
  agent tools; permission re-evaluation at query/fetch/display/action time;
  "why can I see this / why denied" explanations. *(Roadmap Stages 1–2.)*

## 12. Multi-tenancy (SaaS foundation)

- **✅ Built (v0.10.0):** every firm is a `tenant`; all business rows carry a
  `tenantId`; the data store scopes all reads/writes to the acting firm by
  default; cross-tenant/system access must be explicit. Firm settings and the
  acting user are per-tenant. Existing databases auto-migrate into one tenant.
- **⬜ Planned:** enforce the same boundary at the database with Postgres
  Row-Level Security (Supabase); real auth with tenant-scoped identities;
  per-tenant object storage, backup/export and cost budgets. *(Roadmap Stage 1;
  reference schema + RLS in `ROADMAP.md` Appendix B.)*

## 13. Traceability

Each ✅/🟡/⬜ item maps to the CSWICS spec sections and to `ROADMAP.md` stages.
Built items realise the CSWICS "Phase 1 vertical slice" (matters, DMS-lite,
permission-aware search, L0/L1 agents). Planned items follow the roadmap:
Stage 1 substrate & identity → Stage 2 permission/agent core → Stage 3 DMS →
Stage 4 intake lifecycle → Stage 5 delivery → Stage 6 finance → Stage 7
marketing/BD/risk → Stage 8 bounded autonomy.
