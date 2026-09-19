import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contactSuppressionRowSchema, suppressionChannelSchema } from "../suppressions";

const NOW = "2026-09-19T10:00:00.000+00:00";
const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../migrations/20260919010000_contact_lists_suppressions.sql",
);

describe("contact suppressions", () => {
  it("parses the deployed contact_suppressions columns", () => {
    const row = {
      id: "9a1b2c3d-0000-4000-8000-000000000001",
      tenant_id: "9a1b2c3d-0000-4000-8000-000000000010",
      contact_id: "9a1b2c3d-0000-4000-8000-000000000003",
      channel: "email",
      suppressed: true,
      reason: "unsubscribe",
      source: "contact",
      metadata: { requestId: "req-1" },
      created_at: NOW,
      updated_at: NOW,
    };

    expect(contactSuppressionRowSchema.parse(row).channel).toBe("email");
    expect(contactSuppressionRowSchema.safeParse({ ...row, extra: true }).success).toBe(false);
  });

  it("accepts exactly the canonical suppression channels", () => {
    expect(suppressionChannelSchema.options).toEqual(["email", "sms", "whatsapp"]);
    expect(suppressionChannelSchema.safeParse("voice").success).toBe(false);
  });

  it("projects every suppression channel to its legacy contact flag", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("WHEN 'email'");
    expect(sql).toContain("email_opt_out");
    expect(sql).toContain("WHEN 'sms'");
    expect(sql).toContain("sms_opt_out");
    expect(sql).toContain("WHEN 'whatsapp'");
    expect(sql).toContain("whatsapp_opt_out");
    expect(sql).toContain("SET search_path = public");
  });
});
