import { describe, expect, it } from "vitest";
import {
  supportCategoryInsertSchema,
  supportCategoryRowSchema,
  supportCategoryUpdateSchema,
} from "../categories";

const NOW = "2026-09-24T10:00:00.000+00:00";
const TENANT = "9a1b2c3d-0000-4000-8000-000000000010";

/** Ground-truth fixture: support_categories composite DDL (2 migrations). */
const categoryFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000001",
  tenant_id: TENANT,
  partner_id: null,
  owner_scope: "tenant",
  name: "Billing",
  description: "Billing and invoicing questions",
  is_active: true,
  created_at: NOW,
  updated_at: NOW,
};

describe("support_categories", () => {
  it("row round-trip (9 columns)", () => {
    expect(Object.keys(supportCategoryRowSchema.shape).sort()).toEqual(
      [
        "id",
        "tenant_id",
        "partner_id",
        "owner_scope",
        "name",
        "description",
        "is_active",
        "created_at",
        "updated_at",
      ].sort(),
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

  it("owner_scope rejects a value outside tenant/partner/platform", () => {
    expect(
      supportCategoryRowSchema.safeParse({ ...categoryFixture, owner_scope: "bogus" }).success,
    ).toBe(false);
  });

  it("tenant_id/partner_id are nullable (20260924100000 — a partner- or platform-owned category has no tenant)", () => {
    expect(
      supportCategoryRowSchema.safeParse({
        ...categoryFixture,
        tenant_id: null,
        partner_id: "9a1b2c3d-0000-4000-8000-000000000099",
        owner_scope: "partner",
      }).success,
    ).toBe(true);
  });

  it("is_active is nullable (DDL has no NOT NULL, unlike core-kernel's typed boolean)", () => {
    expect(supportCategoryRowSchema.safeParse({ ...categoryFixture, is_active: null }).success).toBe(
      true,
    );
  });

  it("insert requires name only — tenant_id is nullable, owner_scope is DB-owned", () => {
    expect(supportCategoryInsertSchema.safeParse({ name: "Billing" }).success).toBe(true);
    expect(supportCategoryInsertSchema.safeParse({ tenant_id: TENANT }).success).toBe(false);
  });

  it("update accepts partial patches and rejects unknown keys", () => {
    expect(supportCategoryUpdateSchema.safeParse({ is_active: false }).success).toBe(true);
    expect(supportCategoryUpdateSchema.safeParse({ nope: 1 }).success).toBe(false);
  });
});
