import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CRM_TABLE_NAMES, crmManifest, tables } from "../manifest";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// ADR-0002 (shell-base-admin) added conversation_turns and
// processed_external_events as formally declared CRM tables: both were
// already physically created by this package's own migrations, just not
// previously listed in the manifest.
//
// Same gap, closed here for nine more tables: this package's own migrations
// already create companies/deal_stages/deals/tasks/notes/activities
// (20251208000000) and brevo_webhook_events/campaign_events/campaign_lists
// (20260614230000 / 20260210000000), but none were previously listed either.
const EXISTING_TABLES = [
  "activities",
  "brevo_webhook_events",
  "campaign_events",
  "campaign_lists",
  "campaign_recipients",
  "campaigns",
  "companies",
  "contact_channels",
  "contact_group_members",
  "contact_groups",
  "contact_suppressions",
  "contact_sync_log",
  "contacts",
  "conversation_turns",
  "deal_stages",
  "deals",
  "field_mappings",
  "notes",
  "processed_external_events",
  "sync_state",
  "tasks",
];

const NONEXISTENT_PROPOSALS = [
  "campaign_audiences",
  "campaign_messages",
  "campaign_schedules",
  "crm_sync_logs",
];

describe("crm manifest", () => {
  it("manifest lists exactly the existing tables", () => {
    expect(Object.keys(crmManifest.tables).sort()).toEqual(EXISTING_TABLES);
    expect(Object.keys(tables).sort()).toEqual(EXISTING_TABLES);
    expect([...CRM_TABLE_NAMES].sort()).toEqual(EXISTING_TABLES);
    expect(Object.keys(crmManifest.tables)).toContain("contact_suppressions");
    for (const proposal of NONEXISTENT_PROPOSALS) {
      expect(crmManifest.tables).not.toHaveProperty(proposal);
    }
  });

  it("manifest references only migration files that exist in the migrations dir", () => {
    expect(crmManifest.migrationsDir).toBe("migrations");
    const onDisk = new Set(readdirSync(join(pkgRoot, "migrations")));
    const referenced = new Set(
      Object.values(crmManifest.tables).flatMap((t) => [...t.migrations]),
    );
    expect(referenced.size).toBeGreaterThan(0);
    for (const file of referenced) {
      expect(onDisk.has(file)).toBe(true);
    }
    // Every migration on disk is referenced by at least one table.
    for (const file of onDisk) {
      expect(referenced.has(file)).toBe(true);
    }
  });

  it("migrations dir exists in the published files list context", () => {
    expect(existsSync(join(pkgRoot, "migrations"))).toBe(true);
  });
});
