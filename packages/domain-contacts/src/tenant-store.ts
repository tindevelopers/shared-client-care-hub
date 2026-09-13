import type { SupabaseClient } from "@supabase/supabase-js";
import { ContactNotFoundError, DuplicateEmailError } from "./errors.js";
import type { ContactDialTarget, ContactWithCompany, TenantContactInsert, TenantContactUpdate } from "./types.js";

/**
 * Tenant-tier contacts store — the single owner of `contacts` writes reachable
 * from tenant-scoped callers (spec rule R4).
 *
 * Every method traces to a cataloged writer/reader in
 * `docs/superpowers/research/2026-09-13-crm-schema-ground-truth.md`:
 * - `create` W4 (app createContact), W9 (partner), W17 (seed) — inserts with
 *   injected `tenant_id`, returns the row with the `company:companies(*)` join,
 *   maps Postgres 23505 to {@link DuplicateEmailError} with the existing
 *   message semantics.
 * - `bulkCreate` W18 (contacts-import) — single array insert, no select.
 * - `update` W5/W10 — tenant-scoped, returns the updated row; zero rows
 *   (cross-tenant or missing id) rejects with {@link ContactNotFoundError}.
 * - `remove` W6/W11 — tenant-scoped hard delete; a cross-tenant id matches
 *   zero rows and resolves (not-found no-op).
 * - `bulkRemove` W7 — returns the exact deleted count via `.select("id")`.
 * - `mergeTags` W8 — per-row read-modify-write with union-dedupe. The current
 *   semantics (racy under concurrent tag updates) are preserved verbatim;
 *   an atomicity redesign is explicitly out of scope.
 * - Reads mirror `apps/app/app/actions/crm/contacts.ts`: `list`/`listByIds`/
 *   `get` use the company join with `created_at` desc ordering,
 *   `listDialTargets` returns `{value,label}` options, `listTags` the deduped
 *   tag set.
 *
 * The store never constructs a Supabase client and never touches
 * service-role-only columns (see {@link TenantContactInsert}/
 * {@link TenantContactUpdate}); it receives an injected client and binds every
 * query to `tenantId`.
 */

const CONTACT_SELECT = "*, company:companies(*)";

export interface ContactsStore {
  /** All contacts for the tenant, newest first (getContacts parity). */
  list(): Promise<ContactWithCompany[]>;
  /** Contacts by ids, newest first; empty input short-circuits (getContactsByIds parity). */
  listByIds(ids: string[]): Promise<ContactWithCompany[]>;
  /** One contact by id (company join), or null when not found in the tenant (getContact parity). */
  get(id: string): Promise<ContactWithCompany | null>;
  /**
   * Insert one contact (W4/W9/W17). Resolves with the created row including
   * the company join. Rejects with {@link DuplicateEmailError} when the
   * partial unique index `contacts_tenant_email_unique` trips (23505).
   */
  create(input: TenantContactInsert): Promise<ContactWithCompany>;
  /** Array insert for imports (W18). Resolves without a returned row set. */
  bulkCreate(rows: TenantContactInsert[]): Promise<void>;
  /**
   * Tenant-scoped update (W5/W10). Resolves with the updated row (company
   * join). Rejects with {@link ContactNotFoundError} when the id does not
   * exist in this tenant.
   */
  update(id: string, patch: TenantContactUpdate): Promise<ContactWithCompany>;
  /**
   * Tenant-scoped hard delete (W6/W11). A cross-tenant or missing id matches
   * zero rows and resolves without error.
   *
   * CASCADE blast radius: deleting a contact hard-deletes its conversations,
   * messages, contact_channels, tasks, notes, activities,
   * contact_group_members, and conversation_message_queue rows; campaigns,
   * deals, and orders only SET NULL their references.
   */
  remove(id: string): Promise<void>;
  /**
   * Tenant-scoped hard delete of many ids (W7). Resolves with the exact
   * number of rows deleted (ids belonging to other tenants simply don't
   * match). Same CASCADE blast radius as {@link remove}.
   */
  bulkRemove(ids: string[]): Promise<{ deleted: number }>;
  /**
   * Union-merge tags onto the listed contacts (W8 `bulkAssignTags`):
   * reads each row's current tags, merges with `[...new Set([...existing, ...tags])]`
   * (null/non-array tags count as `[]`), and writes per row. Resolves with the
   * number of rows updated. Read-modify-write semantics preserved as-is.
   */
  mergeTags(ids: string[], tags: string[]): Promise<{ updated: number }>;
  /**
   * Deduped phone/mobile options for dialing UI dropdowns
   * (`listContactDialTargetsAction` parity): newest-updated first, labels
   * `<name> · <number>` with a ` (mobile)` suffix for mobiles, `Contact` as
   * the name fallback. `limit` is clamped to [1, 500] (default 200).
   */
  listDialTargets(limit?: number): Promise<ContactDialTarget[]>;
  /** Sorted, deduped set of all tags used in the tenant (getAllTags parity). */
  listTags(): Promise<string[]>;
}

export function createContactsStore(client: SupabaseClient, tenantId: string): ContactsStore {
  const table = () => client.from("contacts") as any;

  return {
    async list() {
      const { data, error } = await table()
        .select(CONTACT_SELECT)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data as ContactWithCompany[]) ?? []);
    },

    async listByIds(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await table()
        .select(CONTACT_SELECT)
        .eq("tenant_id", tenantId)
        .in("id", ids)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data as ContactWithCompany[]) ?? []);
    },

    async get(id) {
      const { data, error } = await table()
        .select(CONTACT_SELECT)
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return ((data as ContactWithCompany | null) ?? null);
    },

    async create(input) {
      const { data, error } = await table()
        .insert({ ...input, tenant_id: tenantId })
        .select(CONTACT_SELECT)
        .single();
      if (error) {
        if (error.code === "23505") {
          throw new DuplicateEmailError(input.email ?? null, { cause: error });
        }
        throw error;
      }
      return data as ContactWithCompany;
    },

    async bulkCreate(rows) {
      if (rows.length === 0) return;
      const { error } = await table().insert(rows.map((row) => ({ ...row, tenant_id: tenantId })));
      if (error) throw error;
    },

    async update(id, patch) {
      const { data, error } = await table()
        .update(patch)
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .select(CONTACT_SELECT)
        .single();
      if (error) {
        if (error.code === "PGRST116") {
          throw new ContactNotFoundError(`Contact ${id} not found.`, { cause: error });
        }
        throw error;
      }
      return data as ContactWithCompany;
    },

    async remove(id) {
      const { error } = await table()
        .delete()
        .eq("id", id)
        .eq("tenant_id", tenantId);
      if (error) throw error;
    },

    async bulkRemove(ids) {
      const { data, error, count } = await table()
        .delete()
        .in("id", ids)
        .eq("tenant_id", tenantId)
        .select("id");
      if (error) throw error;
      return { deleted: Array.isArray(data) ? data.length : (count ?? 0) };
    },

    async mergeTags(ids, tags) {
      const { data: current, error: fetchError } = await table()
        .select("id, tags")
        .in("id", ids)
        .eq("tenant_id", tenantId);
      if (fetchError) throw fetchError;

      let updated = 0;
      for (const row of (current ?? []) as Array<{ id: string; tags: string[] | null }>) {
        const existing: string[] = Array.isArray(row.tags) ? row.tags : [];
        const merged = [...new Set([...existing, ...tags])];
        const { error: updateError } = await table()
          .update({ tags: merged })
          .eq("id", row.id)
          .eq("tenant_id", tenantId);
        if (!updateError) updated++;
      }
      return { updated };
    },

    async listDialTargets(limit = 200) {
      const { data, error } = await table()
        .select("id,first_name,last_name,phone,mobile")
        .eq("tenant_id", tenantId)
        .order("updated_at", { ascending: false })
        .limit(Math.max(1, Math.min(500, limit)));
      if (error) throw error;

      const rows =
        (data as Array<{
          id: string;
          first_name: string | null;
          last_name: string | null;
          phone: string | null;
          mobile: string | null;
        }>) ?? [];

      const seen = new Set<string>();
      const out: ContactDialTarget[] = [];

      for (const r of rows) {
        const name = `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "Contact";
        const candidates: Array<{ value: string; suffix?: string }> = [];
        if (r.phone) candidates.push({ value: r.phone, suffix: "" });
        if (r.mobile) candidates.push({ value: r.mobile, suffix: " (mobile)" });

        for (const c of candidates) {
          const value = String(c.value).trim();
          if (!value) continue;
          if (seen.has(value)) continue;
          seen.add(value);
          out.push({ value, label: `${name} · ${value}${c.suffix ?? ""}` });
        }
      }

      return out;
    },

    async listTags() {
      const { data, error } = await table()
        .select("tags")
        .eq("tenant_id", tenantId);
      if (error) throw error;

      const tagSet = new Set<string>();
      for (const row of (data ?? []) as Array<{ tags: string[] | null }>) {
        if (Array.isArray(row.tags)) {
          for (const t of row.tags) {
            if (t) tagSet.add(t);
          }
        }
      }
      return Array.from(tagSet).sort();
    },
  };
}
