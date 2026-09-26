/**
 * Manifest for the support shell schema package.
 */
export const SUPPORT_TABLE_NAMES = [
  "support_categories",
  "support_tickets",
  "support_ticket_threads",
  "support_ticket_attachments",
  "support_ticket_history",
  "support_groups",
  "support_ticket_links",
  "support_access_grants",
  "support_access_events",
] as const;

export type SupportTableName = (typeof SUPPORT_TABLE_NAMES)[number];

export interface SupportTableInfo {
  /** Migration files (in `migrationsDir`) that define this table's effective DDL. */
  migrations: readonly string[];
}

export interface SupportSchemaManifest {
  migrationsDir: string;
  tables: Record<SupportTableName, SupportTableInfo>;
}

/**
 * A table this package's migrations dropped, kept for provenance rather than
 * silently vanishing from history. `created`/`dropped` name the migration
 * files (in `migrationsDir`) that brought the table into existence and took
 * it out.
 */
export interface RetiredTableInfo {
  created: string;
  dropped: string;
}

/**
 * The partner queue retired by `20260924100000_support_owner_escalation.sql`
 * (no production data of substance, confirmed 2026-09-24 — see that
 * migration's header). Partner-owned tickets now live in `support_tickets`
 * with `owner_scope = 'partner'`.
 */
export const retiredTables: Record<
  "partner_support_tickets" | "partner_support_ticket_replies",
  RetiredTableInfo
> = {
  partner_support_tickets: {
    created: "20260913130000_create_partner_support_tickets.sql",
    dropped: "20260924100000_support_owner_escalation.sql",
  },
  partner_support_ticket_replies: {
    created: "20260913130000_create_partner_support_tickets.sql",
    dropped: "20260924100000_support_owner_escalation.sql",
  },
};

// 20260924100000 also drops `support_inbox_state`, which no package here
// owns: it was created by konnect's own `20260913140000_client_support_access.sql`
// (not shipped by this package — see README "Migrations").

/**
 * The nine support tables owned by this package, keyed by table name.
 *
 * `support_tickets.external_refs`/`sync_state` were added historically by
 * konnect's `20260905000000_create_sync_bindings.sql` — owned by the sync
 * engine, not this package. Per ADR-0002 that migration is not re-shipped
 * here (see README "Migrations"); the columns still appear in
 * `supportTicketRowSchema` because they are real, current DB ground truth.
 *
 * `support_ticket_links`, `support_access_grants`, and `support_access_events`
 * are new tables added by the owner-scoped escalation chain
 * (20260924100000/20260924120000). `20260924110000_support_escalation_gateway.sql`
 * defines no table DDL of its own — it is the SECURITY DEFINER function
 * gateway (`support_escalate`/`support_hand_back`/`support_withdraw`/
 * `support_merge`) that writes across owners, so it is listed under the
 * tables its functions insert/update: `support_tickets`,
 * `support_ticket_threads`, and `support_ticket_links`.
 */
export const tables: Record<SupportTableName, SupportTableInfo> = {
  support_categories: {
    migrations: [
      "20251221000000_create_support_tickets_schema.sql",
      "20260924100000_support_owner_escalation.sql",
      "20260925090000_pin_support_ticket_created_by.sql",
      "20260926120000_support_anon_lockdown.sql",
    ],
  },
  support_tickets: {
    migrations: [
      "20251221000000_create_support_tickets_schema.sql",
      "20260223000000_support_tickets_error_escalation.sql",
      "20260924100000_support_owner_escalation.sql",
      "20260924110000_support_escalation_gateway.sql",
      "20260925090000_pin_support_ticket_created_by.sql",
      "20260926120000_support_anon_lockdown.sql",
    ],
  },
  support_ticket_threads: {
    migrations: [
      "20251221000000_create_support_tickets_schema.sql",
      "20260924100000_support_owner_escalation.sql",
      "20260924110000_support_escalation_gateway.sql",
      "20260925090000_pin_support_ticket_created_by.sql",
      "20260926120000_support_anon_lockdown.sql",
    ],
  },
  support_ticket_attachments: {
    migrations: [
      "20251221000000_create_support_tickets_schema.sql",
      "20260924100000_support_owner_escalation.sql",
      "20260925090000_pin_support_ticket_created_by.sql",
      "20260925130000_support_agent_permission.sql",
      "20260926120000_support_anon_lockdown.sql",
    ],
  },
  support_ticket_history: {
    migrations: [
      "20251221000000_create_support_tickets_schema.sql",
      "20260924100000_support_owner_escalation.sql",
      "20260925090000_pin_support_ticket_created_by.sql",
      "20260926120000_support_anon_lockdown.sql",
    ],
  },
  support_groups: {
    migrations: [
      "20260924100000_support_owner_escalation.sql",
      "20260925090000_pin_support_ticket_created_by.sql",
      "20260925130000_support_agent_permission.sql",
      "20260926120000_support_anon_lockdown.sql",
    ],
  },
  support_ticket_links: {
    migrations: [
      "20260924100000_support_owner_escalation.sql",
      "20260924110000_support_escalation_gateway.sql",
      "20260926120000_support_anon_lockdown.sql",
    ],
  },
  support_access_grants: {
    migrations: [
      "20260924120000_support_access_grants.sql",
      "20260926120000_support_anon_lockdown.sql",
    ],
  },
  support_access_events: {
    migrations: [
      "20260924120000_support_access_grants.sql",
      "20260926120000_support_anon_lockdown.sql",
    ],
  },
};

export const supportManifest: SupportSchemaManifest = {
  migrationsDir: "migrations",
  tables,
};
