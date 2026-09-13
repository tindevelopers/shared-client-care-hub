/**
 * Hosted-Supabase integration tests for RLS-vs-service-role tenant-store
 * parity (VAL-CONTACTS-016).
 *
 * Rules honored (mission AGENTS.md):
 * - HOSTED Supabase only (`sfdhtsfvkticvqjqdvud.supabase.co`); keys come from
 *   the hub `.env` (falling back to the konnect `apps/app/.env.local` for the
 *   anon key) and are never printed. The synthetic auth user's password is
 *   generated in-memory and never printed.
 * - The suite creates a fully synthetic scope — tenant, auth user, users row,
 *   company, contacts — all marked `crm-val-*`, and deletes every row it
 *   created (including the auth user); existing hosted data is never touched.
 *
 * Parity proof: the same W4-shaped payload driven through
 * create → get → update → remove on an RLS-scoped client (a signed-in
 * synthetic tenant user) and on a service-role client produces identical
 * observable column state, verified by diffing post-write reads from the
 * service-role client for both paths. `bulkCreate` inserts a W18-shaped array
 * in one call through the RLS client.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createContactsStore } from "../../tenant-store.js";

function loadEnvFile(path: string): Record<string, string> {
  try {
    const raw = readFileSync(path, "utf8");
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

const hubEnv = loadEnvFile(fileURLToPath(new URL("../../../../../.env", import.meta.url)));
// Anon key: the repo-root env carries the JWT anon key for this project
// (apps/app/.env.local holds a legacy-format key the auth API rejects).
const konnectRootEnv = loadEnvFile("/Users/gene/Projects/konnect-caas-base/.env.local");
const konnectAppEnv = loadEnvFile(
  "/Users/gene/Projects/konnect-caas-base/apps/app/.env.local",
);
const SUPABASE_URL = hubEnv.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_ROLE_KEY = hubEnv.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY =
  konnectRootEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  konnectAppEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";
const hosted = SUPABASE_URL && SERVICE_ROLE_KEY && ANON_KEY ? describe : describe.skip;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  console.warn(
    "[hosted] SUPABASE env incomplete (need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY) — RLS parity hosted tests SKIPPED (loudly)",
  );
}

/** Unique-per-run marker; every created row carries it so cleanup is precise. */
const MARKER = `crm-val-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

let admin: SupabaseClient;
let rls: SupabaseClient;
let tenantId = "";
let companyRow: Record<string, unknown> | null = null;
let authUserId = "";
const createdContactIds: string[] = [];

/** Columns whose values legitimately differ between two distinct rows. */
const ROW_IDENTITY_KEYS = new Set(["id", "created_at", "updated_at", "company"]);

function normalize(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (ROW_IDENTITY_KEYS.has(key)) continue;
    // Each path uses its own distinct marker email (partial unique index),
    // so equate them before diffing.
    out[key] = key === "email" && typeof value === "string" ? "<parity-email>" : value;
  }
  return out;
}

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Fully synthetic tenant.
  const { data: tenant, error: tenantError } = await (admin.from("tenants") as any)
    .insert({
      name: `${MARKER}-tenant`,
      domain: `${MARKER}.test`,
      plan: "starter",
      region: "test",
      status: "active",
    })
    .select("id")
    .single();
  if (tenantError) throw new Error(`synthetic tenant seed failed: ${tenantError.message}`);
  tenantId = String(tenant.id);

  // Synthetic auth user (password generated in memory, never printed).
  const testEmail = `${MARKER}@example.com`;
  const testPassword = `${randomBytes(24).toString("hex")}Aa1!`;
  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true,
  });
  if (authError || !authUser.user) {
    throw new Error(`synthetic auth user creation failed: ${authError?.message ?? "unknown"}`);
  }
  authUserId = authUser.user.id;

  // users row links auth.uid() → tenant (get_user_tenant_id reads this).
  const { error: usersError } = await (admin.from("users") as any).insert({
    id: authUserId,
    email: testEmail,
    full_name: "CRM Val RLS",
    tenant_id: tenantId,
    plan: "starter",
    status: "active",
  });
  if (usersError) throw new Error(`synthetic users row failed: ${usersError.message}`);

  // RLS-scoped client: signed-in tenant user.
  rls = createClient(SUPABASE_URL, ANON_KEY);
  const { error: signInError } = await rls.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });
  if (signInError) throw new Error(`synthetic sign-in failed: ${signInError.message}`);

  // Shared test company for the W4 join.
  const { data: company, error: companyError } = await (admin.from("companies") as any)
    .insert({ tenant_id: tenantId, name: `${MARKER}-company` })
    .select("id")
    .single();
  if (companyError) throw new Error(`company seed failed: ${companyError.message}`);
  companyRow = company;
}, 60_000);

afterAll(async () => {
  if (!admin) return;
  let deletedContacts = 0;
  if (createdContactIds.length > 0) {
    const { data } = await (admin.from("contacts") as any)
      .delete()
      .in("id", createdContactIds)
      .select("id");
    deletedContacts = data?.length ?? 0;
  }
  // Belt and braces, marker-precise (never a broad crm-val-% sweep — another
  // validator run may be live with its own marker).
  await (admin.from("contacts") as any).delete().like("email", `${MARKER}%`);
  let deletedCompanies = 0;
  if (companyRow) {
    const { data } = await (admin.from("companies") as any)
      .delete()
      .eq("id", companyRow.id)
      .select("id");
    deletedCompanies = data?.length ?? 0;
  }
  let deletedUsers = 0;
  if (authUserId) {
    const { data } = await (admin.from("users") as any)
      .delete()
      .eq("id", authUserId)
      .select("id");
    deletedUsers = data?.length ?? 0;
    await admin.auth.admin.deleteUser(authUserId);
  }
  let deletedTenant = false;
  if (tenantId) {
    const { data } = await (admin.from("tenants") as any)
      .delete()
      .eq("id", tenantId)
      .select("id");
    deletedTenant = (data?.length ?? 0) > 0;
  }
  const { count } = await (admin.from("contacts") as any)
    .select("id", { count: "exact", head: true })
    .like("email", `${MARKER}%`);
  console.log(
    `cleanup: deleted ${deletedContacts} tracked contacts, ${deletedCompanies} company, ${deletedUsers} users row, auth user deleted, tenant=${deletedTenant}; leftover ${MARKER} rows: ${count ?? "?"}`,
  );
  expect(count ?? 0).toBe(0);
}, 60_000);

hosted("hosted integration", () => {
  test("RLS and service-role stores produce identical row state", async () => {
    const companyId = String(companyRow!.id);
    const basePayload = {
      first_name: "Parity",
      last_name: "Contact",
      job_title: "Engineer",
      phone: "+15550000001",
      company_id: companyId,
      created_by: authUserId,
    };

    async function driveSequence(client: SupabaseClient, email: string) {
      const store = createContactsStore(client, tenantId);

      const created = await store.create({ ...basePayload, email });
      expect(created.id).toBeTruthy();
      expect(created.company?.name).toBe(`${MARKER}-company`);
      // Server defaults (W4 parity).
      expect(created.sms_opt_out).toBe(false);
      expect(created.email_opt_out).toBe(false);
      expect(created.email_valid).toBe(true);
      expect(created.dnc).toBe(false);
      expect(created.whatsapp_opt_out).toBe(false);
      expect(created.tags).toEqual([]);
      expect(created.custom_fields).toEqual({});
      expect(created.address).toEqual({});
      createdContactIds.push(created.id);

      const got = await store.get(created.id);
      expect(got?.email).toBe(email);

      const preUpdate = Date.parse(String(created.updated_at));
      const updated = await store.update(created.id, { job_title: "Senior Engineer" });
      expect(updated.job_title).toBe("Senior Engineer");
      // updated_at is trigger-owned and advanced by the update.
      expect(Date.parse(String(updated.updated_at))).toBeGreaterThanOrEqual(preUpdate);

      // Observable state read through the service-role client.
      const afterCreate = await (admin.from("contacts") as any)
        .select("*, company:companies(*)")
        .eq("id", created.id)
        .single();
      const afterUpdate = await (admin.from("contacts") as any)
        .select("*, company:companies(*)")
        .eq("id", created.id)
        .single();

      await store.remove(created.id);
      const gone = await (admin.from("contacts") as any)
        .select("id")
        .eq("id", created.id)
        .maybeSingle();

      return { afterCreate: afterCreate.data, afterUpdate: afterUpdate.data, gone };
    }

    const rlsResult = await driveSequence(rls, `${MARKER}-rls@example.com`);
    const svcResult = await driveSequence(admin, `${MARKER}-svc@example.com`);

    // Zero diffs between RLS and service-role observable state.
    expect(normalize(rlsResult.afterCreate)).toEqual(normalize(svcResult.afterCreate));
    expect(normalize(rlsResult.afterUpdate)).toEqual(normalize(svcResult.afterUpdate));
    expect(rlsResult.gone?.data ?? null).toBeNull();
    expect(svcResult.gone?.data ?? null).toBeNull();
  }, 120_000);

  test("bulkCreate inserts W18-shaped array", async () => {
    const store = createContactsStore(rls, tenantId);
    const companyId = String(companyRow!.id);
    const rows = [
      {
        first_name: "Import",
        last_name: "One",
        email: `${MARKER}-bulk1@example.com`,
        phone: "+15550001001",
        job_title: "Founder",
        company_id: companyId,
        created_by: authUserId,
      },
      {
        first_name: "Import",
        last_name: "Two", // nullable email (W18 rows may carry none)
        email: null,
        company_id: companyId,
        created_by: authUserId,
      },
      {
        first_name: "Import",
        last_name: "Three",
        email: `${MARKER}-bulk3@example.com`,
        company_id: companyId,
        created_by: authUserId,
      },
    ];

    await store.bulkCreate(rows);

    // Every row readable afterwards (service-role read, tenant-scoped).
    const { data: byEmail } = await (admin.from("contacts") as any)
      .select("id, email, first_name, last_name, company_id")
      .eq("tenant_id", tenantId)
      .like("email", `${MARKER}-bulk%`);
    expect(byEmail?.length ?? 0).toBe(2);

    const { data: byName } = await (admin.from("contacts") as any)
      .select("id, email, first_name, last_name, company_id")
      .eq("tenant_id", tenantId)
      .eq("first_name", "Import")
      .eq("last_name", "Two")
      .maybeSingle();
    expect(byName).toBeTruthy();
    expect(byName.email).toBeNull();
    expect(byName.company_id).toBe(companyId);

    for (const row of [...(byEmail ?? []), byName]) {
      if (row?.id) createdContactIds.push(String(row.id));
    }
  }, 120_000);
});
