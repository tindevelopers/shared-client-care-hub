/**
 * Manifest for the CRM shell schema package.
 */
export const CRM_TABLE_NAMES = [
  "contacts",
  "contact_channels",
  "contact_groups",
  "contact_group_members",
  "contact_suppressions",
  "campaigns",
  "campaign_recipients",
  "contact_sync_log",
  "sync_state",
  "field_mappings",
  "processed_external_events",
  "conversation_turns",
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
 * The existing CRM tables, keyed by table name.
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
  contact_groups: {
    migrations: [
      "20260210100000_create_contact_groups.sql",
      "20260919010000_contact_lists_suppressions.sql",
      "20260919012000_contact_membership_suppression_integrity.sql",
    ],
  },
  contact_group_members: {
    migrations: [
      "20260210100000_create_contact_groups.sql",
      "20260919012000_contact_membership_suppression_integrity.sql",
    ],
  },
  contact_suppressions: {
    migrations: [
      "20260919010000_contact_lists_suppressions.sql",
      "20260919012000_contact_membership_suppression_integrity.sql",
    ],
  },
  campaigns: {
    migrations: [
      "20260210000000_create_campaign_tables.sql",
      "20260222000000_add_campaign_soft_delete.sql",
      "20260310000000_add_campaign_timezone.sql",
      "20260614120000_create_conversation_tables.sql",
      "20260614233000_extend_campaigns_for_marketing.sql",
      "20260919010000_contact_lists_suppressions.sql",
    ],
  },
  campaign_recipients: {
    migrations: [
      "20260210000000_create_campaign_tables.sql",
      "20260614120000_create_conversation_tables.sql",
      "20260614140000_add_retry_attempts_to_campaign_recipients.sql",
      "20260614233000_extend_campaigns_for_marketing.sql",
      "20260615000002_fix_multiturn_sms_constraints.sql",
      "20260919013000_atomic_campaign_recipient_replacement.sql",
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
  processed_external_events: {
    migrations: ["20260603120000_create_integration_sync_schema.sql"],
  },
  conversation_turns: {
    migrations: [
      "20260614120000_create_conversation_tables.sql",
      "20260615000002_fix_multiturn_sms_constraints.sql",
    ],
  },
};

export const crmManifest: CrmSchemaManifest = {
  migrationsDir: "migrations",
  tables,
};
