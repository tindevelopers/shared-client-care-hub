import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  contactGroupMemberRowSchema,
  contactGroupRowSchema,
  contactSegmentDefinitionSchema,
} from "../contact-groups";

const NOW = "2026-09-19T10:00:00.000+00:00";
const migrationPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../migrations/20260919012000_contact_membership_suppression_integrity.sql",
);

describe("contact groups", () => {
  it("parses the deployed contact_groups columns", () => {
    const row = {
      id: "9a1b2c3d-0000-4000-8000-000000000001",
      tenant_id: "9a1b2c3d-0000-4000-8000-000000000010",
      name: "VIP",
      description: "High-value contacts",
      color: "#6366f1",
      created_by: "9a1b2c3d-0000-4000-8000-000000000012",
      created_at: NOW,
      updated_at: NOW,
      kind: "list",
      definition: null,
    };

    expect(contactGroupRowSchema.parse(row).kind).toBe("list");
    expect(contactGroupRowSchema.safeParse({ ...row, extra: true }).success).toBe(false);
  });

  it("parses segment definitions", () => {
    expect(contactSegmentDefinitionSchema.parse({ tags: ["vip"] })).toEqual({
      tags: ["vip"],
    });
    expect(contactSegmentDefinitionSchema.safeParse({ tags: ["vip"], unknown: true }).success).toBe(
      false,
    );
  });

  it("parses the deployed contact_group_members columns", () => {
    const row = {
      id: "9a1b2c3d-0000-4000-8000-000000000002",
      tenant_id: "9a1b2c3d-0000-4000-8000-000000000010",
      group_id: "9a1b2c3d-0000-4000-8000-000000000001",
      contact_id: "9a1b2c3d-0000-4000-8000-000000000003",
      added_at: NOW,
    };

    expect(contactGroupMemberRowSchema.parse(row)).toEqual(row);
  });

  it("pins membership to same-tenant groups and contacts via composite foreign keys", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS contact_groups_tenant_id_id_key");
    expect(sql).toContain("contact_group_members_tenant_group_fkey");
    expect(sql).toContain("FOREIGN KEY (tenant_id, group_id)");
    expect(sql).toContain("REFERENCES public.contact_groups (tenant_id, id) ON DELETE CASCADE");
    expect(sql).toContain("contact_group_members_tenant_contact_fkey");
    expect(sql).toContain("FOREIGN KEY (tenant_id, contact_id)");
    expect(sql).toContain("REFERENCES public.contacts (tenant_id, id) ON DELETE CASCADE");
    // The permissive single-column FKs from 20260210100000 are replaced.
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS contact_group_members_group_id_fkey");
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS contact_group_members_contact_id_fkey");
  });

  it("deletes only invalid membership edges before adding the composite foreign keys", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("DELETE FROM public.contact_group_members AS m");
    // Both same-tenant existence checks guard the delete (group AND contact).
    expect(sql).toContain("FROM public.contact_groups AS g");
    expect(sql).toContain("g.tenant_id = m.tenant_id");
    expect(sql).toContain("FROM public.contacts AS c");
    expect(sql).toContain("c.tenant_id = m.tenant_id");
    // Cleanup runs before the FK conversion so it can never delete rows the
    // new constraints would have kept.
    expect(sql.indexOf("DELETE FROM public.contact_group_members")).toBeLessThan(
      sql.indexOf("ADD CONSTRAINT contact_group_members_tenant_group_fkey"),
    );
  });
});
