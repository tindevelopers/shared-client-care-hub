import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsDir = join(pkgRoot, "migrations");

/**
 * sha256 of each file as it exists on konnect-caas-base's `develop` branch
 * (recorded once at adoption time — see the task that copied these files).
 * ADR-0002 requires migrations to be copied byte-identical from Konnect's
 * root `supabase/migrations/` and sha256-verified; this test is that
 * verification, re-run on every build so a future edit to these files is
 * caught immediately.
 */
const EXPECTED_SHA256: Record<string, string> = {
  "20260924100000_support_owner_escalation.sql":
    "b3030042b6aa53b4400b6c0cafa3ccafdc7a4190483907c789a890f346e72cd8",
  "20260924110000_support_escalation_gateway.sql":
    "a8cca0ba9b1c38d67b9211a1d77b185a8f2ac230006c7f2462726221aa4b23e1",
  "20260924120000_support_access_grants.sql":
    "cbef7a3bb1d847422c0c789c0538b44187ce4d7c50857b335811babed1712f9c",
  "20260925130000_support_agent_permission.sql":
    "c21f0104d4277563b1d2f76b54d52f8799b5cccb0eae272dd8cbdea905c5fe5c",
  "20260925090000_pin_support_ticket_created_by.sql":
    "a1afa0770bb1f878b0e6c7b06b946e7cd193281853bb853c275cfd76b5577505",
  "20260926120000_support_anon_lockdown.sql":
    "c312c372a5736b6db3109d3f169917ed16660fa72e3a349d60ad45b7810ee7c3",
};

describe("adopted migrations (ADR-0002 byte-identical copy)", () => {
  for (const [file, expected] of Object.entries(EXPECTED_SHA256)) {
    it(`${file} matches its recorded sha256`, () => {
      const contents = readFileSync(join(migrationsDir, file));
      const actual = createHash("sha256").update(contents).digest("hex");
      expect(actual).toBe(expected);
    });
  }
});
