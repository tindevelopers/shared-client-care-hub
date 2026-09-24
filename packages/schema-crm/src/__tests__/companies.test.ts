import { describe, expect, it } from "vitest";
import { companyInsertSchema, companyRowSchema, companySizeSchema, companyUpdateSchema } from "../companies";

const NOW = "2026-09-24T10:00:00.000+00:00";

/** Ground-truth fixture: companies effective DDL (17 columns, 20251208000000). */
const companyFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000001",
  tenant_id: "9a1b2c3d-0000-4000-8000-000000000010",
  name: "Acme Corp",
  website: "https://acme.example.com",
  industry: "Software",
  size: "51-200",
  annual_revenue: 5000000,
  description: "Ground-truth fixture",
  address: { city: "London", country: "UK" },
  phone: "+15551230001",
  email: "info@acme.example.com",
  logo_url: "https://acme.example.com/logo.png",
  tags: ["vip"],
  custom_fields: { source: "seed" },
  created_by: "9a1b2c3d-0000-4000-8000-000000000012",
  created_at: NOW,
  updated_at: NOW,
};

describe("companies", () => {
  it("companies row round-trip (17 columns)", () => {
    expect(Object.keys(companyRowSchema.shape).sort()).toEqual(
      [
        "address",
        "annual_revenue",
        "created_at",
        "created_by",
        "custom_fields",
        "description",
        "email",
        "id",
        "industry",
        "logo_url",
        "name",
        "phone",
        "size",
        "tags",
        "tenant_id",
        "updated_at",
        "website",
      ].sort(),
    );
    const parsed = companyRowSchema.parse(companyFixture);
    expect(parsed).toEqual(companyFixture);
    expect(companyRowSchema.parse(parsed)).toEqual(parsed);
  });

  it("size enum accepts the six CHECK values and rejects others", () => {
    for (const value of ["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"]) {
      expect(companySizeSchema.safeParse(value).success).toBe(true);
    }
    expect(companySizeSchema.safeParse("huge").success).toBe(false);
    expect(companyRowSchema.safeParse({ ...companyFixture, size: null }).success).toBe(true);
  });

  it("rejects unknown keys (strict)", () => {
    expect(companyRowSchema.safeParse({ ...companyFixture, lifecycle_stage: "x" }).success).toBe(
      false,
    );
  });

  it("insert requires tenant_id/name and accepts the rest as optional", () => {
    expect(
      companyInsertSchema.safeParse({
        tenant_id: companyFixture.tenant_id,
        name: "Acme Corp",
      }).success,
    ).toBe(true);
    for (const required of ["tenant_id", "name"]) {
      const payload: Record<string, unknown> = {
        tenant_id: companyFixture.tenant_id,
        name: "Acme Corp",
      };
      delete payload[required];
      expect(companyInsertSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("update accepts partial patches and rejects unknown keys", () => {
    expect(companyUpdateSchema.safeParse({ name: "New name" }).success).toBe(true);
    expect(companyUpdateSchema.safeParse({ lifecycle_stage: "x" }).success).toBe(false);
  });
});
