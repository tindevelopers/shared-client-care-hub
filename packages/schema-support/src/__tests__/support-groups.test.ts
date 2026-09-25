import { describe, expect, it } from "vitest";
import {
  supportGroupInsertSchema,
  supportGroupRowSchema,
  supportGroupUpdateSchema,
} from "../support-groups";

const NOW = "2026-09-24T10:00:00.000+00:00";
const TENANT = "9a1b2c3d-0000-4000-8000-000000000010";

/** Ground-truth fixture: support_groups DDL (20260924100000). */
const groupFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000020",
  owner_scope: "tenant",
  tenant_id: TENANT,
  partner_id: null,
  name: "Tier 1",
  rank: 1,
  is_active: true,
  created_at: NOW,
};

describe("support_groups", () => {
  it("row round-trip (8 columns, no updated_at)", () => {
    expect(Object.keys(supportGroupRowSchema.shape).sort()).toEqual(
      ["id", "owner_scope", "tenant_id", "partner_id", "name", "rank", "is_active", "created_at"].sort(),
    );
    const parsed = supportGroupRowSchema.parse(groupFixture);
    expect(parsed).toEqual(groupFixture);
    expect(supportGroupRowSchema.parse(parsed)).toEqual(parsed);
  });

  it("rejects unrecognized keys (strict)", () => {
    expect(supportGroupRowSchema.safeParse({ ...groupFixture, extra: true }).success).toBe(false);
  });

  it("owner_scope rejects a value outside tenant/partner/platform", () => {
    expect(supportGroupRowSchema.safeParse({ ...groupFixture, owner_scope: "bogus" }).success).toBe(
      false,
    );
  });

  it("tenant_id/partner_id are nullable", () => {
    expect(
      supportGroupRowSchema.safeParse({
        ...groupFixture,
        tenant_id: null,
        partner_id: "9a1b2c3d-0000-4000-8000-000000000099",
        owner_scope: "partner",
      }).success,
    ).toBe(true);
  });

  it("rank must be an integer", () => {
    expect(supportGroupRowSchema.safeParse({ ...groupFixture, rank: 1.5 }).success).toBe(false);
  });

  it("insert requires name and rank only", () => {
    expect(supportGroupInsertSchema.safeParse({ name: "Tier 1", rank: 1 }).success).toBe(true);
    expect(supportGroupInsertSchema.safeParse({ name: "Tier 1" }).success).toBe(false);
    expect(supportGroupInsertSchema.safeParse({ rank: 1 }).success).toBe(false);
  });

  it("update accepts partial patches and rejects unknown keys", () => {
    expect(supportGroupUpdateSchema.safeParse({ is_active: false }).success).toBe(true);
    expect(supportGroupUpdateSchema.safeParse({ nope: 1 }).success).toBe(false);
  });
});
