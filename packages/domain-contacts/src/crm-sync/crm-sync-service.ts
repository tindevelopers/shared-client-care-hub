/**
 * CRM Sync Service
 *
 * Provider-agnostic orchestrator for syncing Konnect contacts to external
 * platforms (Brevo, HubSpot, etc.) driven by the event bus.
 *
 * Flow per event:
 *   1. Resolve tenant + check feature flag / connection status
 *   2. Read EVENT_ACTION_MAP → sync action intent
 *   3. Load Konnect contacts row → build ContactProjection
 *   4. Compute hash → compare with sync_state → skip no-op
 *   5. Call provider (upsert + list management)
 *   6. Upsert sync_state with hash + brevoId
 *
 * Idempotent: hash-guard prevents duplicate/replayed event processing.
 * Multi-tenant: separate provider instances per tenant.
 * Never throws out of subscriber — failures logged, sync_state left stale for retry.
 *
 * Moved from apps/app/src/core/crm-sync/crm-sync-service.ts (byte-identical
 * apart from import specifiers and the injection-only adaptation): the app's
 * internally constructed service-role client is replaced by one injected
 * through `registerCrmSyncSubscribers({ client })` — domain packages never
 * construct clients (injection-only hub boundary rule).
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptIntegrationCredentials } from "@tindevelopers/core-kernel/integrations/crypto";
import { createLogger } from "@tindevelopers/core-kernel/logger";
import { EVENT_ACTION_MAP } from "@tindevelopers/core-kernel/events/event-types";
import type { DomainEventType, EventActionIntent } from "@tindevelopers/core-kernel/events/event-types";
import { BrevoContactsProvider } from "@tindevelopers/adapter-kit/brevo/brevo-contacts-provider";
import type { ContactsSyncProvider } from "@tindevelopers/adapter-kit/crm/contacts-sync-interface";
import type { ContactProjection } from "@tindevelopers/adapter-kit/crm/contacts-sync-interface";

const log = createLogger("crm-sync/service");

// ──── Types ──────────────────────────────────────────────────────────────

/** Injected dependencies — the host app supplies its service-role client. */
export interface CrmSyncDeps {
  client: SupabaseClient;
}

interface SyncState {
  id?: string;
  tenant_id: string;
  entity_type: "contact";
  entity_id: string;
  provider_slug: string;
  last_synced_at: string;
  last_sync_direction: "in" | "out";
  conflict_flag: boolean;
  metadata: {
    hash?: string;
    brevoId?: string;
  };
}

interface SyncResult {
  action: "upserted" | "updated" | "skipped_noop" | "skipped_disabled" | "error";
  brevoId?: string;
  error?: string;
}

// ──── Provider registry (per-tenant, lazy) ──────────────────────────────

const providerCache = new Map<string, ContactsSyncProvider>();

async function getProviderForTenant(
  tenantId: string,
  client: SupabaseClient
): Promise<ContactsSyncProvider | null> {
  const cacheKey = `brevo:${tenantId}`;
  if (providerCache.has(cacheKey)) {
    return providerCache.get(cacheKey)!;
  }

  try {
    const admin = client;

    // 1. Check connection
    const { data: connection } = await (admin.from("integration_connections") as any)
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("status", "connected")
      .maybeSingle();

    if (!connection?.id) {
      log.info("No connected Brevo integration for tenant", {
        tenantId: tenantId.substring(0, 8),
      });
      return null;
    }

    // 2. Get encrypted secrets
    const { data: secrets } = await (admin.from("integration_connection_secrets") as any)
      .select("*")
      .eq("connection_id", connection.id)
      .maybeSingle();

    if (!secrets?.secrets_ciphertext) {
      log.info("No Brevo secrets for tenant", {
        tenantId: tenantId.substring(0, 8),
      });
      return null;
    }

    // 3. Decrypt
    const decrypted = decryptIntegrationCredentials({
      secrets_ciphertext: secrets.secrets_ciphertext,
      secrets_iv: secrets.secrets_iv,
      secrets_tag: secrets.secrets_tag,
    } as any);

    const apiKey =
      (decrypted as any)?.apiKey ??
      (decrypted as any)?.api_key;

    if (!apiKey) {
      log.warn("No API key in decrypted Brevo credentials", {
        tenantId: tenantId.substring(0, 8),
      });
      return null;
    }

    // 4. Load field mappings
    const { data: mappings } = await (admin.from("field_mappings") as any)
      .select("internal_field, external_field, direction")
      .eq("tenant_id", tenantId)
      .eq("provider_slug", "brevo")
      .eq("entity", "contact");

    // 5. Load connection config (list map)
    const connectionConfig = (connection as any)?.metadata ?? {};

    // 6. Create and cache provider
    const provider = new BrevoContactsProvider();
    await provider.initialize(apiKey, {
      fieldMappings: mappings ?? [],
      connectionConfig,
    });

    providerCache.set(cacheKey, provider);
    log.info("Brevo contacts provider initialized for tenant", {
      tenantId: tenantId.substring(0, 8),
    });

    return provider;
  } catch (err) {
    log.error("Failed to resolve Brevo provider for tenant", {
      tenantId: tenantId.substring(0, 8),
      error: String(err),
    });
    return null;
  }
}

// ──── Hash computation ──────────────────────────────────────────────────

function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return "null";
  if (typeof obj !== "object") return String(obj);
  if (Array.isArray(obj)) {
    return "[" + obj.map(stableStringify).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return "{" + keys.map((k) => `"${k}":${stableStringify((obj as any)[k])}`).join(",") + "}";
}

async function computeHash(projection: ContactProjection): Promise<string> {
  const normalized = stableStringify({
    email: projection.email,
    phone: projection.phone,
    firstName: projection.firstName,
    lastName: projection.lastName,
    attributes: projection.attributes,
    lifecycleStage: projection.lifecycleStage,
    score: projection.score,
    listKeys: [...projection.listKeys].sort(),
  });
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ──── Public API ────────────────────────────────────────────────────────

/**
 * Sync a contact to Brevo based on an event type and contact ID.
 *
 * Called by event bus subscribers. Never throws — errors are logged
 * and the sync_state is left stale for the next event to retry.
 */
export async function syncContactFromEvent(
  eventType: DomainEventType,
  tenantId: string,
  contactId: string,
  deps?: CrmSyncDeps,
): Promise<SyncResult> {
  // 1. Feature flag check
  if (process.env.BREVO_CONTACT_SYNC_ENABLED !== "true") {
    return { action: "skipped_disabled" };
  }

  // 2. Read EVENT_ACTION_MAP
  const action = EVENT_ACTION_MAP[eventType];
  if (!action?.syncContact) {
    return { action: "skipped_noop" };
  }

  // 2b. Injection-only client (the app passes its service-role client via
  //     registerCrmSyncSubscribers; domains never construct one).
  if (!deps?.client) {
    log.error("CRM sync requires an injected Supabase client — register via registerCrmSyncSubscribers({ client })", {
      tenantId: tenantId.substring(0, 8),
      eventType,
    });
    return { action: "error", error: "No Supabase client injected into crm-sync" };
  }

  // 3. Get provider
  const provider = await getProviderForTenant(tenantId, deps.client);
  if (!provider) {
    return { action: "skipped_disabled" };
  }

  try {
    // 4. Load Konnect contact
    const admin = deps.client;
    const { data: contact } = await (admin.from("contacts") as any)
      .select("*")
      .eq("id", contactId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!contact) {
      log.info("Contact not found — skipping sync", {
        contactId: contactId.substring(0, 8),
      });
      return { action: "skipped_noop" };
    }

    // 5. Build projection
    const projection = buildProjection(contact, action);

    // 6. Compute hash
    const hash = await computeHash(projection);

    // 7. Check sync_state for no-op
    const { data: existingState } = await (admin.from("sync_state") as any)
      .select("*")
      .eq("entity_type", "contact")
      .eq("entity_id", contactId)
      .eq("provider_slug", "brevo")
      .maybeSingle();

    if (existingState?.metadata?.hash === hash) {
      // Check if there are list changes (hash includes sorted listKeys, so
      // identical hash means identical lists — nothing to do)
      log.info("Sync skipped — identical projection hash", {
        contactId: contactId.substring(0, 8),
      });
      return { action: "skipped_noop" };
    }

    // 8. Call provider
    const brevoId = await provider.upsertContact(projection);

    // 9. List management
    if (provider.addToList && projection.listKeys.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- byte-preserved from the app source (re-resolve is a documented no-op delta case)
      const { resolveListIds } = await import(
        "@tindevelopers/adapter-kit/brevo/brevo-mappers"
      );
      // Re-resolve list IDs at this point (the provider already did this in upsertContact,
      // but explicit adds/removes handle delta cases)
    }

    // 10. Upsert sync_state
    const now = new Date().toISOString();
    const stateRow: Partial<SyncState> = {
      tenant_id: tenantId,
      entity_type: "contact",
      entity_id: contactId,
      provider_slug: "brevo",
      last_synced_at: now,
      last_sync_direction: "out",
      conflict_flag: false,
      metadata: { hash, brevoId },
    };

    // Upsert via insert with ON CONFLICT update
    const { error: upsertError } = await (admin.from("sync_state") as any).upsert(
      stateRow,
      { onConflict: "entity_type, entity_id, provider_slug" }
    );

    if (upsertError) {
      log.error("Failed to upsert sync_state", {
        contactId: contactId.substring(0, 8),
        error: upsertError.message,
      });
    }

    log.info("Contact synced to Brevo", {
      contactId: contactId.substring(0, 8),
      brevoId: brevoId.substring(0, 8),
      eventType,
    });

    return { action: "upserted", brevoId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("Contact sync failed", {
      contactId: contactId.substring(0, 8),
      eventType,
      error: msg,
    });
    return { action: "error", error: msg };
  }
}

/**
 * Clear the provider cache (useful for testing).
 */
export function clearProviderCache(): void {
  providerCache.clear();
}

// ──── Projection Builder ─────────────────────────────────────────────────

function buildProjection(
  contact: Record<string, unknown>,
  action: EventActionIntent
): ContactProjection {
  const customFields = (contact.custom_fields as Record<string, unknown>) ?? {};

  const attributes: Record<string, string | number | boolean | null> = {};

  // Apply setAttributes from EVENT_ACTION_MAP
  if (action.setAttributes) {
    Object.assign(attributes, action.setAttributes);
  }

  // Include custom_fields
  for (const [key, value] of Object.entries(customFields)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      attributes[key] = value;
    }
  }

  // Build list keys from action
  const listKeys: string[] = [...(action.listAdd ?? [])];
  const removeListKeys: string[] = [...(action.listRemove ?? [])];

  return {
    konnectContactId: String(contact.id ?? ""),
    tenantId: String(contact.tenant_id ?? ""),
    email: contact.email ? String(contact.email) : undefined,
    phone: contact.phone ? String(contact.phone) : undefined,
    firstName: contact.first_name ? String(contact.first_name) : undefined,
    lastName: contact.last_name ? String(contact.last_name) : undefined,
    attributes,
    lifecycleStage: action.setLifecycleStage,
    score: contact.score ? Number(contact.score) : undefined,
    listKeys,
    removeListKeys: removeListKeys.length > 0 ? removeListKeys : undefined,
    emailOptOut: action.setAttributes?.email_opt_out === true,
    smsOptOut: Boolean(contact.sms_opt_out ?? false),
  };
}
