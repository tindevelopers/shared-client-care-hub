import { describe, expect, it } from "vitest";
import {
  contactChannelInsertSchema,
  contactChannelRowSchema,
  contactChannelTypeSchema,
  contactChannelUpdateSchema,
} from "../contacts";

const NOW = "2026-09-13T10:00:00.000+00:00";

/** Ground-truth fixture: contact_channels DDL (20260615000001, lines 71-84). */
const channelFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000001",
  tenant_id: "9a1b2c3d-0000-4000-8000-000000000010",
  contact_id: "9a1b2c3d-0000-4000-8000-000000000011",
  channel: "sms",
  address: "+15551230001",
  normalized_address: "+15551230001",
  is_primary: true,
  metadata: { origin: "identity-resolver" },
  created_at: NOW,
  updated_at: NOW,
};

describe("contact_channels", () => {
  it("contact_channels row round-trip (10 columns)", () => {
    expect(Object.keys(contactChannelRowSchema.shape).sort()).toEqual(
      [
        "address",
        "channel",
        "contact_id",
        "created_at",
        "id",
        "is_primary",
        "metadata",
        "normalized_address",
        "tenant_id",
        "updated_at",
      ].sort(),
    );
    const parsed = contactChannelRowSchema.parse(channelFixture);
    expect(parsed).toEqual(channelFixture);
    expect(contactChannelRowSchema.parse(parsed)).toEqual(parsed);
  });

  it("contact_channels channel enum rejects invalid value", () => {
    expect(contactChannelTypeSchema.safeParse("carrier_pigeon").success).toBe(false);
    expect(contactChannelTypeSchema.safeParse("email").success).toBe(true);
    expect(
      contactChannelRowSchema.safeParse({ ...channelFixture, channel: "fax" }).success,
    ).toBe(false);
  });

  it("contact_channels insert requires the unique-triple and identity fields", () => {
    // unique triple per DDL constraint contact_channels_tenant_channel_addr_unique
    expect(
      contactChannelInsertSchema.safeParse({
        tenant_id: channelFixture.tenant_id,
        contact_id: channelFixture.contact_id,
        channel: "whatsapp",
        address: "+15551230001",
        normalized_address: "+15551230001",
      }).success,
    ).toBe(true);
    for (const required of ["tenant_id", "contact_id", "channel", "address", "normalized_address"]) {
      const payload: Record<string, unknown> = { ...channelFixture, id: undefined };
      delete payload[required];
      expect(contactChannelInsertSchema.safeParse(payload).success).toBe(false);
    }
    expect(
      contactChannelInsertSchema.safeParse({ ...channelFixture, bogus: true }).success,
    ).toBe(false);
  });

  it("contact_channels update accepts partial patches and rejects unknown keys", () => {
    expect(contactChannelUpdateSchema.safeParse({ is_primary: false }).success).toBe(true);
    expect(contactChannelUpdateSchema.safeParse({ is_primary: null }).success).toBe(false);
    expect(contactChannelUpdateSchema.safeParse({ lifecycle_stage: "lead" }).success).toBe(false);
  });
});
