/**
 * Manifest for the support shell schema package.
 */
export const SUPPORT_TABLE_NAMES = [
  "support_categories",
  "support_tickets",
  "support_ticket_threads",
  "support_ticket_attachments",
  "support_ticket_history",
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
 * The 5 support tables owned by this package, keyed by table name.
 *
 * `support_tickets.external_refs`/`sync_state` were added historically by
 * konnect's `20260905000000_create_sync_bindings.sql` — owned by the sync
 * engine, not this package. Per ADR-0002 that migration is not re-shipped
 * here (see README "Migrations"); the columns still appear in
 * `supportTicketRowSchema` because they are real, current DB ground truth.
 */
export const tables: Record<SupportTableName, SupportTableInfo> = {
  support_categories: {
    migrations: ["20251221000000_create_support_tickets_schema.sql"],
  },
  support_tickets: {
    migrations: [
      "20251221000000_create_support_tickets_schema.sql",
      "20260223000000_support_tickets_error_escalation.sql",
    ],
  },
  support_ticket_threads: {
    migrations: ["20251221000000_create_support_tickets_schema.sql"],
  },
  support_ticket_attachments: {
    migrations: ["20251221000000_create_support_tickets_schema.sql"],
  },
  support_ticket_history: {
    migrations: ["20251221000000_create_support_tickets_schema.sql"],
  },
};

export const supportManifest: SupportSchemaManifest = {
  migrationsDir: "migrations",
  tables,
};
