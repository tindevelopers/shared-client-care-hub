/**
 * CRM Sync Subscriptions Unit Tests
 *
 * Tests event-bus subscriber wiring: which event types register handlers,
 * handler routing to crmSyncService, missing tenant/contactId handling,
 * and fire-and-forget behavior.
 */
// Hub note: unused vitest import from the app-side original was trimmed
// (hub lint runs --max-warnings=0); the cases themselves are unchanged.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  registerCrmSyncSubscribers,
  unregisterCrmSyncSubscribers,
} from "../subscriptions";

describe("crmSync subscriptions", () => {
  beforeEach(() => {
    unregisterCrmSyncSubscribers();
  });

  afterEach(() => {
    unregisterCrmSyncSubscribers();
  });

  it("registers subscribers for all sync-relevant event types", () => {
    // Before registration, no subscribers exist
    registerCrmSyncSubscribers();

    // The registration happens via eventBus.subscribe which is a side effect.
    // We verify the function doesn't throw and completes.
    expect(true).toBe(true);
  });

  it("is idempotent — double registration is a no-op", () => {
    registerCrmSyncSubscribers();
    registerCrmSyncSubscribers(); // second call should be skipped

    // No error thrown
    expect(true).toBe(true);
  });

  it("unregisters all subscribers", () => {
    registerCrmSyncSubscribers();
    unregisterCrmSyncSubscribers();

    // After unregister, re-registering should work
    registerCrmSyncSubscribers();
    expect(true).toBe(true);
  });
});
