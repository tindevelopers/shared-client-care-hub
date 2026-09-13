import { describe, expect, it } from "vitest";
import {
  campaignRecipientInsertSchema,
  campaignRecipientRowSchema,
  campaignRecipientStatusSchema,
  campaignRecipientUpdateSchema,
} from "../campaigns";

const NOW = "2026-09-13T10:00:00.000+00:00";

/** Ground-truth fixture: campaign_recipients effective DDL (31 columns). */
const recipientFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000001",
  tenant_id: "9a1b2c3d-0000-4000-8000-000000000010",
  campaign_id: "9a1b2c3d-0000-4000-8000-000000000011",
  list_id: null,
  contact_id: "9a1b2c3d-0000-4000-8000-000000000012",
  first_name: "Ada",
  last_name: "Lovelace",
  phone: "+15551230001",
  email: "ada@example.com",
  timezone: "America/New_York",
  client_type: "smb",
  custom_fields: { source: "csv" },
  status: "scheduled",
  scheduled_at: NOW,
  attempts: 0,
  last_attempt_at: null,
  completed_at: null,
  call_control_id: null,
  conversation_id: null,
  result: {},
  created_at: NOW,
  updated_at: NOW,
  conversation_status: "not_started",
  last_turn_at: null,
  turn_count: 0,
  sms_opt_out: false,
  retry_attempts: 0,
  last_inbound_at: null,
  provider_recipient_id: "brevo-r-1",
  provider_message_id: null,
  engagement: { opens: 1, clicks: 0 },
};

describe("campaign_recipients", () => {
  it("campaign_recipients row round-trip (31 columns)", () => {
    expect(Object.keys(campaignRecipientRowSchema.shape).sort()).toEqual(
      [
        "attempts",
        "call_control_id",
        "campaign_id",
        "client_type",
        "completed_at",
        "contact_id",
        "conversation_id",
        "conversation_status",
        "created_at",
        "custom_fields",
        "email",
        "engagement",
        "first_name",
        "id",
        "last_attempt_at",
        "last_inbound_at",
        "last_name",
        "last_turn_at",
        "list_id",
        "phone",
        "provider_message_id",
        "provider_recipient_id",
        "result",
        "retry_attempts",
        "scheduled_at",
        "sms_opt_out",
        "status",
        "tenant_id",
        "timezone",
        "turn_count",
        "updated_at",
      ].sort(),
    );
    const parsed = campaignRecipientRowSchema.parse(recipientFixture);
    expect(parsed).toEqual(recipientFixture);
    expect(campaignRecipientRowSchema.parse(parsed)).toEqual(parsed);
  });

  it("campaign_recipients status enum rejects invalid value", () => {
    expect(campaignRecipientStatusSchema.safeParse("voicemail").success).toBe(true);
    expect(campaignRecipientStatusSchema.safeParse("bounced").success).toBe(false);
    expect(
      campaignRecipientRowSchema.safeParse({ ...recipientFixture, status: "queued" }).success,
    ).toBe(false);
  });

  it("campaign_recipients insert requires tenant_id/campaign_id/first_name/phone", () => {
    expect(
      campaignRecipientInsertSchema.safeParse({
        tenant_id: recipientFixture.tenant_id,
        campaign_id: recipientFixture.campaign_id,
        first_name: "Ada",
        phone: "+15551230001",
      }).success,
    ).toBe(true);
    for (const required of ["tenant_id", "campaign_id", "first_name", "phone"]) {
      const payload: Record<string, unknown> = {
        tenant_id: recipientFixture.tenant_id,
        campaign_id: recipientFixture.campaign_id,
        first_name: "Ada",
        phone: "+15551230001",
      };
      delete payload[required];
      expect(campaignRecipientInsertSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("campaign_recipients update accepts partial patches and rejects unknown keys", () => {
    expect(campaignRecipientUpdateSchema.safeParse({ status: "completed" }).success).toBe(true);
    expect(campaignRecipientUpdateSchema.safeParse({ bounce: true }).success).toBe(false);
  });
});
