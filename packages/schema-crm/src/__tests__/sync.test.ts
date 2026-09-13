import { describe, expect, it } from "vitest";
import {
  contactSyncActionSchema,
  contactSyncDirectionSchema,
  contactSyncLogInsertSchema,
  contactSyncLogRowSchema,
  contactSyncLogUpdateSchema,
  fieldMappingConflictPolicySchema,
  fieldMappingDirectionSchema,
  fieldMappingEntitySchema,
  fieldMappingInsertSchema,
  fieldMappingRowSchema,
  fieldMappingUpdateSchema,
  syncDirectionSchema,
  syncEntityTypeSchema,
  syncStateInsertSchema,
  syncStateRowSchema,
  syncStateUpdateSchema,
} from "../sync";

const NOW = "2026-09-13T10:00:00.000+00:00";
const TENANT = "9a1b2c3d-0000-4000-8000-000000000010";

/** Ground-truth fixture: contact_sync_log DDL (20260320100000). */
const syncLogFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000001",
  tenant_id: TENANT,
  direction: "inbound",
  konnect_contact_id: "9a1b2c3d-0000-4000-8000-000000000011",
  ghl_contact_id: "ghl_123",
  action: "updated",
  error_message: null,
  synced_at: NOW,
};

/** Ground-truth fixture: sync_state DDL (20260603120000). */
const syncStateFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000002",
  tenant_id: TENANT,
  entity_type: "contact",
  entity_id: "9a1b2c3d-0000-4000-8000-000000000011",
  provider_slug: "brevo",
  last_synced_at: NOW,
  last_sync_direction: "out",
  conflict_flag: false,
  metadata: { hash: "abc123", brevoId: "42" },
  created_at: NOW,
  updated_at: NOW,
};

/** Ground-truth fixture: field_mappings DDL (20260603120000). */
const fieldMappingFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000003",
  tenant_id: TENANT,
  provider_slug: "brevo",
  entity: "contact",
  internal_field: "email",
  external_field: "EMAIL",
  direction: "bidirectional",
  conflict_policy: "newest_wins",
  created_at: NOW,
  updated_at: NOW,
};

describe("contact_sync_log", () => {
  it("contact_sync_log row round-trip (8 columns)", () => {
    expect(Object.keys(contactSyncLogRowSchema.shape).sort()).toEqual(
      [
        "action",
        "direction",
        "error_message",
        "ghl_contact_id",
        "id",
        "konnect_contact_id",
        "synced_at",
        "tenant_id",
      ].sort(),
    );
    const parsed = contactSyncLogRowSchema.parse(syncLogFixture);
    expect(parsed).toEqual(syncLogFixture);
    expect(contactSyncLogRowSchema.parse(parsed)).toEqual(parsed);
    // tenant_id is nullable per DDL
    expect(
      contactSyncLogRowSchema.safeParse({ ...syncLogFixture, tenant_id: null }).success,
    ).toBe(true);
  });

  it("contact_sync_log direction/action enums reject invalid values", () => {
    expect(contactSyncDirectionSchema.safeParse("inbound").success).toBe(true);
    expect(contactSyncDirectionSchema.safeParse("bi").success).toBe(false);
    expect(contactSyncActionSchema.safeParse("deleted").success).toBe(false);
    expect(
      contactSyncLogRowSchema.safeParse({ ...syncLogFixture, direction: "up" }).success,
    ).toBe(false);
    expect(
      contactSyncLogRowSchema.safeParse({ ...syncLogFixture, action: "merged" }).success,
    ).toBe(false);
  });

  it("contact_sync_log insert requires direction/action only", () => {
    expect(contactSyncLogInsertSchema.safeParse({ direction: "outbound", action: "created" }).success).toBe(true);
    expect(contactSyncLogInsertSchema.safeParse({ direction: "outbound" }).success).toBe(false);
    expect(
      contactSyncLogInsertSchema.safeParse({ direction: "outbound", action: "created", nope: 1 }).success,
    ).toBe(false);
  });

  it("contact_sync_log update accepts partial patches and rejects unknown keys", () => {
    expect(contactSyncLogUpdateSchema.safeParse({ error_message: "boom" }).success).toBe(true);
    expect(contactSyncLogUpdateSchema.safeParse({ wat: 1 }).success).toBe(false);
  });
});

describe("sync_state", () => {
  it("sync_state row round-trip (11 columns)", () => {
    expect(Object.keys(syncStateRowSchema.shape).sort()).toEqual(
      [
        "conflict_flag",
        "created_at",
        "entity_id",
        "entity_type",
        "id",
        "last_sync_direction",
        "last_synced_at",
        "metadata",
        "provider_slug",
        "tenant_id",
        "updated_at",
      ].sort(),
    );
    const parsed = syncStateRowSchema.parse(syncStateFixture);
    expect(parsed).toEqual(syncStateFixture);
    expect(syncStateRowSchema.parse(parsed)).toEqual(parsed);
    // metadata is NOT NULL DEFAULT '{}' — null rejected on rows
    expect(syncStateRowSchema.safeParse({ ...syncStateFixture, metadata: null }).success).toBe(false);
  });

  it("sync_state entity_type/last_sync_direction enums reject invalid values", () => {
    expect(syncEntityTypeSchema.safeParse("deal").success).toBe(true);
    expect(syncEntityTypeSchema.safeParse("campaign").success).toBe(false);
    expect(syncDirectionSchema.safeParse("in").success).toBe(true);
    expect(syncDirectionSchema.safeParse("inbound").success).toBe(false);
    expect(
      syncStateRowSchema.safeParse({ ...syncStateFixture, last_sync_direction: "both" }).success,
    ).toBe(false);
  });

  it("sync_state insert tolerates omitted metadata (DB default {})", () => {
    const result = syncStateInsertSchema.safeParse({
      tenant_id: TENANT,
      entity_type: "contact",
      entity_id: "9a1b2c3d-0000-4000-8000-000000000011",
      provider_slug: "brevo",
    });
    expect(result.success).toBe(true);
    for (const required of ["tenant_id", "entity_type", "entity_id", "provider_slug"]) {
      const payload: Record<string, unknown> = {
        tenant_id: TENANT,
        entity_type: "contact",
        entity_id: "9a1b2c3d-0000-4000-8000-000000000011",
        provider_slug: "brevo",
      };
      delete payload[required];
      expect(syncStateInsertSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("sync_state update accepts partial patches and rejects unknown keys", () => {
    expect(syncStateUpdateSchema.safeParse({ conflict_flag: true }).success).toBe(true);
    expect(syncStateUpdateSchema.safeParse({ hash: "x" }).success).toBe(false);
  });
});

describe("field_mappings", () => {
  it("field_mappings row round-trip (10 columns)", () => {
    expect(Object.keys(fieldMappingRowSchema.shape).sort()).toEqual(
      [
        "conflict_policy",
        "created_at",
        "direction",
        "entity",
        "external_field",
        "id",
        "internal_field",
        "provider_slug",
        "tenant_id",
        "updated_at",
      ].sort(),
    );
    const parsed = fieldMappingRowSchema.parse(fieldMappingFixture);
    expect(parsed).toEqual(fieldMappingFixture);
    expect(fieldMappingRowSchema.parse(parsed)).toEqual(parsed);
  });

  it("field_mappings entity/direction/conflict_policy enums reject invalid values", () => {
    expect(fieldMappingEntitySchema.safeParse("company").success).toBe(true);
    expect(fieldMappingEntitySchema.safeParse("note").success).toBe(false);
    expect(fieldMappingDirectionSchema.safeParse("bidirectional").success).toBe(true);
    expect(fieldMappingDirectionSchema.safeParse("both").success).toBe(false);
    expect(fieldMappingConflictPolicySchema.safeParse("newest_wins").success).toBe(true);
    expect(fieldMappingConflictPolicySchema.safeParse("oldest_wins").success).toBe(false);
    expect(
      fieldMappingRowSchema.safeParse({ ...fieldMappingFixture, conflict_policy: "merge" }).success,
    ).toBe(false);
  });

  it("field_mappings insert requires the unique-key fields plus external_field", () => {
    expect(
      fieldMappingInsertSchema.safeParse({
        tenant_id: TENANT,
        provider_slug: "brevo",
        entity: "contact",
        internal_field: "email",
        external_field: "EMAIL",
      }).success,
    ).toBe(true);
    for (const required of ["tenant_id", "provider_slug", "entity", "internal_field", "external_field"]) {
      const payload: Record<string, unknown> = {
        tenant_id: TENANT,
        provider_slug: "brevo",
        entity: "contact",
        internal_field: "email",
        external_field: "EMAIL",
      };
      delete payload[required];
      expect(fieldMappingInsertSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("field_mappings update accepts partial patches and rejects unknown keys", () => {
    expect(fieldMappingUpdateSchema.safeParse({ external_field: "MAIL" }).success).toBe(true);
    expect(fieldMappingUpdateSchema.safeParse({ mapping: "x" }).success).toBe(false);
  });
});
