import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORT_TABLE_NAMES, supportManifest, tables } from "../manifest";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const EXISTING_TABLES = [
  "support_categories",
  "support_tickets",
  "support_ticket_threads",
  "support_ticket_attachments",
];

describe("support manifest", () => {
  it("manifest lists exactly the four owned tables", () => {
    expect(Object.keys(supportManifest.tables).sort()).toEqual(EXISTING_TABLES.sort());
    expect(Object.keys(tables).sort()).toEqual(EXISTING_TABLES.sort());
    expect([...SUPPORT_TABLE_NAMES].sort()).toEqual(EXISTING_TABLES.sort());
    // support_ticket_history is created by the same base migration but is
    // out of scope for this package (task-scoped to the 4 tables above).
    expect(supportManifest.tables).not.toHaveProperty("support_ticket_history");
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
    // Every migration on disk is referenced by at least one table.
    for (const file of onDisk) {
      expect(referenced.has(file)).toBe(true);
    }
  });

  it("migrations dir exists in the published files list context", () => {
    expect(existsSync(join(pkgRoot, "migrations"))).toBe(true);
  });
});
