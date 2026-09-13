import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ContactSyncInboundWrite,
  ContactSyncLogEntry,
  ContactSyncOutboundQuery,
  ContactSyncOutboundWriteBack,
  KonnectContact,
} from "@tindevelopers/adapter-kit/crm/providers/gohighlevel-contact-sync";
import type { SyncDirection, SyncEntityType, SyncStateRow } from "@tindevelopers/schema-crm";
import { TenantIdRequiredError } from "./errors.js";
import type {
  BrevoSyncMetadata,
  ContactProjection,
  ContactUnsubscribedEmit,
  ProjectionAction,
  SuppressionKind,
} from "./types.js";

/**
 * System-tier contacts store — the single owner of the service-role-only
 * `contacts` columns and the `contact_channels` / `sync_state` write paths
 * (spec rule R4).
 *
 * Absorbs these cataloged writers
 * (`docs/superpowers/research/2026-09-13-crm-schema-ground-truth.md`):
 * - `resolveChannelIdentity` — `identity-resolver.ts` W1 (channel-match
 *   reuse), W2 (phone reuse under another channel; `contact_channels` upsert
 *   with `onConflict "tenant_id,channel,normalized_address"` +
 *   `ignoreDuplicates`, so a pre-existing channel row keeps its original
 *   contact_id), W3 (auto-create with placeholder names
 *   `first_name "Contact"` / `last_name` = normalized phone or raw email
 *   address, `phone`/`phone_e164`, `last_inbound_at`/`last_contacted_at`,
 *   then a primary `contact_channels` insert). Address normalization:
 *   E.164 for sms/voice/whatsapp (`@` prefix stripped for whatsapp ids),
 *   lowercased email.
 * - `touchActivity` — W1/W2/W16 `last_inbound_at` (and `last_contacted_at`)
 *   only. `updated_at` is owned by the DB BEFORE UPDATE trigger and is never
 *   sent manually.
 * - `suppressEmail` — W12 (unsubscribe → `email_opt_out` only), W13
 *   (email-lookup path resolves the contactId by tenant+email and re-emits
 *   `contact.unsubscribed` with the resolved refs via the injected emitter),
 *   W14 (hard bounce → `email_opt_out` + `email_valid: false`). Soft bounces
 *   never write (timeline only). Monotonic: no path clears the flags.
 * - `setSmsOptOut` — W15 minus the redundant manual `updated_at`.
 * - `getSyncProjection` / `getSyncState` / `saveSyncState` —
 *   `crm-sync-service.ts` contact read + projection build and the
 *   "Adjacent write" `sync_state` upsert
 *   (`onConflict "entity_type, entity_id, provider_slug"`, Brevo defaults).
 * - GHL persistence tier (`applyInbound` / `listOutbound` /
 *   `markOutboundSynced` / `appendSyncLog`) — the W20–W22 writers from the
 *   published adapter-kit GHL contact sync, ported via its
 *   ContactSyncPersistence seam (see the tier comment below).
 *
 * Hardening over the absorbed writers: every method takes an explicit
 * `tenantId` (W12/W14/W15/W16/W1/W2 were id-only) and binds it into every
 * `contacts` query.
 *
 * Injection-only: the store receives a `SupabaseClient` (the app passes its
 * service-role client); it never constructs one, never touches the kernel's
 * service-role client factory, and never reads any service-role secret from
 * the environment.
 */

export interface SystemContactsStore {
  /**
   * Resolve an inbound channel address to a contact, auto-creating the
   * contact (with placeholder names) plus its primary channel row when
   * unknown (W1–W3). Always tenant-scoped.
   */
  resolveChannelIdentity(input: {
    tenantId: string;
    channel: string;
    address: string;
  }): Promise<{ contactId: string; isNew: boolean }>;

  /**
   * Touch the inbound/contacted activity timestamps (W1/W2/W16).
   * `lastInboundAt` defaults to now; `lastContactedAt` is written only when
   * provided. Never sends `updated_at` (DB-trigger owned).
   */
  touchActivity(input: {
    tenantId: string;
    contactId: string;
    lastInboundAt?: string;
    lastContactedAt?: string;
  }): Promise<void>;

  /**
   * Suppress email per classified kind (W12–W14). `soft-bounce` writes
   * nothing. With `contactId` the write is direct; with only `email` the
   * contact is resolved by tenant+email (unmatched → no write, no event) and
   * an unsubscribe re-emits `contact.unsubscribed` with the resolved refs
   * (W13) through the injected emitter, idempotencyKey `<key>-resolved`.
   */
  suppressEmail(input: {
    tenantId: string;
    contactId?: string;
    email?: string;
    kind: SuppressionKind;
    idempotencyKey?: string;
  }): Promise<void>;

  /** Set `sms_opt_out` (W15 without the redundant manual `updated_at`). */
  setSmsOptOut(input: { tenantId: string; contactId: string; optOut: boolean }): Promise<void>;

  /**
   * Read a contacts row (tenant-scoped, `select("*")`) and build the Brevo
   * `ContactProjection` from it plus the event action intent. Null when the
   * contact does not exist in the tenant (skip-as-noop).
   */
  getSyncProjection(input: {
    tenantId: string;
    contactId: string;
    action?: ProjectionAction;
  }): Promise<ContactProjection | null>;

  /**
   * Read the `sync_state` row for an entity (Brevo defaults). Null when no
   * state row exists.
   */
  getSyncState(input: {
    tenantId: string;
    entityId: string;
    providerSlug?: string;
    entityType?: SyncEntityType;
  }): Promise<SyncStateRow | null>;

  /**
   * Upsert the `sync_state` row on the unique
   * `(entity_type, entity_id, provider_slug)` triple — a second save updates
   * in place, never duplicates. Brevo defaults: `last_sync_direction "out"`,
   * `conflict_flag false`.
   */
  saveSyncState(input: {
    tenantId: string;
    entityId: string;
    metadata: BrevoSyncMetadata;
    providerSlug?: string;
    entityType?: SyncEntityType;
    lastSyncedAt?: string;
    lastSyncDirection?: SyncDirection;
    conflictFlag?: boolean;
  }): Promise<void>;

  // ── GHL persistence tier — adapter-kit ContactSyncPersistence seam ──────
  //
  // These four methods are the domain-contacts implementation of
  // adapter-kit's `ContactSyncPersistence` port (the composition root passes
  // the system store itself as `{ persistence }`). Port shapes are imported
  // from adapter-kit so parity is compiler-enforced; payloads are ports of
  // the adapter's Supabase-backed default persistence, which preserves the
  // legacy W20–W22 writer shapes byte-for-byte:
  // - `applyInbound` — W20 update (adapter-matched row, non-empty-wins
  //   scalars + custom_fields key merge + explicit `updated_at`, scoped by
  //   id + tenant) or W21 insert (no match).
  // - `listOutbound` — the legacy bulk outbound listing: every tenant
  //   contact, `created_at` ascending, window `range(offset, offset+limit-1)`.
  // - `markOutboundSynced` — W22 write-back: `ghl_contact_id`,
  //   `ghl_last_synced_at`, adapter-merged `custom_fields`, `updated_at`
  //   (the BEFORE UPDATE trigger owns `updated_at` regardless), scoped by
  //   id + tenant.
  // - `appendSyncLog` — the `contact_sync_log` insert that accompanies
  //   every W20–W22 outcome (20260320100000 column set, `synced_at` = now).

  /** Apply one inbound GHL → Konnect write decision (W20 update / W21 insert). */
  applyInbound(input: ContactSyncInboundWrite): Promise<{ contactId: string }>;

  /** List outbound sync candidates (legacy listing: tenant, created_at asc). */
  listOutbound(input: ContactSyncOutboundQuery): Promise<KonnectContact[]>;

  /** Write the GHL assignment back after a successful outbound push (W22). */
  markOutboundSynced(input: ContactSyncOutboundWriteBack): Promise<void>;

  /** Append one `contact_sync_log` row (bookkeeping for every W20–W22 outcome). */
  appendSyncLog(entry: ContactSyncLogEntry): Promise<void>;
}

function assertTenantId(tenantId: string | undefined): void {
  if (typeof tenantId !== "string" || tenantId === "") {
    throw new TenantIdRequiredError();
  }
}

// ──── Address normalization (identity-resolver parity) ──────────────────
//
// The original resolver used libphonenumber-js for E.164 formatting. This
// hub's dependency allowlist forbids adding it, so normalization performs the
// same E.164 canonicalization directly: a "+"-prefixed number of 7–15 digits
// formats to `+<digits>` (exactly what format("E.164") yields for a parseable
// international number), and everything else falls back to the source's
// whitespace-stripped form — identical to the original's parse-failure path.
// Divergence is limited to "+"-prefixed strings that libphonenumber rejects
// for country-plan reasons while still carrying 7–15 digits and formatting
// punctuation; no cataloged payload or ground-truth fixture hits that case.
function toE164OrRaw(trimmed: string): string {
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    if (digits.length >= 7 && digits.length <= 15) return `+${digits}`;
  }
  return trimmed.replace(/\s+/g, "");
}

function normalizeAddress(channel: string, address: string): string {
  const trimmed = address.trim();

  if (channel === "sms" || channel === "voice") {
    return toE164OrRaw(trimmed);
  }

  if (channel === "email") {
    return trimmed.toLowerCase();
  }

  if (channel === "whatsapp") {
    // WhatsApp IDs may arrive with or without '@' prefix, and are phone-based
    const cleaned = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
    return toE164OrRaw(cleaned);
  }

  return trimmed;
}

// ──── Contact row builder (W3 placeholder convention) ───────────────────

function buildContactRow(
  channel: string,
  address: string,
  normalized: string,
): Record<string, unknown> {
  const now = new Date().toISOString();

  if (channel === "sms" || channel === "voice" || channel === "whatsapp") {
    return {
      first_name: "Contact",
      last_name: normalized,
      phone: normalized,
      phone_e164: normalized,
      last_inbound_at: now,
      last_contacted_at: now,
    };
  }

  // email channel
  return {
    first_name: "Contact",
    last_name: address,
    email: normalized,
    last_inbound_at: now,
    last_contacted_at: now,
  };
}

// ──── Store factory ─────────────────────────────────────────────────────

export function createSystemContactsStore(
  serviceRoleClient: SupabaseClient,
  deps?: { emit?: ContactUnsubscribedEmit },
): SystemContactsStore {
  const client = serviceRoleClient;

  return {
    async resolveChannelIdentity({ tenantId, channel, address }) {
      assertTenantId(tenantId);
      const normalized = normalizeAddress(channel, address);

      // W1: existing channel match — reuse the contact, touch inbound.
      const { data: existing } = await client
        .from("contact_channels")
        .select("contact_id")
        .eq("tenant_id", tenantId)
        .eq("channel", channel)
        .eq("normalized_address", normalized)
        .maybeSingle();

      if (existing?.contact_id) {
        await client
          .from("contacts")
          .update({ last_inbound_at: new Date().toISOString() })
          .eq("id", existing.contact_id)
          .eq("tenant_id", tenantId);

        return { contactId: String(existing.contact_id), isNew: false };
      }

      // W2: same phone may already exist under sms/voice/whatsapp — reuse the
      // contact and upsert the channel row (ignoreDuplicates keeps a
      // pre-existing row's original contact_id).
      if (channel === "whatsapp" || channel === "sms" || channel === "voice") {
        const { data: phoneContact } = await client
          .from("contacts")
          .select("id")
          .eq("tenant_id", tenantId)
          .or(`phone.eq.${normalized},phone_e164.eq.${normalized}`)
          .limit(1)
          .maybeSingle();

        if (phoneContact?.id) {
          const contactId = String(phoneContact.id);
          await client.from("contact_channels").upsert(
            {
              tenant_id: tenantId,
              contact_id: contactId,
              channel,
              address,
              normalized_address: normalized,
              is_primary: false,
            },
            { onConflict: "tenant_id,channel,normalized_address", ignoreDuplicates: true },
          );
          await client
            .from("contacts")
            .update({ last_inbound_at: new Date().toISOString() })
            .eq("id", contactId)
            .eq("tenant_id", tenantId);
          return { contactId, isNew: false };
        }
      }

      // W3: auto-create the contact, then its primary channel row.
      const contactRow = buildContactRow(channel, address, normalized);
      const { data: contact, error } = await client
        .from("contacts")
        .insert({ ...contactRow, tenant_id: tenantId })
        .select("id")
        .single();

      if (error || !contact) {
        throw new Error(
          `Failed to create contact for ${channel} address: ${error?.message ?? "unknown error"}`,
        );
      }

      const contactId = String(contact.id);

      await client.from("contact_channels").insert({
        tenant_id: tenantId,
        contact_id: contactId,
        channel,
        address,
        normalized_address: normalized,
        is_primary: true,
      });

      return { contactId, isNew: true };
    },

    async touchActivity({ tenantId, contactId, lastInboundAt, lastContactedAt }) {
      assertTenantId(tenantId);
      const patch: Record<string, string> = {
        last_inbound_at: lastInboundAt ?? new Date().toISOString(),
      };
      if (lastContactedAt !== undefined) {
        patch.last_contacted_at = lastContactedAt;
      }
      const { error } = await client
        .from("contacts")
        .update(patch)
        .eq("id", contactId)
        .eq("tenant_id", tenantId);
      if (error) throw error;
    },

    async suppressEmail({ tenantId, contactId, email, kind, idempotencyKey }) {
      assertTenantId(tenantId);

      // Soft bounces are timeline-only — never a contacts write (W14).
      if (kind === "soft-bounce") return;

      const patch: Record<string, boolean> =
        kind === "hard-bounce" ? { email_opt_out: true, email_valid: false } : { email_opt_out: true };

      // Direct path (W12/W14): contactId already resolved by the event refs.
      if (contactId) {
        const { error } = await client
          .from("contacts")
          .update(patch)
          .eq("id", contactId)
          .eq("tenant_id", tenantId);
        if (error) throw error;
        return;
      }

      // Lookup path (W13): resolve by tenant+email.
      if (!email) return;
      const { data: contact, error: lookupError } = await client
        .from("contacts")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("email", email)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (!contact) return;

      const resolvedId = String((contact as { id: string }).id);
      const { error: updateError } = await client
        .from("contacts")
        .update(patch)
        .eq("id", resolvedId)
        .eq("tenant_id", tenantId);
      if (updateError) throw updateError;

      // W13: re-emit with the resolved contactId (unsubscribe path only).
      if (kind === "unsubscribe" && deps?.emit) {
        await deps.emit("contact.unsubscribed", {
          idempotencyKey: idempotencyKey
            ? `${idempotencyKey}-resolved`
            : `contact-unsubscribed:${tenantId}:${resolvedId}`,
          actor: { type: "system" },
          refs: { tenantId, contactId: resolvedId },
          data: { email, channel: "email" },
        });
      }
    },

    async setSmsOptOut({ tenantId, contactId, optOut }) {
      assertTenantId(tenantId);
      const { error } = await client
        .from("contacts")
        .update({ sms_opt_out: optOut })
        .eq("id", contactId)
        .eq("tenant_id", tenantId);
      if (error) throw error;
    },

    async getSyncProjection({ tenantId, contactId, action = {} }) {
      assertTenantId(tenantId);
      const { data: contact, error } = await client
        .from("contacts")
        .select("*")
        .eq("id", contactId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      if (!contact) return null;

      const row = contact as Record<string, unknown>;
      const customFields = (row.custom_fields as Record<string, unknown>) ?? {};

      const attributes: Record<string, string | number | boolean | null> = {};
      if (action.setAttributes) {
        Object.assign(attributes, action.setAttributes);
      }
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

      const listKeys: string[] = [...(action.listAdd ?? [])];
      const removeListKeys: string[] = [...(action.listRemove ?? [])];

      return {
        konnectContactId: String(row.id ?? ""),
        tenantId: String(row.tenant_id ?? ""),
        email: row.email ? String(row.email) : undefined,
        phone: row.phone ? String(row.phone) : undefined,
        firstName: row.first_name ? String(row.first_name) : undefined,
        lastName: row.last_name ? String(row.last_name) : undefined,
        attributes,
        lifecycleStage: action.setLifecycleStage,
        score: row.score ? Number(row.score) : undefined,
        listKeys,
        removeListKeys: removeListKeys.length > 0 ? removeListKeys : undefined,
        emailOptOut: action.setAttributes?.email_opt_out === true,
        smsOptOut: Boolean(row.sms_opt_out ?? false),
      };
    },

    async getSyncState({ tenantId, entityId, providerSlug = "brevo", entityType = "contact" }) {
      assertTenantId(tenantId);
      const { data, error } = await client
        .from("sync_state")
        .select("*")
        .eq("entity_type", entityType)
        .eq("entity_id", entityId)
        .eq("provider_slug", providerSlug)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return ((data as SyncStateRow | null) ?? null);
    },

    async saveSyncState({
      tenantId,
      entityId,
      metadata,
      providerSlug = "brevo",
      entityType = "contact",
      lastSyncedAt = new Date().toISOString(),
      lastSyncDirection = "out",
      conflictFlag = false,
    }) {
      assertTenantId(tenantId);
      const { error } = await client.from("sync_state").upsert(
        {
          tenant_id: tenantId,
          entity_type: entityType,
          entity_id: entityId,
          provider_slug: providerSlug,
          last_synced_at: lastSyncedAt,
          last_sync_direction: lastSyncDirection,
          conflict_flag: conflictFlag,
          metadata,
        },
        { onConflict: "entity_type, entity_id, provider_slug" },
      );
      if (error) throw error;
    },

    // ── GHL persistence tier (adapter-kit ContactSyncPersistence seam) ────

    async applyInbound(input) {
      assertTenantId(input.tenantId);

      // W20: update the adapter-matched row.
      if (input.existingContactId) {
        const { data, error } = await client
          .from("contacts")
          .update(input.update)
          .eq("id", input.existingContactId)
          .eq("tenant_id", input.tenantId)
          .select("id")
          .single();

        if (error) throw new Error(error.message);
        return { contactId: String((data as { id: string }).id) };
      }

      // W21: no match — insert.
      const { data, error } = await client
        .from("contacts")
        .insert(input.insert)
        .select("id")
        .single();

      if (error) throw new Error(error.message);
      return { contactId: String((data as { id: string }).id) };
    },

    async listOutbound(input) {
      assertTenantId(input.tenantId);
      const { data, error } = await client
        .from("contacts")
        .select("*")
        .eq("tenant_id", input.tenantId)
        .range(input.offset, input.offset + input.limit - 1)
        .order("created_at", { ascending: true });

      if (error) throw new Error(error.message);
      return ((data ?? []) as KonnectContact[]);
    },

    async markOutboundSynced(input) {
      assertTenantId(input.tenantId);
      const { error } = await client
        .from("contacts")
        .update({
          ghl_contact_id: input.ghlContactId,
          ghl_last_synced_at: input.syncedAt,
          custom_fields: input.customFields,
          updated_at: input.syncedAt,
        })
        .eq("id", input.contactId)
        .eq("tenant_id", input.tenantId);
      if (error) throw new Error(error.message);
    },

    async appendSyncLog(entry) {
      assertTenantId(entry.tenantId);
      const { error } = await client.from("contact_sync_log").insert({
        tenant_id: entry.tenantId,
        direction: entry.direction,
        konnect_contact_id: entry.konnectContactId ?? null,
        ghl_contact_id: entry.ghlContactId ?? null,
        action: entry.action,
        error_message: entry.errorMessage ?? null,
        synced_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
    },
  };
}
