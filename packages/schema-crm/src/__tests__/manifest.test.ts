import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CRM_TABLE_NAMES, crmManifest, tables } from "../manifest";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const SEVEN_EXISTING = [
  "campaign_recipients",
  "campaigns",
  "contact_channels",
  "contact_sync_log",
  "contacts",
  "field_mappings",
  "sync_state",
];

const NONEXISTENT_PROPOSALS = [
  "contact_suppressions",
  "campaign_audiences",
  "campaign_messages",
  "campaign_schedules",
  "crm_sync_logs",
];

describe("crm manifest", () => {
  it("manifest lists exactly the seven existing tables", () => {
    expect(Object.keys(crmManifest.tables).sort()).toEqual(SEVEN_EXISTING);
    expect(Object.keys(tables).sort()).toEqual(SEVEN_EXISTING);
    expect([...CRM_TABLE_NAMES].sort()).toEqual(SEVEN_EXISTING);
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
