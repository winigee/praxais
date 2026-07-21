# Praixis → CSWICS platform roadmap

> Standing build plan for turning Praixis (today: a Phase-1 prototype on a
> zero-dependency Node substrate) into the multi-firm SaaS described in the
> CSWICS spec. Companion to `HANDOFF.md` and `CLAUDE.md`.
>
> **Guiding rule (from the spec, now enforceable): build the trust foundation
> before broad agents.** Praixis was built in the opposite order — a rich
> experience on a disposable substrate — so this plan re-founds onto a real
> multi-tenant substrate, then layers the missing domains in dependency order,
> gating each on isolation + audit.

## Where we are (v0.10.0)

- Matters/clients/documents/events/notes/time as a working prototype.
- Matter-level access control, permission-aware search, four agents (drafter,
  docket, intake, assistant), BonesAI privacy round-trip, TheWatcher time.
- **Tenant boundary shipped in-app (v0.10.0):** every firm is a `tenant`, every
  business row carries `tenantId`, and the JSON store scopes all reads/writes to
  the acting firm (cross-tenant access must opt in via `asPlatform`). This is the
  in-memory twin of the database RLS we add in Stage 1 — it makes that migration
  mechanical and stops any feature being built tenant-blind in the meantime.

Sizing is relative effort: **S / M / L / XL**.

---

## Stage 0 — Tenant boundary ✅ (done, in-app)
Re-asserted at the database layer in Stage 1 (Supabase RLS) so even a buggy
query cannot cross firms.

## Stage 1 — Real substrate + identity — **XL, do first**
The spec's "Phase 0." Nothing touching real client data stays on the JSON store
once real firms are on it. *(Concrete checklist + schema in Appendix A/B.)*
- Postgres (Supabase) with `tenant_id` on every table + **Row-Level Security**.
- Real login (Supabase Auth / OIDC + MFA); users belong to a tenant.
- Object storage for document binaries with immutable versions (Supabase Storage
  or Cloudflare R2).
- Immutable audit log (append-only) — 100% of state-changing actions.
- Central authorization service — harden `access.js` into the one policy
  decision point (matter membership, roles, first information barriers).
- *Isolation gate:* every table ships with an RLS test proving cross-tenant
  denial before it is used.

## Stage 2 — Permission & agent-governance core — **L**
The gate that decides what agents may *do*, before they do anything beyond propose.
- The four gates: visibility / use / action / disclosure.
- Information barriers + sealed domains (AML/SAR, HR, board — excluded from
  search & briefings).
- Agent identity + delegation context + tool gateway with risk classes;
  autonomy levels L0–L5.
- Approval service / Approval Centre (human-in-the-loop for reversible-external+).
- Model gateway — provider-neutral, no-training-on-tenant-data, region-pinned.
  (BonesAI redaction is a head start.)

## Stage 3 — DMS depth — **XL ("unforgiving")**
- Immutable versioning + content hashes + document states (Captured→…→Disposed).
- Email/MIME ingestion & filing with threads and dedup — **Microsoft 365 /
  Outlook** integration.
- Metadata, privilege/sensitivity labels, redaction.
- Retention + legal hold (hold overrides disposal).
- Secure external sharing (expiring, recipient-bound, watermark).
- Search upgrade: semantic/vector (`pgvector`) + hybrid, security-trimmed,
  citations to exact version/passage.

## Stage 4 — Intake → matter lifecycle — **L, integration-heavy**
- Concierge + enquiry quarantine (before conflict clearance).
- Conflicts hardened into a real index sweep with restricted reviewer summaries.
- KYC/AML: entity resolution, beneficial ownership, sanctions/PEP, source of
  funds/wealth — via bought-in providers.
- Scope & pricing → engagement terms + e-signature → onboarding → client portal.

## Stage 5 — Matter delivery operations — **L**
- Persistent Matter Agent state: chronology, issue tree, evidence map,
  commitment/deadline registers, fact/assertion store with provenance.
- Draft→issue workflow with distinct states; meeting & correspondence agents;
  time capture; budget/status reporting.
- Closing & knowledge capture → experience bank + precedents/playbooks.

## Stage 6 — Time, billing, legal accounting — **XL, highest-risk**
- Rates/WIP/budgets → pre-bills/invoices → collections.
- Deterministic double-entry ledger, client/office money, bank feeds +
  reconciliation, client-money controls (dual approval, separation of duties).
- Finance agents *propose only*; deterministic code posts.
- ⚠️ **Integrate a proven legal-accounts system first.** A native client-money
  ledger goes live only after specialist design, independent accounting review,
  and parallel running. Keep this off the early critical path.

## Stage 7 — Marketing, BD, risk & firm intelligence — **L**
- CRM data quality, relationship graph, marketing-safe experience bank,
  campaigns/content, pitch/proposal, account planning (behind the marketing
  firewall — no raw matter access).
- Risk/compliance squads (COLP/COFA/MLRO support, file review, undertakings,
  complaints, DPIA, incident response, AI governance registry).
- Executive agents + analytics.

## Stage 8 — Bounded autonomy — **ongoing**
Only after shadow + supervised operation and passing evals: high-confidence
auto-filing, standing-policy client updates, approved invoice issue, low-risk
reconciliations. High-risk stays approval-bound.

**Cross-cutting from Stage 1 on:** per-tenant cost budgets, evaluations + staged
rollout (shadow→pilot→supervised→GA), observability, tested backups/DR, and
per-tenant export/backup (replacing today's whole-database admin tools).

---

## Infrastructure

**Keep Cloudflare + Supabase + AhaSend as the core. Don't move to AWS wholesale;
add managed services stage by stage.**

| Platform | Covers |
|---|---|
| **Supabase** | Postgres + **RLS** (Stage 1 isolation), Auth/MFA, Storage, **pgvector** (Stage 3 search), Edge Functions — most of the spec's data + identity plane in one place. |
| **Cloudflare** | SPA hosting (Pages), WAF/DDoS, DNS, **R2** storage, Workers/**Workflows** (durable jobs), Access, Turnstile. |
| **AhaSend** | Transactional email — client updates, notifications, portal invites. |

**Still to add (all buy/integrate, per stage):**
- Microsoft 365 / Graph + Outlook & Word add-ins — *Stage 3* (biggest for a firm).
- Identity verification (Onfido / Persona / ComplyCube) — *Stage 4*.
- Sanctions/PEP/adverse-media (ComplyAdvantage / Dow Jones / OpenSanctions) — *Stage 4*.
- Company & beneficial-ownership data (Companies House API, OpenCorporates) — *Stage 4*.
- E-signature (DocuSign / Dropbox Sign) — *Stage 4*.
- Open-banking feed (TrueLayer / Yapily) + a regulated legal-accounts system to
  integrate, not build — *Stage 6*.
- OCR / document AI (Azure Document AI / Textract / Tesseract) — *Stage 3*.
- Malware scanning on uploads — *Stage 3*.
- Durable workflow engine (Cloudflare Workflows or Inngest/Trigger.dev) — *Stage 2+*.
- Observability (Sentry + OTel backend: Axiom / Grafana Cloud).
- LLM: Anthropic (already, via BonesAI) behind the model gateway.

**AWS vs. this stack:** Supabase gives Postgres+RLS+Auth+Storage+vector with a
fraction of the ops burden of assembling RDS+Cognito+S3+OpenSearch. The pull, if
any, is toward **Microsoft/Azure (Entra ID)** — not Amazon — because law firms
live in Microsoft 365 and the spec leans on Entra for identity. Consider Azure
identity *alongside* Supabase only if target firms are Microsoft shops.

**Non-negotiable due diligence:** UK/EU **data residency** (SRA/GDPR). Confirm the
Supabase region is UK/EU, that backups and LLM calls stay in-region, and that
Anthropic usage is on a no-training footing. Firms ask this on day one.

Never build yourself: IDV, sanctions data, payment rails, the client-money ledger.

---

## Appendix A — Stage 1 first-sprint checklist

A concrete first sprint that lands the substrate + isolation, nothing more.

1. **Provision** a Supabase project in a **UK/EU region**. Record region in an ADR.
2. **Schema + RLS** (Appendix B): `tenants`, `profiles`, `matters`,
   `matter_members`, `documents`, `audit_events`. Enable RLS on every table.
3. **JWT tenant claim:** on sign-up/first-login, stamp the user's `tenant_id`
   into `auth.users.app_metadata` (via an Edge Function / admin API) so it rides
   in the JWT and RLS reads it without a recursive `profiles` lookup.
4. **Auth wiring:** replace the header "acting user" with Supabase Auth (email +
   MFA). `access.currentUser()` becomes "the authenticated user"; `tenant_id`
   comes from the JWT, not a setting.
5. **Storage:** a private bucket per environment; object path prefixed with
   `tenant_id/matter_id/…`; a Storage RLS policy mirroring `matter_members`.
6. **Audit:** every state-changing API writes an `audit_events` row (append-only;
   no update/delete grant, even to the service role in normal paths).
7. **Data-access port:** introduce a thin repository layer so the app talks to
   one interface; back it with Supabase now, keeping today's JSON store as the
   local/offline test double. (Preserves the "runs offline" property.)
8. **Isolation tests (the gate):** for every table, an automated test that signs
   in as Firm A and asserts zero rows / permission-denied for Firm B — the SQL
   twin of the in-app tests already passing in v0.10.0.
9. **Migrate** existing prototype data: one tenant per firm, backfilled exactly
   as `db.migrate()` does today.

Definition of done: a user logs in, sees only their firm's matters, opens a
document from object storage, and a second firm's user — even with a known
id/URL — gets nothing, with every access audited.

---

## Appendix B — Supabase schema + RLS for the tenant boundary

Reference DDL for the Stage 1 core. Illustrative, not final — review before
applying. Enforces **tenant isolation** and **matter-level access** (the SQL
equivalent of `access.js`).

```sql
-- 1. Tenants (subscribing firms) --------------------------------------------
create table tenants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  plan       text not null default 'trial',
  region     text not null default 'uk',
  created_at timestamptz not null default now()
);

-- 2. Profiles: one per auth user, bound to exactly one tenant -----------------
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  tenant_id  uuid not null references tenants(id),
  name       text not null,
  role       text not null default 'staff'  -- 'admin' | 'attorney' | 'staff'
    check (role in ('admin','attorney','staff')),
  created_at timestamptz not null default now()
);

-- Current tenant, read from the JWT claim stamped at login (no recursive RLS).
-- Fall back to the profiles table if the claim is absent.
create or replace function current_tenant_id() returns uuid
language sql stable as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'tenant_id','')::uuid,
    (select tenant_id from profiles where id = auth.uid())
  );
$$;

create or replace function is_tenant_admin() returns boolean
language sql stable as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and tenant_id = current_tenant_id() and role = 'admin'
  );
$$;

-- 3. Matters + membership (mirrors access.js) --------------------------------
create table matters (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id),
  title                 text not null,
  reference             text,
  client_id             uuid,
  responsible_user_id   uuid references profiles(id),
  status                text not null default 'open',
  created_at            timestamptz not null default now()
);
create index on matters (tenant_id);

create table matter_members (   -- explicit access grants
  matter_id uuid not null references matters(id) on delete cascade,
  user_id   uuid not null references profiles(id) on delete cascade,
  primary key (matter_id, user_id)
);

create table documents (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id),
  matter_id  uuid not null references matters(id) on delete cascade,
  name       text not null,
  storage_key text not null,          -- object-store path, tenant/matter prefixed
  version    int  not null default 1,
  created_at timestamptz not null default now()
);
create index on documents (tenant_id, matter_id);

-- 4. Immutable audit ---------------------------------------------------------
create table audit_events (
  id         bigint generated always as identity primary key,
  tenant_id  uuid not null references tenants(id),
  actor_id   uuid references profiles(id),
  action     text not null,
  subject    text,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index on audit_events (tenant_id, created_at);

-- 5. Enable RLS everywhere ---------------------------------------------------
alter table tenants        enable row level security;
alter table profiles       enable row level security;
alter table matters        enable row level security;
alter table matter_members enable row level security;
alter table documents      enable row level security;
alter table audit_events   enable row level security;

-- 6. Policies ----------------------------------------------------------------
-- Tenant: a user sees only their own firm's row.
create policy tenant_self on tenants
  for select using (id = current_tenant_id());

-- Profiles: visible within your tenant; you can update your own.
create policy profiles_read   on profiles for select
  using (tenant_id = current_tenant_id());
create policy profiles_update on profiles for update
  using (id = auth.uid());

-- Matters: must be in-tenant AND (admin OR responsible OR an explicit member).
-- Tenant match is first, so no policy path can ever cross firms.
create policy matters_read on matters for select using (
  tenant_id = current_tenant_id() and (
    is_tenant_admin()
    or responsible_user_id = auth.uid()
    or exists (select 1 from matter_members m
               where m.matter_id = matters.id and m.user_id = auth.uid())
  )
);
create policy matters_write on matters for all using (
  tenant_id = current_tenant_id() and (is_tenant_admin()
    or responsible_user_id = auth.uid())
) with check (tenant_id = current_tenant_id());

-- Documents: inherit the matter's visibility, always within tenant.
create policy documents_rw on documents for all using (
  tenant_id = current_tenant_id()
  and exists (select 1 from matters mt where mt.id = documents.matter_id)
) with check (tenant_id = current_tenant_id());

-- Audit: readable in-tenant (admins), insert-only, never updated or deleted.
create policy audit_read   on audit_events for select
  using (tenant_id = current_tenant_id() and is_tenant_admin());
create policy audit_insert on audit_events for insert
  with check (tenant_id = current_tenant_id());
-- (no update/delete policy => those operations are denied for all app roles)
```

**Why this shape**
- `current_tenant_id()` reads the **JWT claim** first, so the hot path (every
  query) needs no extra table lookup and there's no risk of recursive RLS.
- **Tenant match is the first predicate in every policy** — matter-level rules
  narrow *within* a firm; they can never widen across firms.
- Audit has **insert + select only**; with no update/delete policy, Postgres
  denies those by default — the table is append-only for the app.
- Storage gets a parallel policy on the private bucket keyed on the same
  `tenant_id/matter_id` path prefix, so binaries are isolated like rows.
- This is the exact boundary already enforced in-app in v0.10.0; Stage 1 moves
  it down into the database where it's strongest.
