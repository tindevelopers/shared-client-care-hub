import { describe, expect, it } from "vitest";
import {
  campaignEventInsertSchema,
  campaignEventRowSchema,
  campaignEventUpdateSchema,
} from "../campaign-events";

const NOW = "2026-09-24T10:00:00.000+00:00";

/** Ground-truth fixture: campaign_events effective DDL (7 columns, 20260210000000). */
const campaignEventFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000090",
  tenant_id: "9a1b2c3d-0000-4000-8000-000000000010",
  campaign_id: "9a1b2c3d-0000-4000-8000-000000000080",
  recipient_id: "9a1b2c3d-0000-4000-8000-0000000000a0",
  event_type: "call_answered",
  channel: "voice",
  payload: { durationSeconds: 42 },
  created_at: NOW,
};

describe("campaign_events", () => {
  it("campaign_events row round-trip (7 columns)", () => {
    expect(Object.keys(campaignEventRowSchema.shape).sort()).toEqual(
      [
        "campaign_id",
        "channel",
        "created_at",
        "event_type",
        "id",
        "payload",
        "recipient_id",
        "tenant_id",
      ].sort(),
    );
    const parsed = campaignEventRowSchema.parse(campaignEventFixture);
    expect(parsed).toEqual(campaignEventFixture);
  });

  it("event_type/channel are plain text (no CHECK) — any string parses, non-strings don't", () => {
    expect(
      campaignEventRowSchema.safeParse({ ...campaignEventFixture, event_type: "anything" })
        .success,
    ).toBe(true);
    expect(
      campaignEventRowSchema.safeParse({ ...campaignEventFixture, event_type: 123 }).success,
    ).toBe(false);
    expect(campaignEventRowSchema.safeParse({ ...campaignEventFixture, channel: null }).success).toBe(
      true,
    );
  });

  it("event_type is NOT NULL; recipient_id/channel are nullable", () => {
    expect(
      campaignEventRowSchema.safeParse({ ...campaignEventFixture, event_type: null }).success,
    ).toBe(false);
    expect(
      campaignEventRowSchema.safeParse({ ...campaignEventFixture, recipient_id: null }).success,
    ).toBe(true);
  });

  it("insert requires tenant_id/campaign_id/event_type", () => {
    expect(
      campaignEventInsertSchema.safeParse({
        tenant_id: campaignEventFixture.tenant_id,
        campaign_id: campaignEventFixture.campaign_id,
        event_type: "call_answered",
      }).success,
    ).toBe(true);
    for (const required of ["tenant_id", "campaign_id", "event_type"]) {
      const payload: Record<string, unknown> = {
        tenant_id: campaignEventFixture.tenant_id,
        campaign_id: campaignEventFixture.campaign_id,
        event_type: "call_answered",
      };
      delete payload[required];
      expect(campaignEventInsertSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("update accepts partial patches and rejects unknown keys", () => {
    expect(campaignEventUpdateSchema.safeParse({ channel: "sms" }).success).toBe(true);
    expect(campaignEventUpdateSchema.safeParse({ archived: true }).success).toBe(false);
  });
});
