import { describe, expect, it } from "vitest";
import {
  customFieldDefinitionInsertSchema,
  customFieldDefinitionRowSchema,
  customFieldDefinitionUpdateSchema,
  customFieldEntitySchema,
  customFieldTypeSchema,
} from "../custom-field-definitions";

const NOW = "2026-09-24T10:00:00.000+00:00";

/** Ground-truth fixture: custom_field_definitions effective DDL (11 columns, 20260603100000). */
const customFieldFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000001",
  tenant_id: "9a1b2c3d-0000-4000-8000-000000000010",
  entity: "contact",
  key: "shirt_size",
  label: "Shirt size",
  field_type: "select",
  options: ["S", "M", "L"],
  required: false,
  position: 0,
  created_at: NOW,
  updated_at: NOW,
};

describe("custom_field_definitions", () => {
  it("row round-trip (11 columns)", () => {
    expect(Object.keys(customFieldDefinitionRowSchema.shape).sort()).toEqual(
      [
        "created_at",
        "entity",
        "field_type",
        "id",
        "key",
        "label",
        "options",
        "position",
        "required",
        "tenant_id",
        "updated_at",
      ].sort(),
    );
    const parsed = customFieldDefinitionRowSchema.parse(customFieldFixture);
    expect(parsed).toEqual(customFieldFixture);
    expect(customFieldDefinitionRowSchema.parse(parsed)).toEqual(parsed);
  });

  it("entity enum accepts the three CHECK values and rejects others", () => {
    for (const value of ["contact", "company", "deal"]) {
      expect(customFieldEntitySchema.safeParse(value).success).toBe(true);
    }
    expect(customFieldEntitySchema.safeParse("lead").success).toBe(false);
  });

  it("field_type enum accepts the nine CHECK values and rejects others", () => {
    for (const value of [
      "text",
      "number",
      "date",
      "select",
      "multiselect",
      "boolean",
      "url",
      "email",
      "phone",
    ]) {
      expect(customFieldTypeSchema.safeParse(value).success).toBe(true);
    }
    expect(customFieldTypeSchema.safeParse("richtext").success).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    expect(
      customFieldDefinitionRowSchema.safeParse({ ...customFieldFixture, lifecycle_stage: "x" })
        .success,
    ).toBe(false);
  });

  it("insert requires tenant_id/entity/key/label/field_type and accepts the rest as optional", () => {
    expect(
      customFieldDefinitionInsertSchema.safeParse({
        tenant_id: customFieldFixture.tenant_id,
        entity: "contact",
        key: "shirt_size",
        label: "Shirt size",
        field_type: "select",
      }).success,
    ).toBe(true);
    for (const required of ["tenant_id", "entity", "key", "label", "field_type"]) {
      const payload: Record<string, unknown> = {
        tenant_id: customFieldFixture.tenant_id,
        entity: "contact",
        key: "shirt_size",
        label: "Shirt size",
        field_type: "select",
      };
      delete payload[required];
      expect(customFieldDefinitionInsertSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("update accepts partial patches and rejects unknown keys", () => {
    expect(customFieldDefinitionUpdateSchema.safeParse({ label: "New label" }).success).toBe(true);
    expect(customFieldDefinitionUpdateSchema.safeParse({ lifecycle_stage: "x" }).success).toBe(
      false,
    );
  });
});
