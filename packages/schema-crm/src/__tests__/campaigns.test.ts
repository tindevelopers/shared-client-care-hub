import { describe, expect, it } from "vitest";
import {
  campaignInsertSchema,
  campaignRowSchema,
  campaignStatusSchema,
  campaignTypeSchema,
  campaignUpdateSchema,
} from "../campaigns";

const NOW = "2026-09-13T10:00:00.000+00:00";

/** Ground-truth fixture: campaigns effective DDL (32 columns, parts 1.3). */
const campaignFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000001",
  tenant_id: "9a1b2c3d-0000-4000-8000-000000000010",
  name: "Q3 outreach",
  description: "Ground-truth fixture",
  status: "scheduled",
  campaign_type: "email",
  assistant_id: "asst_123",
  from_number: "+15551230001",
  message_template: "Hi {{first_name}}",
  schedule_start: NOW,
  schedule_end: NOW,
  calling_window_start: "09:00:00",
  calling_window_end: "20:00:00",
  calling_days: [1, 2, 3, 4, 5],
  max_attempts: 3,
  retry_delay_minutes: 60,
  max_concurrent_calls: 5,
  calls_per_minute: 10,
  settings: { senderName: "Konnect" },
  created_by: "9a1b2c3d-0000-4000-8000-000000000012",
  created_at: NOW,
  updated_at: NOW,
  deleted_at: null,
  timezone: "America/New_York",
  max_conversation_turns: 10,
  no_reply_timeout_minutes: 120,
  max_sends_per_recipient: 50,
  global_send_rate_per_minute: 60,
  provider: "brevo",
  provider_campaign_id: "brevo-c-1",
  template_ref: "tmpl-42",
  segment_ref: "seg-vip",
};

describe("campaigns", () => {
  it("campaigns row round-trip (32 columns)", () => {
    expect(Object.keys(campaignRowSchema.shape).sort()).toEqual(
      [
        "assistant_id",
        "calls_per_minute",
        "calling_days",
        "calling_window_end",
        "calling_window_start",
        "campaign_type",
        "created_at",
        "created_by",
        "deleted_at",
        "description",
        "from_number",
        "global_send_rate_per_minute",
        "id",
        "max_attempts",
        "max_conversation_turns",
        "max_concurrent_calls",
        "max_sends_per_recipient",
        "message_template",
        "name",
        "no_reply_timeout_minutes",
        "provider",
        "provider_campaign_id",
        "retry_delay_minutes",
        "schedule_end",
        "schedule_start",
        "segment_ref",
        "settings",
        "status",
        "template_ref",
        "tenant_id",
        "timezone",
        "updated_at",
      ].sort(),
    );
    const parsed = campaignRowSchema.parse(campaignFixture);
    expect(parsed).toEqual(campaignFixture);
    expect(campaignRowSchema.parse(parsed)).toEqual(parsed);
  });

  it("campaigns campaign_type accepts 'email'", () => {
    expect(campaignTypeSchema.safeParse("email").success).toBe(true);
    expect(campaignTypeSchema.safeParse("voice").success).toBe(true);
    expect(campaignTypeSchema.safeParse("multi_channel").success).toBe(true);
  });

  it("campaigns campaign_type enum rejects invalid value", () => {
    expect(campaignTypeSchema.safeParse("email2").success).toBe(false);
    expect(
      campaignRowSchema.safeParse({ ...campaignFixture, campaign_type: "push" }).success,
    ).toBe(false);
  });

  it("campaigns status enum rejects invalid value", () => {
    expect(campaignStatusSchema.safeParse("draft").success).toBe(true);
    expect(campaignStatusSchema.parse("sent")).toBe("sent");
    expect(campaignStatusSchema.safeParse("archived").success).toBe(false);
    expect(campaignRowSchema.safeParse({ ...campaignFixture, status: "paused" }).success).toBe(true);
    expect(
      campaignRowSchema.safeParse({ ...campaignFixture, status: "finished" }).success,
    ).toBe(false);
  });

  it("campaigns insert requires tenant_id/name/campaign_type", () => {
    expect(
      campaignInsertSchema.safeParse({
        tenant_id: campaignFixture.tenant_id,
        name: "Q4 outreach",
        campaign_type: "voice",
      }).success,
    ).toBe(true);
    for (const required of ["tenant_id", "name", "campaign_type"]) {
      const payload: Record<string, unknown> = {
        tenant_id: campaignFixture.tenant_id,
        name: "Q4 outreach",
        campaign_type: "voice",
      };
      delete payload[required];
      expect(campaignInsertSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("campaigns update accepts partial patches and rejects unknown keys", () => {
    expect(campaignUpdateSchema.safeParse({ status: "running" }).success).toBe(true);
    expect(campaignUpdateSchema.safeParse({ soft_delete: true }).success).toBe(false);
    expect(campaignUpdateSchema.safeParse({ max_attempts: null }).success).toBe(true);
  });
});
