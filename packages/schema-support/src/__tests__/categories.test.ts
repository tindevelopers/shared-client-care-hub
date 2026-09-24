import { describe, expect, it } from "vitest";
import {
  supportCategoryInsertSchema,
  supportCategoryRowSchema,
  supportCategoryUpdateSchema,
} from "../categories";

const NOW = "2026-09-24T10:00:00.000+00:00";
const TENANT = "9a1b2c3d-0000-4000-8000-000000000010";

/** Ground-truth fixture: support_categories DDL (20251221000000). */
const categoryFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000001",
  tenant_id: TENANT,
  name: "Billing",
  description: "Billing and invoicing questions",
  is_active: true,
  created_at: NOW,
  updated_at: NOW,
};

describe("support_categories", () => {
  it("row round-trip (7 columns)", () => {
    expect(Object.keys(supportCategoryRowSchema.shape).sort()).toEqual(
      ["id", "tenant_id", "name", "description", "is_active", "created_at", "updated_at"].sort(),
    );
    const parsed = supportCategoryRowSchema.parse(categoryFixture);
    expect(parsed).toEqual(categoryFixture);
    expect(supportCategoryRowSchema.parse(parsed)).toEqual(parsed);
  });

  it("rejects unrecognized keys (strict)", () => {
    expect(supportCategoryRowSchema.safeParse({ ...categoryFixture, extra: true }).success).toBe(
      false,
    );
  });

  it("is_active is nullable (DDL has no NOT NULL, unlike core-kernel's typed boolean)", () => {
    expect(supportCategoryRowSchema.safeParse({ ...categoryFixture, is_active: null }).success).toBe(
      true,
    );
  });

  it("insert requires tenant_id and name only", () => {
    expect(supportCategoryInsertSchema.safeParse({ tenant_id: TENANT, name: "Billing" }).success).toBe(
      true,
    );
    expect(supportCategoryInsertSchema.safeParse({ tenant_id: TENANT }).success).toBe(false);
    expect(supportCategoryInsertSchema.safeParse({ name: "Billing" }).success).toBe(false);
  });

  it("update accepts partial patches and rejects unknown keys", () => {
    expect(supportCategoryUpdateSchema.safeParse({ is_active: false }).success).toBe(true);
    expect(supportCategoryUpdateSchema.safeParse({ nope: 1 }).success).toBe(false);
  });
});
