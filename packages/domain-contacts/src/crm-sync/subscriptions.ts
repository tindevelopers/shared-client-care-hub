/**
 * CRM Sync — Event Bus Subscribers
 *
 * Registers subscribers on the event bus that drive contact sync to Brevo.
 * Each subscriber reads the EVENT_ACTION_MAP for the event type and calls
 * crmSyncService.syncContactFromEvent().
 *
 * Subscribers are registered once at app startup (imported as a side-effect
 * module in the admin app's instrumentation or layout).
 *
 * SAFETY:
 *   - Subscribers NEVER throw — syncContactFromEvent catches all errors.
 *   - One subscriber failure does not block others (event bus runs handlers
 *     independently via Promise.all).
 *   - Subscribers fire-and-forget the sync; they don't await the result
 *     (fast path out of the webhook/event source, slow sync async).
 *
 * Moved from apps/app/src/core/crm-sync/subscriptions.ts (byte-identical
 * apart from import specifiers and the injection-only adaptation): the host
 * app passes its service-role client here — `registerCrmSyncSubscribers({
 * client })` — and it flows through to every sync call.
 */
import "server-only";

import { eventBus } from "@tindevelopers/core-kernel/events/event-bus";
import { EVENT_ACTION_MAP } from "@tindevelopers/core-kernel/events/event-types";
import type { DomainEventType } from "@tindevelopers/core-kernel/events/event-types";
import { syncContactFromEvent } from "./crm-sync-service.js";
import type { CrmSyncDeps } from "./crm-sync-service.js";
import { createLogger } from "@tindevelopers/core-kernel/logger";

// Re-exported so the ./crm-sync subpath (this module) is the single seam for
// consumers needing direct access to the sync (e.g. the Brevo backfill route).
export { syncContactFromEvent } from "./crm-sync-service.js";

const log = createLogger("crm-sync/subscriptions");

// ──── Event types that trigger contact sync ─────────────────────────────

const SYNC_EVENT_TYPES: DomainEventType[] = (Object.keys(EVENT_ACTION_MAP) as DomainEventType[]).filter(
  (type) => {
    const action = EVENT_ACTION_MAP[type];
    return action?.syncContact != null && action.syncContact !== false;
  }
);

// ──── Subscription handler ──────────────────────────────────────────────

/** Deps captured at registration; flows to every sync call. */
let registeredDeps: CrmSyncDeps | undefined;

async function handleSyncEvent(event: any): Promise<void> {
  const eventType = event.type as DomainEventType;
  const tenantId = event.refs?.tenantId as string | undefined;
  const contactId = event.refs?.contactId as string | undefined;

  if (!tenantId || !contactId) {
    log.info("Event missing tenantId or contactId — skipping sync", {
      eventType,
      hasTenantId: !!tenantId,
      hasContactId: !!contactId,
    });
    return;
  }

  log.info("Syncing contact from event", {
    eventType,
    contactId: contactId.substring(0, 8),
    tenantId: tenantId.substring(0, 8),
  });

  // Fire-and-forget: don't await, don't block the event bus
  syncContactFromEvent(eventType, tenantId, contactId, registeredDeps).catch((err) => {
    log.error("Unhandled sync error (should not happen)", {
      eventType,
      contactId: contactId.substring(0, 8),
      error: String(err),
    });
  });
}

// ──── Register subscribers ──────────────────────────────────────────────

const unsubscribeFns: Array<() => void> = [];

export function registerCrmSyncSubscribers(deps?: CrmSyncDeps): void {
  if (unsubscribeFns.length > 0) {
    log.info("CRM sync subscribers already registered — skipping");
    return;
  }

  registeredDeps = deps;

  for (const eventType of SYNC_EVENT_TYPES) {
    const unsub = eventBus.subscribe(eventType, `crm-sync:${eventType}`, handleSyncEvent);
    unsubscribeFns.push(unsub);
  }

  log.info(`CRM sync subscribers registered for ${SYNC_EVENT_TYPES.length} event types`, {
    eventTypes: SYNC_EVENT_TYPES,
  });
}

/**
 * Unregister all CRM sync subscribers (useful for testing / hot reload).
 */
export function unregisterCrmSyncSubscribers(): void {
  for (const unsub of unsubscribeFns) {
    unsub();
  }
  unsubscribeFns.length = 0;
  registeredDeps = undefined;
  log.info("CRM sync subscribers unregistered");
}
