/**
 * Hosted-Supabase integration tests for the segment materializer
 * (VAL-CONTACTS-013/014).
 *
 * Rules honored (mission AGENTS.md):
 * - HOSTED Supabase only (`sfdhtsfvkticvqjqdvud.supabase.co`); keys come from
 *   the hub `.env` (gitignored) and are never printed.
 * - The suite creates a fully synthetic tenant (marked `crm-val-*`), seeds its
 *   own contacts/group/memberships, and deletes every row it created;
 *   existing hosted data is never touched.
 *
 * Drift fix #1 proven against the real schema: the contacts SELECT carries no
 * `lifecycle_stage`/`score` (the query returns 200, not PostgREST 42703), a
 * `lifecycleStage` filter rejects with LifecycleStageUnsupportedError, and
 * `contactGroupId` resolves through the real `contact_group_members` table.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { materializeSegment } from "../segment-materializer.js";
import { LifecycleStageUnsupportedError } from "../../errors.js";

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
    "[hosted] NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — segment-materializer hosted integration tests SKIPPED (loudly)",
  );
}

/** Unique-per-run marker; every created row carries it so cleanup is precise. */
const MARKER = `crm-val-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

let admin: SupabaseClient;
let tenantId = "";
let groupId = "";
const createdContactIds: string[] = [];

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Fully synthetic tenant — nothing pre-existing is read or mutated.
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

  // Contacts: one sendable, one opted-out, one invalid — all tagged so the
  // tags-filtered segment sees all three.
  const { data: contacts, error: contactsError } = await (admin.from("contacts") as any)
    .insert([
      {
        tenant_id: tenantId,
        first_name: "Sendable",
        last_name: "Contact",
        email: `${MARKER}-sendable@example.com`,
        tags: ["segtest"],
        email_opt_out: false,
        email_valid: true,
      },
      {
        tenant_id: tenantId,
        first_name: "Opted",
        last_name: "Out",
        email: `${MARKER}-optedout@example.com`,
        tags: ["segtest"],
        email_opt_out: true,
        email_valid: true,
      },
      {
        tenant_id: tenantId,
        first_name: "Invalid",
        last_name: "Email",
        email: `${MARKER}-invalid@example.com`,
        tags: ["segtest"],
        email_opt_out: false,
        email_valid: false,
      },
      {
        tenant_id: tenantId,
        first_name: "Grouped",
        last_name: "Only",
        email: `${MARKER}-grouped@example.com`,
        email_opt_out: false,
        email_valid: true,
      },
    ])
    .select("id, email");
  if (contactsError) throw new Error(`contact seed failed: ${contactsError.message}`);
  for (const c of contacts as Array<{ id: string }>) createdContactIds.push(String(c.id));
  const byEmail = new Map(
    (contacts as Array<{ id: string; email: string }>).map((c) => [c.email, String(c.id)]),
  );

  // Group + membership: only the "grouped" contact is a member.
  const { data: group, error: groupError } = await (admin.from("contact_groups") as any)
    .insert({ tenant_id: tenantId, name: `${MARKER}-group` })
    .select("id")
    .single();
  if (groupError) throw new Error(`group seed failed: ${groupError.message}`);
  groupId = String(group.id);

  const { error: memberError } = await (admin.from("contact_group_members") as any).insert({
    tenant_id: tenantId,
    group_id: groupId,
    contact_id: byEmail.get(`${MARKER}-grouped@example.com`),
  });
  if (memberError) throw new Error(`membership seed failed: ${memberError.message}`);
}, 60_000);

afterAll(async () => {
  if (!admin) return;
  let deletedMembers = 0;
  let deletedGroup = 0;
  let deletedContacts = 0;
  let deletedTenant = false;
  if (groupId) {
    const { data: m } = await (admin.from("contact_group_members") as any)
      .delete()
      .eq("group_id", groupId)
      .select("id");
    deletedMembers = m?.length ?? 0;
    const { data: g } = await (admin.from("contact_groups") as any)
      .delete()
      .eq("id", groupId)
      .select("id");
    deletedGroup = g?.length ?? 0;
  }
  if (createdContactIds.length > 0) {
    const { data: c } = await (admin.from("contacts") as any)
      .delete()
      .in("id", createdContactIds)
      .select("id");
    deletedContacts = c?.length ?? 0;
  }
  if (tenantId) {
    const { data: t } = await (admin.from("tenants") as any)
      .delete()
      .eq("id", tenantId)
      .select("id");
    deletedTenant = (t?.length ?? 0) > 0;
  }
  const { count } = await (admin.from("contacts") as any)
    .select("id", { count: "exact", head: true })
    .like("email", `${MARKER}%`);
  console.log(
    `cleanup: deleted ${deletedMembers} memberships, ${deletedGroup} group, ${deletedContacts}/${createdContactIds.length} contacts, tenant=${deletedTenant}; leftover ${MARKER} rows: ${count ?? "?"}`,
  );
  expect(count ?? 0).toBe(0);
}, 60_000);

hosted("segment materializer", () => {
  test("hosted SELECT succeeds without lifecycle_stage/score (no 42703)", async () => {
    // If the SELECT still named the drift columns, PostgREST would answer
    // 42703 ("column contacts.lifecycle_stage does not exist") and the query
    // would throw. Resolving at all is the drift-fix proof.
    const result = await materializeSegment(tenantId, { tags: ["segtest"] }, `${MARKER}-list`, {
      client: admin,
    });

    expect(result.segmentCount).toBe(3);
    expect(result.materializedCount).toBe(1);
    expect(result.listId).toBeGreaterThan(0);
  });

  test("lifecycleStage filter throws LifecycleStageUnsupportedError", async () => {
    await expect(
      materializeSegment(tenantId, { lifecycleStage: "lead" }, `${MARKER}-list`, {
        client: admin,
      }),
    ).rejects.toBeInstanceOf(LifecycleStageUnsupportedError);
  });

  test("filters email_opt_out/email_valid contacts", async () => {
    const result = await materializeSegment(tenantId, { tags: ["segtest"] }, `${MARKER}-list`, {
      client: admin,
    });

    expect(result.emails).toEqual([`${MARKER}-sendable@example.com`]);
    expect(result.optedOutCount).toBe(2);
  });

  test("contactGroupId resolves via contact_group_members", async () => {
    const result = await materializeSegment(tenantId, { contactGroupId: groupId }, `${MARKER}-list`, {
      client: admin,
    });

    // Precisely the grouped contact — the three tagged contacts are excluded
    // because they have no membership row.
    expect(result.emails).toEqual([`${MARKER}-grouped@example.com`]);
    expect(result.segmentCount).toBe(1);
    expect(result.optedOutCount).toBe(0);
  });
});
