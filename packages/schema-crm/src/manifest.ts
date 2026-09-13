/**
 * Manifest for the CRM shell schema package: EXACTLY the seven existing
 * tables. The five tables named in early Phase 2 drafts (`contact_suppressions`,
 * `campaign_audiences`, `campaign_messages`, `campaign_schedules`,
 * `crm_sync_logs`) do not exist and are deliberately absent.
 */
export const CRM_TABLE_NAMES = [
  "contacts",
  "contact_channels",
  "campaigns",
  "campaign_recipients",
  "contact_sync_log",
  "sync_state",
  "field_mappings",
] as const;

export type CrmTableName = (typeof CRM_TABLE_NAMES)[number];

export interface CrmTableInfo {
  /** Migration files (in `migrationsDir`) that define this table's effective DDL. */
  migrations: readonly string[];
}

export interface CrmSchemaManifest {
  migrationsDir: string;
  tables: Record<CrmTableName, CrmTableInfo>;
}

/**
 * The seven existing CRM tables, keyed by table name.
 */
export const tables: Record<CrmTableName, CrmTableInfo> = {
  contacts: {
    migrations: [
      "20251208000000_create_crm_tables.sql",
      "20260320100000_add_contact_sync_tracking.sql",
      "20260614120000_create_conversation_tables.sql",
      "20260614230000_brevo_webhooks_activities_suppression.sql",
      "20260615000001_create_conversations_module.sql",
    ],
  },
  contact_channels: {
    migrations: ["20260615000001_create_conversations_module.sql"],
  },
  campaigns: {
    migrations: [
      "20260210000000_create_campaign_tables.sql",
      "20260222000000_add_campaign_soft_delete.sql",
      "20260310000000_add_campaign_timezone.sql",
      "20260614120000_create_conversation_tables.sql",
      "20260614233000_extend_campaigns_for_marketing.sql",
    ],
  },
  campaign_recipients: {
    migrations: [
      "20260210000000_create_campaign_tables.sql",
      "20260614120000_create_conversation_tables.sql",
      "20260614140000_add_retry_attempts_to_campaign_recipients.sql",
      "20260614233000_extend_campaigns_for_marketing.sql",
      "20260615000002_fix_multiturn_sms_constraints.sql",
    ],
  },
  contact_sync_log: {
    migrations: ["20260320100000_add_contact_sync_tracking.sql"],
  },
  sync_state: {
    migrations: ["20260603120000_create_integration_sync_schema.sql"],
  },
  field_mappings: {
    migrations: ["20260603120000_create_integration_sync_schema.sql"],
  },
};

export const crmManifest: CrmSchemaManifest = {
  migrationsDir: "migrations",
  tables,
};
