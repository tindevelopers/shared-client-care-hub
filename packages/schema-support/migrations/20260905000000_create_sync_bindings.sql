-- ─────────────────────────────────────────────────────────────────────────────
-- Sync engine schema — the graduation layer (Pass C)
--
-- Design refs: docs/superpowers/specs/2026-09-05-thin-layer-platform-design.md
--   R2: first-party schema is the system of record; specialists are sync
--       targets (external_refs / sync_state envelope on syncable rows).
--   R3: graduation is config — enabling a specialist for a tenant is a
--       sync_bindings row, not a deploy.
--
-- Note: tenant isolation in this estate is enforced at the application layer
-- (tenant-scoped repository helpers + RLS policies are a separate, estate-wide
-- hardening decision — deliberately not introduced piecemeal here).
-- ─────────────────────────────────────────────────────────────────────────────

-- One row per (tenant, capability, provider): the binding IS the graduation.
create table if not exists sync_bindings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  capability text not null
    check (capability in ('crm', 'support', 'ecommerceSupport', 'calendar', 'marketing', 'telephony', 'transcription', 'content')),
  provider text not null,
  direction text not null default 'off'
    check (direction in ('off', 'push', 'pull', 'bidirectional')),
  conflict_policy text not null default 'first-party-wins'
    check (conflict_policy in ('first-party-wins', 'specialist-wins', 'newest-wins', 'manual')),
  field_map jsonb not null default '{}'::jsonb,
  schedule jsonb not null default '{"kind":"manual"}'::jsonb,
  state jsonb not null default '{"health":"unknown"}'::jsonb,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, capability, provider)
);

create index if not exists idx_sync_bindings_tenant_capability
  on sync_bindings(tenant_id, capability);

-- One row per engine run: cursor-based, resumable (backfill friendly).
create table if not exists sync_runs (
  id uuid primary key default gen_random_uuid(),
  binding_id uuid not null references sync_bindings(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'success', 'partial', 'failed')),
  processed int not null default 0,
  failed int not null default 0,
  cursor_before text,
  cursor_after text,
  error text
);

create index if not exists idx_sync_runs_binding_started
  on sync_runs(binding_id, started_at desc);

-- 'manual' conflict policy defers the decision here instead of guessing.
create table if not exists sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  binding_id uuid not null references sync_bindings(id) on delete cascade,
  entity_id text not null,
  first_party jsonb not null,
  specialist jsonb not null,
  resolution text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_sync_conflicts_binding_open
  on sync_conflicts(binding_id) where resolved_at is null;

-- Every failed specialist write lands here, keyed for idempotent replay.
create table if not exists sync_dead_letters (
  id uuid primary key default gen_random_uuid(),
  binding_id uuid not null references sync_bindings(id) on delete cascade,
  idempotency_key text not null,
  payload jsonb not null,
  error text not null,
  attempts int not null default 1,
  created_at timestamptz not null default now(),
  replayed_at timestamptz,
  unique (binding_id, idempotency_key)
);

create index if not exists idx_sync_dead_letters_binding_pending
  on sync_dead_letters(binding_id) where replayed_at is null;

-- R2 envelope on the first support capability (thin-layer tickets).
alter table support_tickets
  add column if not exists external_refs jsonb not null default '{}'::jsonb,
  add column if not exists sync_state jsonb not null default '{"status":"clean"}'::jsonb;
