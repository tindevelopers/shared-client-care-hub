import { describe, expect, it } from "vitest";
import {
  dealInsertSchema,
  dealRowSchema,
  dealStageInsertSchema,
  dealStageRowSchema,
  dealStageUpdateSchema,
  dealUpdateSchema,
} from "../deals";

const NOW = "2026-09-24T10:00:00.000+00:00";

/** Ground-truth fixture: deal_stages effective DDL (7 columns, 20251208000000). */
const dealStageFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000020",
  tenant_id: "9a1b2c3d-0000-4000-8000-000000000010",
  name: "Qualified",
  position: 1,
  color: "#60a5fa",
  is_closed: false,
  created_at: NOW,
};

/** Ground-truth fixture: deals effective DDL (17 columns, 20251208000000). */
const dealFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000021",
  tenant_id: "9a1b2c3d-0000-4000-8000-000000000010",
  contact_id: "9a1b2c3d-0000-4000-8000-000000000030",
  company_id: "9a1b2c3d-0000-4000-8000-000000000001",
  name: "Acme renewal",
  stage_id: dealStageFixture.id,
  value: 12000,
  currency: "USD",
  probability: 60,
  expected_close_date: "2026-12-01",
  actual_close_date: null,
  description: "Ground-truth fixture",
  tags: ["renewal"],
  custom_fields: { source: "seed" },
  created_by: "9a1b2c3d-0000-4000-8000-000000000012",
  assigned_to: "9a1b2c3d-0000-4000-8000-000000000013",
  created_at: NOW,
  updated_at: NOW,
};

describe("deal_stages", () => {
  it("deal_stages row round-trip (7 columns)", () => {
    expect(Object.keys(dealStageRowSchema.shape).sort()).toEqual(
      ["color", "created_at", "id", "is_closed", "name", "position", "tenant_id"].sort(),
    );
    const parsed = dealStageRowSchema.parse(dealStageFixture);
    expect(parsed).toEqual(dealStageFixture);
  });

  it("insert requires tenant_id/name", () => {
    expect(
      dealStageInsertSchema.safeParse({
        tenant_id: dealStageFixture.tenant_id,
        name: "Lead",
      }).success,
    ).toBe(true);
    expect(dealStageInsertSchema.safeParse({ name: "Lead" }).success).toBe(false);
  });

  it("update accepts partial patches and rejects unknown keys", () => {
    expect(dealStageUpdateSchema.safeParse({ position: 2 }).success).toBe(true);
    expect(dealStageUpdateSchema.safeParse({ archived: true }).success).toBe(false);
  });
});

describe("deals", () => {
  it("deals row round-trip (17 columns)", () => {
    expect(Object.keys(dealRowSchema.shape).sort()).toEqual(
      [
        "actual_close_date",
        "assigned_to",
        "company_id",
        "contact_id",
        "created_at",
        "created_by",
        "currency",
        "custom_fields",
        "description",
        "expected_close_date",
        "id",
        "name",
        "probability",
        "stage_id",
        "tags",
        "tenant_id",
        "updated_at",
        "value",
      ].sort(),
    );
    const parsed = dealRowSchema.parse(dealFixture);
    expect(parsed).toEqual(dealFixture);
  });

  it("probability CHECK (0-100) is enforced", () => {
    expect(dealRowSchema.safeParse({ ...dealFixture, probability: 0 }).success).toBe(true);
    expect(dealRowSchema.safeParse({ ...dealFixture, probability: 100 }).success).toBe(true);
    expect(dealRowSchema.safeParse({ ...dealFixture, probability: 101 }).success).toBe(false);
    expect(dealRowSchema.safeParse({ ...dealFixture, probability: -1 }).success).toBe(false);
    expect(dealRowSchema.safeParse({ ...dealFixture, probability: null }).success).toBe(true);
  });

  it("insert requires tenant_id/name/stage_id", () => {
    expect(
      dealInsertSchema.safeParse({
        tenant_id: dealFixture.tenant_id,
        name: "Acme renewal",
        stage_id: dealStageFixture.id,
      }).success,
    ).toBe(true);
    for (const required of ["tenant_id", "name", "stage_id"]) {
      const payload: Record<string, unknown> = {
        tenant_id: dealFixture.tenant_id,
        name: "Acme renewal",
        stage_id: dealStageFixture.id,
      };
      delete payload[required];
      expect(dealInsertSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("update accepts partial patches and rejects unknown keys", () => {
    expect(dealUpdateSchema.safeParse({ value: 15000 }).success).toBe(true);
    expect(dealUpdateSchema.safeParse({ pipeline: "x" }).success).toBe(false);
  });
});
