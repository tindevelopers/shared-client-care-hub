/**
 * Suppression Subscriber — Platform-wide opt-out enforcement
 *
 * Listens for contact.unsubscribed and message.bounced events.
 * On unsubscribe / hard-bounce / spam:
 *   1. Sets contacts.email_opt_out = true (tenant-scoped).
 *   2. Emits contact.unsubscribed (if not already the source event).
 *   3. Ensures all send paths (Phase 1 email send, Phase 4 campaigns)
 *      check the flag before sending.
 *
 * Suppression semantics:
 *   - Once opted out, stays out until an explicit opt-in (monotonic).
 *   - soft_bounce → timeline only (no suppression).
 *   - hard_bounce / blocked / spam / complaint → suppress + mark email invalid.
 *   - Mirrors the platform-wide SMS opt-out pattern.
 *
 * Moved from apps/app/src/core/suppression/suppression-subscriber.ts
 * (byte-identical apart from import specifiers and the injection-only
 * adaptation): the app's internally constructed service-role client is
 * replaced by one injected at registration — domain packages never
 * construct clients (injection-only hub boundary rule).
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { eventBus, emit } from "@tindevelopers/core-kernel/events";
import type { TypedDomainEvent, MessageEventData, ContactUnsubscribedData } from "@tindevelopers/core-kernel/events/event-types";
import { createLogger } from "@tindevelopers/core-kernel/logger";

const log = createLogger('suppression/subscriber');

/** Injected dependencies — the host app supplies its service-role client. */
export interface SuppressionSubscriberDeps {
  client: SupabaseClient;
}

/** Client injected at registration; null until `registerSuppressionSubscribers`. */
let injectedClient: SupabaseClient | null = null;

// ── contact.unsubscribed handler ────────────────────────────────────────────

async function onUnsubscribed(event: TypedDomainEvent<'contact.unsubscribed'>): Promise<void> {
  const data = event.data as ContactUnsubscribedData;
  const admin = injectedClient;
  if (!admin) {
    log.error('Suppression subscriber invoked without an injected client', {
      tenantId: event.refs.tenantId,
    });
    return;
  }

  // If we have a contactId in the refs, set the flag directly
  if (event.refs.contactId) {
    const { error } = await (admin.from('contacts') as any)
      .update({ email_opt_out: true })
      .eq('id', event.refs.contactId);

    if (error) {
      log.error('Failed to set email_opt_out on unsubscribe', {
        contactId: event.refs.contactId,
        error: String(error),
      });
    } else {
      log.info('Contact marked as email opted out (unsubscribe)', {
        contactId: event.refs.contactId,
        email: data.email,
      });
    }
    return;
  }

  // No contactId in refs — resolve by email within the tenant
  if (data.email && event.refs.tenantId) {
    const { data: contact, error: lookupError } = await admin
      .from('contacts')
      .select('id')
      .eq('tenant_id', event.refs.tenantId)
      .eq('email', data.email)
      .maybeSingle();

    if (lookupError || !contact) {
      log.warn('Could not find contact for unsubscribe suppression', {
        tenantId: event.refs.tenantId,
        email: data.email,
      });
      return;
    }

    const contactId = (contact as { id: string }).id;
    const { error: updateError } = await (admin.from('contacts') as any)
      .update({ email_opt_out: true })
      .eq('id', contactId);

    if (updateError) {
      log.error('Failed to set email_opt_out on unsubscribe (lookup path)', {
        contactId,
        error: String(updateError),
      });
    } else {
      log.info('Contact marked as email opted out (unsubscribe, lookup)', {
        contactId,
        email: data.email,
      });

      // Re-emit contact.unsubscribed with the contactId resolved
      await emit('contact.unsubscribed', {
        idempotencyKey: event.idempotencyKey + '-resolved',
        actor: { type: 'system' },
        refs: {
          tenantId: event.refs.tenantId,
          contactId,
        },
        data: {
          email: data.email,
          channel: 'email',
        },
      });
    }
  }
}

// ── message.bounced — hard bounce / spam / complaint → suppress ─────────────

const BOUNCE_SUPPRESS_REASONS = new Set([
  'hardbounce',
  'hard_bounce',
  'invalid_email',
  'invalid account',
  'mailbox not found',
  'blocked',
  'spam',
  'complaint',
]);

async function onBounced(event: TypedDomainEvent<'message.bounced'>): Promise<void> {
  const data = event.data as MessageEventData;

  // soft_bounce → timeline only, no suppression
  const reason = (data.reason ?? '').toLowerCase();
  if (reason && !BOUNCE_SUPPRESS_REASONS.has(reason)) {
    // Check partial matches for common patterns
    const isHardBounce =
      reason.includes('hard') ||
      reason.includes('invalid') ||
      reason.includes('not found') ||
      reason.includes('blocked') ||
      reason.includes('spam');

    if (!isHardBounce) {
      log.info('Soft bounce — no suppression applied', {
        reason: data.reason,
        providerMessageId: data.providerMessageId,
      });
      return;
    }
  }

  const admin = injectedClient;
  if (!admin) {
    log.error('Suppression subscriber invoked without an injected client', {
      providerMessageId: data.providerMessageId,
    });
    return;
  }
  const contactId = event.refs.contactId;

  if (!contactId) {
    // Try to resolve by email
    const email = (event.meta?.raw as Record<string, unknown> | undefined)?.email as string | undefined;
    if (email && event.refs.tenantId) {
      const { data: contact } = await admin
        .from('contacts')
        .select('id')
        .eq('tenant_id', event.refs.tenantId)
        .eq('email', email)
        .maybeSingle();

      if (contact) {
        await applySuppression(
          admin,
          (contact as { id: string }).id,
          email,
          data.reason ?? 'hard bounce'
        );
        return;
      }
    }
    log.info('Bounce event without contactId — skipping suppression', {
      providerMessageId: data.providerMessageId,
    });
    return;
  }

  await applySuppression(admin, contactId, undefined, data.reason ?? 'hard bounce');
}

async function applySuppression(
  admin: SupabaseClient,
  contactId: string,
  email?: string,
  reason?: string
): Promise<void> {
  const { error } = await (admin.from('contacts') as any)
    .update({
      email_opt_out: true,
      email_valid: false,
    })
    .eq('id', contactId);

  if (error) {
    log.error('Failed to apply bounce suppression', {
      contactId,
      reason,
      error: String(error),
    });
    return;
  }

  log.info('Contact suppressed (hard bounce)', {
    contactId,
    email,
    reason,
  });
}

// ── Register / unregister ───────────────────────────────────────────────────

let cleanups: (() => void)[] = [];

export function registerSuppressionSubscribers(deps: SuppressionSubscriberDeps): void {
  if (cleanups.length > 0) return;

  injectedClient = deps.client;

  cleanups.push(
    eventBus.subscribe('contact.unsubscribed', 'suppression-unsubscribe', onUnsubscribed)
  );

  cleanups.push(
    eventBus.subscribe('message.bounced', 'suppression-bounce', onBounced)
  );

  log.info('Suppression subscribers registered');
}

export function unregisterSuppressionSubscribers(): void {
  for (const cleanup of cleanups) {
    cleanup();
  }
  cleanups = [];
  injectedClient = null;
  log.info('Suppression subscribers unregistered');
}
