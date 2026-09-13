import { describe, expect, it } from "vitest";
import {
  contactInsertSchema,
  contactRowSchema,
  contactUpdateSchema,
} from "../contacts";

const NOW = "2026-09-13T10:00:00.000+00:00";
const uuid = () => "9a1b2c3d-0000-4000-8000-000000000001" as const;

/** Ground-truth fixture: exactly the 30 effective contacts columns (DDL part 1.1). */
const contactFixture = {
  id: uuid(),
  tenant_id: "9a1b2c3d-0000-4000-8000-000000000010",
  company_id: "9a1b2c3d-0000-4000-8000-000000000011",
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.com",
  phone: "+15551230001",
  mobile: "+15551230002",
  job_title: "Engineer",
  department: "Engineering",
  address: { city: "London", country: "UK" },
  avatar_url: "https://example.com/ada.png",
  tags: ["vip", "beta"],
  custom_fields: { source: "seed" },
  notes: "Ground-truth fixture row",
  created_by: "9a1b2c3d-0000-4000-8000-000000000012",
  created_at: NOW,
  updated_at: NOW,
  ghl_contact_id: "ghl_123",
  ghl_last_synced_at: NOW,
  sms_opt_out: false,
  email_opt_out: true,
  email_valid: true,
  phone_e164: "+15551230001",
  whatsapp_id: "15551230001",
  last_inbound_at: NOW,
  last_contacted_at: NOW,
  assigned_to: "9a1b2c3d-0000-4000-8000-000000000013",
  whatsapp_opt_out: false,
  dnc: false,
};

const CONTACT_COLUMNS_30 = [
  "address",
  "assigned_to",
  "avatar_url",
  "company_id",
  "created_at",
  "created_by",
  "custom_fields",
  "department",
  "dnc",
  "email",
  "email_opt_out",
  "email_valid",
  "first_name",
  "ghl_contact_id",
  "ghl_last_synced_at",
  "id",
  "job_title",
  "last_contacted_at",
  "last_inbound_at",
  "last_name",
  "mobile",
  "notes",
  "phone",
  "phone_e164",
  "sms_opt_out",
  "tags",
  "tenant_id",
  "updated_at",
  "whatsapp_id",
  "whatsapp_opt_out",
];

describe("contacts", () => {
  it("contacts row round-trip (30 columns)", () => {
    expect(Object.keys(contactRowSchema.shape).sort()).toEqual(CONTACT_COLUMNS_30);
    expect(Object.keys(contactRowSchema.shape)).toHaveLength(30);

    const parsed = contactRowSchema.parse(contactFixture);
    expect(parsed).toEqual(contactFixture);
    // Re-parse of the output stays deep-equal (round-trip stability).
    expect(contactRowSchema.parse(parsed)).toEqual(parsed);
  });

  it("rejects drift columns lifecycle_stage/score/do_not_contact", () => {
    for (const drift of ["lifecycle_stage", "score", "do_not_contact"]) {
      const result = contactRowSchema.safeParse({ ...contactFixture, [drift]: "x" });
      expect(result.success).toBe(false);
      if (!result.success) {
        // strict objects report unknown keys as an object-level unrecognized_keys issue
        const named = result.error.issues.some(
          (i) => i.path[0] === drift || (i.message.includes(drift) && i.path.length === 0),
        );
        expect(named).toBe(true);
      }
    }
  });

  it("row schema requires first_name/last_name (NOT NULL) and rejects null booleans", () => {
    const { first_name: _f, ...noFirstName } = contactFixture;
    expect(contactRowSchema.safeParse(noFirstName).success).toBe(false);
    expect(
      contactRowSchema.safeParse({ ...contactFixture, last_name: undefined }).success,
    ).toBe(false);
    expect(
      contactRowSchema.safeParse({ ...contactFixture, sms_opt_out: null }).success,
    ).toBe(false);
  });

  it("row schema parses a hosted-shaped 28-key row (ghl columns absent on hosted DB)", () => {
    const { ghl_contact_id: _g, ghl_last_synced_at: _gl, ...hostedShaped } = contactFixture;
    const parsed = contactRowSchema.parse(hostedShaped);
    expect(parsed).toEqual(hostedShaped);
    expect(Object.keys(parsed)).toHaveLength(28);
  });

  it("insert schema requires tenant_id/first_name/last_name and defaults-free optional columns", () => {
    expect(
      contactInsertSchema.safeParse({
        tenant_id: contactFixture.tenant_id,
        first_name: "Ada",
        last_name: "Lovelace",
      }).success,
    ).toBe(true);
    // full insert payload (W4 shape) parses
    expect(
      contactInsertSchema.safeParse({
        tenant_id: contactFixture.tenant_id,
        company_id: null,
        first_name: "Ada",
        last_name: "Lovelace",
        email: null,
        phone: null,
        mobile: null,
        job_title: null,
        department: null,
        address: {},
        avatar_url: null,
        tags: [],
        custom_fields: {},
        notes: null,
        created_by: null,
      }).success,
    ).toBe(true);
    for (const required of ["tenant_id", "first_name", "last_name"]) {
      const payload: Record<string, unknown> = {
        tenant_id: contactFixture.tenant_id,
        first_name: "Ada",
        last_name: "Lovelace",
      };
      delete payload[required];
      expect(contactInsertSchema.safeParse(payload).success).toBe(false);
    }
    expect(
      contactInsertSchema.safeParse({
        tenant_id: contactFixture.tenant_id,
        first_name: "Ada",
        last_name: "Lovelace",
        lifecycle_stage: "lead",
      }).success,
    ).toBe(false);
  });

  it("update schema accepts partial patches and rejects unknown keys", () => {
    expect(contactUpdateSchema.safeParse({ email: "new@example.com" }).success).toBe(true);
    expect(contactUpdateSchema.safeParse({ tags: ["a"] }).success).toBe(true);
    expect(contactUpdateSchema.safeParse({ lifecycle_stage: "lead" }).success).toBe(false);
    expect(contactUpdateSchema.safeParse({ sms_opt_out: null }).success).toBe(false);
  });
});
