import { describe, expect, it } from "vitest";
import {
  brevoWebhookEventInsertSchema,
  brevoWebhookEventRowSchema,
  brevoWebhookEventUpdateSchema,
} from "../brevo-webhook-events";

const NOW = "2026-09-24T10:00:00.000+00:00";

/** Ground-truth fixture: brevo_webhook_events effective DDL (12 columns, 20260614230000). */
const brevoWebhookEventFixture = {
  id: "9a1b2c3d-0000-4000-8000-0000000000b0",
  tenant_id: "9a1b2c3d-0000-4000-8000-000000000010",
  connection_id: "9a1b2c3d-0000-4000-8000-0000000000c0",
  event_type: "delivered",
  external_event_id: "brevo-evt-1",
  payload: { messageId: "brevo-evt-1", email: "a@example.com" },
  processed: false,
  processed_at: null,
  retry_count: 0,
  error: null,
  received_at: NOW,
  created_at: NOW,
};

describe("brevo_webhook_events", () => {
  it("brevo_webhook_events row round-trip (12 columns)", () => {
    expect(Object.keys(brevoWebhookEventRowSchema.shape).sort()).toEqual(
      [
        "connection_id",
        "created_at",
        "error",
        "event_type",
        "external_event_id",
        "id",
        "payload",
        "processed",
        "processed_at",
        "received_at",
        "retry_count",
        "tenant_id",
      ].sort(),
    );
    const parsed = brevoWebhookEventRowSchema.parse(brevoWebhookEventFixture);
    expect(parsed).toEqual(brevoWebhookEventFixture);
  });

  it("payload is NOT NULL (unlike most other JSONB columns in this package)", () => {
    expect(
      brevoWebhookEventRowSchema.safeParse({ ...brevoWebhookEventFixture, payload: null }).success,
    ).toBe(false);
  });

  it("processed/retry_count are NOT NULL; tenant_id/connection_id are nullable", () => {
    expect(
      brevoWebhookEventRowSchema.safeParse({ ...brevoWebhookEventFixture, processed: null })
        .success,
    ).toBe(false);
    expect(
      brevoWebhookEventRowSchema.safeParse({ ...brevoWebhookEventFixture, retry_count: null })
        .success,
    ).toBe(false);
    expect(
      brevoWebhookEventRowSchema.safeParse({ ...brevoWebhookEventFixture, tenant_id: null })
        .success,
    ).toBe(true);
  });

  it("insert requires event_type/external_event_id/payload", () => {
    expect(
      brevoWebhookEventInsertSchema.safeParse({
        event_type: "delivered",
        external_event_id: "brevo-evt-2",
        payload: {},
      }).success,
    ).toBe(true);
    for (const required of ["event_type", "external_event_id", "payload"]) {
      const payload: Record<string, unknown> = {
        event_type: "delivered",
        external_event_id: "brevo-evt-2",
        payload: {},
      };
      delete payload[required];
      expect(brevoWebhookEventInsertSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("update accepts partial patches and rejects unknown keys", () => {
    expect(brevoWebhookEventUpdateSchema.safeParse({ processed: true }).success).toBe(true);
    expect(brevoWebhookEventUpdateSchema.safeParse({ archived: true }).success).toBe(false);
  });
});
