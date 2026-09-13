# shell-base-crm

CRM domain hub for the `@tindevelopers/*` platform estate. Publishes the
`@tindevelopers/*` packages that own the canonical contact and campaign
aggregates:

- **schema-crm** — Zod schemas + row/insert/update types for the existing CRM
  tables (`contacts`, `contact_channels`, `campaigns`, `campaign_recipients`,
  `contact_sync_log`, `sync_state`, `field_mappings`)
- **domain-contacts** — the single owner of the canonical contact record:
  tenant-tier contacts store, system-tier store (identity resolution,
  suppression, SMS opt-out, Brevo sync state), suppression + CRM-sync
  subscribers, and the campaign segment materializer
- **domain-campaigns** — campaign store, calling-window scheduling, and the
  marketing campaign service (injected dependencies only)

## Design invariants

1. **R4 — One owner per root entity.** `contacts` is written by
   `domain-contacts` and nothing else.
2. **R5 — Domains never import domains.** `domain-campaigns` reaches contacts
   data only through injected callbacks (audience resolver) or core-kernel
   events.
3. **R1 — No vendor SDK in a domain.** Domain packages import ports, never
   vendor SDKs.
4. **Injection-only service role.** Packages receive a `SupabaseClient`
   through their public API. They never construct one, never import
   `@tindevelopers/core-kernel/database/admin-client`, and never read
   `SUPABASE_SERVICE_ROLE_KEY`.

Layering (acyclic): `apps → domains → integrations → core-kernel`.

## Layout

```
packages/
  schema-crm/         Zod schemas + table types + manifest
  domain-contacts/    contacts store (tenant + system tiers), subscribers,
                      segment materializer
  domain-campaigns/   campaign store, scheduling, campaign service
tests/
  boundary/           dependency-cruiser rules-fire + env-scan guardrails
```

## Publishing checklist (non-negotiable)

1. `exports` top-level — `npm publish` ignores `publishConfig.exports`.
2. `exports` includes the `"./*"` wildcard for deep subpaths.
3. `tsconfig.json` sets `"declaration": true` — verify `dist/**/*.d.ts` exists.
4. No `workspace:*` ranges in dependencies.
5. Publish in dependency order; verify with `npm view <pkg> versions`.
6. Published versions are immutable — bump, never re-publish.
7. `npm deprecate` does not work on GitHub Packages (HTTP 400).

## Reference

- Design: `konnect-caas-base/docs/superpowers/specs/2026-09-12-src-core-promotion-design.md`
- Ground truth: `konnect-caas-base/docs/superpowers/research/2026-09-13-crm-schema-ground-truth.md`
