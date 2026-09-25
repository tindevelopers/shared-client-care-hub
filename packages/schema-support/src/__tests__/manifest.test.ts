import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { retiredTables, SUPPORT_TABLE_NAMES, supportManifest, tables } from "../manifest";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const LIVE_TABLES = [
  "support_categories",
  "support_tickets",
  "support_ticket_threads",
  "support_ticket_attachments",
  "support_ticket_history",
  "support_groups",
  "support_ticket_links",
  "support_access_grants",
  "support_access_events",
];

describe("support manifest", () => {
  it("manifest lists exactly the nine live owned tables", () => {
    // support_ticket_history is created by this package's own base migration
    // (20251221000000) — ADR-0002 requires the manifest to declare every
    // table a package's migrations create, so it is claimed here alongside
    // the other tables. support_groups/support_ticket_links/
    // support_access_grants/support_access_events are added by the
    // owner-scoped escalation chain (20260924100000/20260924120000).
    expect(Object.keys(supportManifest.tables).sort()).toEqual(LIVE_TABLES.sort());
    expect(Object.keys(tables).sort()).toEqual(LIVE_TABLES.sort());
    expect([...SUPPORT_TABLE_NAMES].sort()).toEqual(LIVE_TABLES.sort());
  });

  it("retired tables are recorded with their creating and dropping migration", () => {
    expect(Object.keys(retiredTables).sort()).toEqual(
      ["partner_support_tickets", "partner_support_ticket_replies"].sort(),
    );
    for (const info of Object.values(retiredTables)) {
      expect(info.created).toBe("20260913130000_create_partner_support_tickets.sql");
      expect(info.dropped).toBe("20260924100000_support_owner_escalation.sql");
    }
  });

  it("manifest references only migration files that exist in the migrations dir", () => {
    expect(supportManifest.migrationsDir).toBe("migrations");
    const onDisk = new Set(readdirSync(join(pkgRoot, "migrations")));
    const referenced = new Set(
      Object.values(supportManifest.tables).flatMap((t) => [...t.migrations]),
    );
    expect(referenced.size).toBeGreaterThan(0);
    for (const file of referenced) {
      expect(onDisk.has(file)).toBe(true);
    }
    // Every migration on disk is referenced by at least one live table, or is
    // the migration that created a retired table.
    const retiredCreators = new Set(Object.values(retiredTables).map((t) => t.created));
    for (const file of onDisk) {
      expect(referenced.has(file) || retiredCreators.has(file)).toBe(true);
    }
  });

  it("migrations dir exists in the published files list context", () => {
    expect(existsSync(join(pkgRoot, "migrations"))).toBe(true);
  });
});
