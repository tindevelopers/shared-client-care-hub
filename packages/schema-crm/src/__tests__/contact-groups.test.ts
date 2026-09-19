import { describe, expect, it } from "vitest";
import {
  contactGroupMemberRowSchema,
  contactGroupRowSchema,
  contactSegmentDefinitionSchema,
} from "../contact-groups";

const NOW = "2026-09-19T10:00:00.000+00:00";

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
});
