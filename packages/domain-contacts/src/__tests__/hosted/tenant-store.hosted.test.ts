/**
 * Hosted-Supabase integration tests for the tenant-tier contacts store
 * (VAL-CONTACTS-001/002/003/004/005/023).
 *
 * Rules honored (mission AGENTS.md):
 * - HOSTED Supabase only (`sfdhtsfvkticvqjqdvud.supabase.co`); keys come from
 *   the hub `.env` (gitignored) and are never printed.
 * - Every row this suite touches is created by the suite, marked with the
 *   `crm-val-<marker>` prefix, and deleted in afterAll; existing hosted data
 *   is read-only (the only reads of pre-existing rows are the two tenant ids
 *   required by the contacts.tenant_id FK).
 * - Cross-tenant cases verify byte-identical rows via full re-reads.
 *
 * The store is client-agnostic (it receives an injected SupabaseClient); these
 * tests bind it to a service-role client so synthetic rows inside real tenants
 * work. RLS-vs-service-role equivalence is VAL-CONTACTS-016's scope.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createContactsStore } from "../../tenant-store.js";
import { ContactNotFoundError } from "../../errors.js";
import type { ContactRow } from "@tindevelopers/schema-crm";

function loadHubEnv(): Record<string, string> {
  const envPath = fileURLToPath(new URL("../../../../../.env", import.meta.url));
  try {
    const raw = readFileSync(envPath, "utf8");
    return Object.fromEntries(
      raw
        .split(/\r?\n/)
        .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
        .map((line) => {
          const key = line.slice(0, line.indexOf("=")).trim();
          let value = line.slice(line.indexOf("=") + 1).trim();
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          return [key, value];
        }),
    );
  } catch {
    return {};
  }
}

const env = loadHubEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const hosted = SUPABASE_URL && SERVICE_ROLE_KEY ? describe : describe.skip;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.warn(
    "[hosted] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — tenant-store hosted integration tests SKIPPED (loudly)",
  );
}

/** Unique-per-run marker; every created row carries it so cleanup is precise. */
const MARKER = `crm-val-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

let admin: SupabaseClient;
let tenantA = "";
let tenantB = "";
const createdContactIds: string[] = [];
const createdCompanyIds: string[] = [];

async function seedContact(tenantId: string, overrides: Record<string, unknown> = {}): Promise<{ id: string; email: string }> {
  const email = `${MARKER}-${randomUUID().slice(0, 8)}@example.com`;
  const { data, error } = await (admin.from("contacts") as any)
    .insert({ tenant_id: tenantId, first_name: "Val", last_name: "Contact", email, ...overrides })
    .select("id")
    .single();
  if (error) throw new Error(`seedContact failed: ${error.message}`);
  createdContactIds.push(data.id as string);
  return { id: data.id as string, email };
}

async function readRow(id: string): Promise<ContactRow> {
  const { data, error } = await (admin.from("contacts") as any).select("*").eq("id", id).single();
  if (error) throw new Error(`readRow failed: ${error.message}`);
  return data as ContactRow;
}

async function readRowOrNull(id: string): Promise<ContactRow | null> {
  const { data } = await (admin.from("contacts") as any).select("*").eq("id", id).maybeSingle();
  return (data as ContactRow | null) ?? null;
}

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  // contacts.tenant_id REFERENCES tenants(id) — use two real tenant ids purely
  // as scope keys (no tenant row is modified).
  const { data: tenants, error } = await (admin.from("tenants") as any).select("id").order("created_at").limit(2);
  if (error) throw new Error(`tenant fetch failed: ${error.message}`);
  if (!tenants || tenants.length < 2) {
    throw new Error("[hosted] need at least two tenants for cross-tenant tests");
  }
  tenantA = tenants[0].id as string;
  tenantB = tenants[1].id as string;
}, 30_000);

afterAll(async () => {
  let deletedContacts = 0;
  let deletedCompanies = 0;
  if (createdContactIds.length > 0) {
    const { data } = await (admin.from("contacts") as any).delete().in("id", createdContactIds).select("id");
    deletedContacts = data?.length ?? 0;
  }
  if (createdCompanyIds.length > 0) {
    const { data } = await (admin.from("companies") as any).delete().in("id", createdCompanyIds).select("id");
    deletedCompanies = data?.length ?? 0;
  }
  // Belt and braces, marker-precise (never a broad crm-val-% sweep — another
  // validator run may be live with its own marker).
  await (admin.from("contacts") as any).delete().like("email", `${MARKER}%`);
  await (admin.from("companies") as any).delete().like("name", `${MARKER}%`);
  const { count } = await (admin.from("contacts") as any)
    .select("id", { count: "exact", head: true })
    .like("email", `${MARKER}%`);
  console.log(`cleanup: deleted ${deletedContacts} test contacts and ${deletedCompanies} test companies; leftover ${MARKER} rows: ${count ?? "?"}`);
  expect(count ?? 0).toBe(0);
}, 30_000);

hosted("tenant store create", () => {
  test("returns row with company join and DB defaults", async () => {
    const companyName = `${MARKER}-company`;
    const { data: company, error: companyError } = await (admin.from("companies") as any)
      .insert({ tenant_id: tenantA, name: companyName })
      .select("id")
      .single();
    if (companyError) throw new Error(`company seed failed: ${companyError.message}`);
    createdCompanyIds.push(company.id as string);

    const store = createContactsStore(admin, tenantA);
    const email = `${MARKER}-join@example.com`;
    const row = await store.create({
      first_name: "Val",
      last_name: "Contact",
      email,
      company_id: company.id as string,
      job_title: "Tester",
    });
    createdContactIds.push(row.id);

    expect(row.id).toBeTruthy();
    expect(row.tenant_id).toBe(tenantA);
    expect(row.first_name).toBe("Val");
    expect(row.last_name).toBe("Contact");
    expect(row.email).toBe(email);
    expect(row.job_title).toBe("Tester");
    expect(row.company?.name).toBe(companyName);
    // Server defaults (ground truth 1.1).
    expect(row.sms_opt_out).toBe(false);
    expect(row.email_opt_out).toBe(false);
    expect(row.email_valid).toBe(true);
    expect(row.dnc).toBe(false);
    expect(row.whatsapp_opt_out).toBe(false);
    expect(row.address).toEqual({});
    expect(row.custom_fields).toEqual({});
    expect(row.tags).toEqual([]);
    expect(typeof row.created_at).toBe("string");
    expect(typeof row.updated_at).toBe("string");
  }, 30_000);

  test("duplicate email: maps 23505 to DuplicateEmailError with existing message", async () => {
    const email = `${MARKER}-dup@example.com`;
    const store = createContactsStore(admin, tenantA);

    const first = await store.create({ first_name: "Dup", last_name: "One", email });
    createdContactIds.push(first.id);

    const error: Error & { name?: string } = await store
      .create({ first_name: "Dup", last_name: "Two", email })
      .catch((e) => e);

    expect(error.name).toBe("DuplicateEmailError");
    expect(error.message).toBe(`A contact with email "${email}" already exists.`);
  }, 30_000);
});

hosted("tenant store update tenant scoping", () => {
  test("patches own-tenant row and rejects cross-tenant id", async () => {
    const own = await seedContact(tenantA);
    const theirs = await seedContact(tenantB);
    const ownBefore = await readRow(own.id);
    const theirsBefore = await readRow(theirs.id);

    const store = createContactsStore(admin, tenantA);

    const updated = await store.update(own.id, { job_title: "Principal Tester" });
    expect(updated.job_title).toBe("Principal Tester");
    expect("company" in updated).toBe(true);
    expect(new Date(updated.updated_at).getTime()).toBeGreaterThan(new Date(ownBefore.updated_at).getTime());

    // Cross-tenant update must reject with not-found semantics and leave the
    // other tenant's row byte-identical.
    await expect(store.update(theirs.id, { notes: "should not land" })).rejects.toBeInstanceOf(ContactNotFoundError);
    const theirsAfter = await readRow(theirs.id);
    expect(theirsAfter).toEqual(theirsBefore);
  }, 60_000);
});

hosted("tenant store bulkRemove", () => {
  test("returns exact deleted count including partial-match case", async () => {
    const doomed1 = await seedContact(tenantA);
    const doomed2 = await seedContact(tenantA);
    const keeper = await seedContact(tenantA);

    const store = createContactsStore(admin, tenantA);
    const result = await store.bulkRemove([doomed1.id, doomed2.id, randomUUID()]);

    expect(result).toEqual({ deleted: 2 });
    expect(await readRowOrNull(doomed1.id)).toBeNull();
    expect(await readRowOrNull(doomed2.id)).toBeNull();
    const keeperRow = await readRow(keeper.id);
    expect(keeperRow.id).toBe(keeper.id);
  }, 60_000);
});

hosted("tenant store mergeTags", () => {
  test("union-dedupes and preserves existing tags", async () => {
    const c1 = await seedContact(tenantA, { tags: ["a", "b"] });
    const c2 = await seedContact(tenantA, { tags: null });

    const store = createContactsStore(admin, tenantA);
    const result = await store.mergeTags([c1.id, c2.id], ["b", "c"]);

    expect(result).toEqual({ updated: 2 });
    expect((await readRow(c1.id)).tags).toEqual(["a", "b", "c"]);
    expect((await readRow(c2.id)).tags).toEqual(["b", "c"]);
  }, 60_000);
});

hosted("tenant store remove cross-tenant", () => {
  test("remove cross-tenant id is a not-found no-op; other tenant's row byte-identical; own-tenant remove deletes", async () => {
    const own = await seedContact(tenantA);
    const theirs = await seedContact(tenantB);
    const theirsBefore = await readRow(theirs.id);

    const store = createContactsStore(admin, tenantA);

    // W6/W11 semantics: the tenant-scoped delete of a foreign id resolves
    // without error and deletes nothing.
    await expect(store.remove(theirs.id)).resolves.toBeUndefined();
    const theirsAfter = await readRow(theirs.id);
    expect(theirsAfter).toEqual(theirsBefore);

    // Sanity for the happy path: own-tenant remove really deletes.
    await store.remove(own.id);
    expect(await readRowOrNull(own.id)).toBeNull();
  }, 60_000);
});
