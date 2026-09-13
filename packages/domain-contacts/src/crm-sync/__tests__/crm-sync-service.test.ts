/**
 * CRM Sync Service Unit Tests
 *
 * Tests the public API surface of crmSyncService without requiring
 * live Supabase or Brevo credentials.  Full integration tests (hash-skip,
 * multi-tenant isolation, provider error resilience) are exercised in
 * __tests__/crm-sync-integration.test.ts with mocked dependencies.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  syncContactFromEvent,
  clearProviderCache,
} from "../crm-sync-service";
import { createMockSupabase } from "../../__tests__/helpers/mock-supabase.js";

// Hub-added mocks (VAL-CONTACTS-019): the hash-guard characterization below
// needs a working provider + decrypted credentials without live Brevo/DB.
// The three original tests above never reach provider resolution, so these
// mocks are inert for them.
const upsertContactMock = vi.hoisted(() => vi.fn(async () => "brevo-123456"));
vi.mock("@tindevelopers/adapter-kit/brevo/brevo-contacts-provider", () => ({
  BrevoContactsProvider: class {
    initialize = vi.fn(async () => {});
    upsertContact = upsertContactMock;
  },
}));
vi.mock("@tindevelopers/core-kernel/integrations/crypto", () => ({
  decryptIntegrationCredentials: () => ({ apiKey: "test-api-key" }),
}));

describe("crmSyncService", () => {
  beforeEach(() => {
    clearProviderCache();
    vi.stubEnv("BREVO_CONTACT_SYNC_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ── Feature flag ──────────────────────────────────────────────────────

  it("skips sync when BREVO_CONTACT_SYNC_ENABLED is not true", async () => {
    vi.stubEnv("BREVO_CONTACT_SYNC_ENABLED", "false");
    const result = await syncContactFromEvent(
      "contact.created",
      "tenant_abc",
      "contact_123"
    );
    expect(result.action).toBe("skipped_disabled");
  });

  // ── EVENT_ACTION_MAP gate ───────────────────────────────────────────────

  it("skips sync for events not in EVENT_ACTION_MAP", async () => {
    const result = await syncContactFromEvent(
      "tenant.created" as any,
      "tenant_abc",
      "contact_123"
    );
    expect(result.action).toBe("skipped_noop");
  });

  it("skips sync for events with syncContact=false", async () => {
    // message.sent has no syncContact action
    const result = await syncContactFromEvent(
      "message.sent" as any,
      "tenant_abc",
      "contact_123"
    );
    expect(result.action).toBe("skipped_noop");
  });

  // Hub-added characterization (VAL-CONTACTS-019): the hash-guard skip —
  // identical projection hash → no provider call, no sync_state write.
  it("skipped_noop on identical projection hash — no provider call, no sync_state write", async () => {
    const contactRow = {
      id: "contact_123",
      tenant_id: "tenant_abc",
      email: "hash@example.com",
      first_name: "Hash",
      last_name: "Guard",
      custom_fields: {},
      sms_opt_out: false,
    };

    // Run 1 — no prior sync_state: full sync path.
    // Queue order = await order: connection, secrets, mappings, contact
    // read, sync_state read (none), then the sync_state upsert records the
    // computed hash.
    const run1 = createMockSupabase([
      { data: { id: "conn-1", metadata: {} } },
      { data: { secrets_ciphertext: "x", secrets_iv: "i", secrets_tag: "t" } },
      { data: [] },
      { data: contactRow },
      { data: null },
    ]);
    const first = await syncContactFromEvent(
      "contact.created",
      "tenant_abc",
      "contact_123",
      { client: run1.client },
    );
    expect(first.action).toBe("upserted");
    expect(upsertContactMock).toHaveBeenCalledTimes(1);
    const upsertCall = run1.calls.find((c) => c.op === "upsert");
    expect(upsertCall).toBeDefined();
    const savedHash = (
      (upsertCall!.args[0] as { metadata: { hash?: string } }).metadata ?? {}
    ).hash;
    expect(savedHash).toMatch(/^[0-9a-f]{64}$/);

    // Run 2 — same contact, provider cached (connection/secrets/mappings are
    // NOT re-read), sync_state now carries the identical hash: no provider
    // call, no sync_state write, action skipped_noop.
    upsertContactMock.mockClear();
    const run2 = createMockSupabase([
      { data: contactRow },
      { data: { metadata: { hash: savedHash } } },
    ]);
    const second = await syncContactFromEvent(
      "contact.created",
      "tenant_abc",
      "contact_123",
      { client: run2.client },
    );
    expect(second.action).toBe("skipped_noop");
    expect(upsertContactMock).not.toHaveBeenCalled();
    expect(run2.calls.filter((c) => c.op === "upsert")).toHaveLength(0);
  });
});
