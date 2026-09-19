import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  contactSuppressionInsertSchema,
  contactSuppressionRowSchema,
  suppressionChannelSchema,
} from "../suppressions";

const NOW = "2026-09-19T10:00:00.000+00:00";
const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../migrations/20260919010000_contact_lists_suppressions.sql",
);
const integrityMigrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../migrations/20260919012000_contact_membership_suppression_integrity.sql",
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
      updated_by: "9a1b2c3d-0000-4000-8000-000000000012",
      created_at: NOW,
      updated_at: NOW,
    };

    expect(contactSuppressionRowSchema.parse(row).channel).toBe("email");
    expect(contactSuppressionRowSchema.parse({ ...row, updated_by: null }).updated_by).toBeNull();
    expect(contactSuppressionRowSchema.safeParse({ ...row, extra: true }).success).toBe(false);
  });

  it("types the canonical upsert payload with a dedicated updated_by column", () => {
    const insert = {
      tenant_id: "9a1b2c3d-0000-4000-8000-000000000010",
      contact_id: "9a1b2c3d-0000-4000-8000-000000000003",
      channel: "email",
      suppressed: true,
      reason: null,
      source: "crm-ui",
      updated_by: "9a1b2c3d-0000-4000-8000-000000000012",
    };

    expect(contactSuppressionInsertSchema.parse(insert).updated_by).toBe(insert.updated_by);
    expect(contactSuppressionInsertSchema.safeParse({ ...insert, updated_by: "not-a-uuid" }).success).toBe(
      false,
    );
  });

  it("adds the canonical updated_by actor column in the additive integrity migration", () => {
    const sql = readFileSync(integrityMigrationPath, "utf8");

    expect(sql).toContain("ADD COLUMN IF NOT EXISTS updated_by UUID");
    expect(sql).toContain("REFERENCES public.users(id) ON DELETE SET NULL");
    // The Task 3 migration is never edited — upgraded databases get the
    // column from the new additive file only.
    expect(readFileSync(migrationPath, "utf8")).not.toContain("updated_by");
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

  it("forbids suppression identity mutation in the projection trigger", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("IS DISTINCT FROM OLD.tenant_id");
    expect(sql).toContain("IS DISTINCT FROM OLD.contact_id");
    expect(sql).toContain("IS DISTINCT FROM OLD.channel");
    expect(sql).toContain("RAISE EXCEPTION");
  });

  it("pins suppressions to same-tenant contacts via composite foreign key", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_id_id_key");
    expect(sql).toContain("FOREIGN KEY (tenant_id, contact_id)");
    expect(sql).toContain("REFERENCES public.contacts (tenant_id, id) ON DELETE CASCADE");
  });

  it("excludes partner admins from every product tenant policy", () => {
    const sql = readFileSync(migrationPath, "utf8");

    // view USING + insert WITH CHECK + update USING/WITH CHECK + delete USING.
    const guards = sql.match(/AND NOT public\.current_user_is_partner_admin\(\)/g) ?? [];
    expect(guards.length).toBe(5);
  });

  it("canonical migration is rerunnable", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.contact_suppressions");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_contact_suppressions_tenant_id");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.project_contact_suppression()");
    expect(sql).toContain("DROP TRIGGER IF EXISTS project_contact_suppression_to_contacts");
    expect(sql).toContain(
      'DROP POLICY IF EXISTS "Users can view contact_suppressions in their tenant"',
    );
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS campaigns_status_check");
  });
});
