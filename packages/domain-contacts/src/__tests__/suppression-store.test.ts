import { describe, expect, test } from "vitest";
import { ContactNotFoundError, createContactSuppressionStore } from "../index.js";
import { createMockSupabase } from "./helpers/mock-supabase.js";

const TENANT = "11111111-1111-1111-1111-111111111111";
const ON_CONFLICT = { onConflict: "tenant_id,contact_id,channel" };

/**
 * Call-sequence assertions: every tenant predicate is proven to belong to the
 * query it guards (each `eq tenant_id` immediately follows its own `from`).
 */
describe("contact suppression store", () => {
  test("list binds the tenant (and optional contact) filter on one query", async () => {
    const { client, calls } = createMockSupabase({ data: [] });
    const store = createContactSuppressionStore(client, TENANT);

    await expect(store.list("contact-1")).resolves.toEqual([]);
    expect(calls).toEqual([
      { op: "from", args: ["contact_suppressions"] },
      { op: "select", args: ["*"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "eq", args: ["contact_id", "contact-1"] },
      { op: "order", args: ["updated_at", { ascending: false }] },
    ]);
  });

  test("set validates the contact in-tenant, then upserts the canonical row with the updated_by column", async () => {
    const row = { id: "suppression-1", contact_id: "contact-1", channel: "email" };
    const { client, calls } = createMockSupabase([
      { data: { id: "contact-1" } }, // in-tenant contact check
      { data: row }, // canonical upsert result
    ]);
    const store = createContactSuppressionStore(client, TENANT);

    await expect(
      store.set("contact-1", {
        channel: "email",
        suppressed: true,
        reason: "requested",
        source: "crm-ui",
        metadata: { ticket: "T-1" },
        updatedBy: "user-1",
      }),
    ).resolves.toEqual(row);

    expect(calls).toEqual([
      { op: "from", args: ["contacts"] },
      { op: "select", args: ["id"] },
      { op: "eq", args: ["id", "contact-1"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "maybeSingle", args: [] },
      { op: "from", args: ["contact_suppressions"] },
      {
        op: "upsert",
        args: [
          {
            tenant_id: TENANT,
            contact_id: "contact-1",
            channel: "email",
            suppressed: true,
            reason: "requested",
            source: "crm-ui",
            // The actor lives in the dedicated column, never in metadata.
            metadata: { ticket: "T-1" },
            updated_by: "user-1",
          },
          ON_CONFLICT,
        ],
      },
      { op: "select", args: ["*"] },
      { op: "single", args: [] },
    ]);
  });

  test("set on a cross-tenant contact is a zero-effect rejection (no upsert issued)", async () => {
    const { client, calls } = createMockSupabase({ data: null });
    const store = createContactSuppressionStore(client, TENANT);

    await expect(
      store.set("contact-other-tenant", {
        channel: "email",
        suppressed: true,
        reason: null,
        source: "crm-ui",
        updatedBy: "user-1",
      }),
    ).rejects.toBeInstanceOf(ContactNotFoundError);
    expect(calls).toEqual([
      { op: "from", args: ["contacts"] },
      { op: "select", args: ["id"] },
      { op: "eq", args: ["id", "contact-other-tenant"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "maybeSingle", args: [] },
    ]);
  });

  test("setMany narrows to tenant-owned contacts; cross-tenant ids never reach the upsert", async () => {
    const rows = [{ id: "s-1" }];
    const { client, calls } = createMockSupabase([
      { data: [{ id: "contact-1" }] }, // tenant narrowing: contact-other-tenant absent
      { data: rows },
    ]);
    const store = createContactSuppressionStore(client, TENANT);

    await expect(
      store.setMany(["contact-1", "contact-other-tenant"], {
        channel: "whatsapp",
        suppressed: false,
        reason: "restored",
        source: "crm-ui",
        updatedBy: null,
      }),
    ).resolves.toEqual(rows);

    expect(calls).toEqual([
      { op: "from", args: ["contacts"] },
      { op: "select", args: ["id"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "in", args: ["id", ["contact-1", "contact-other-tenant"]] },
      { op: "from", args: ["contact_suppressions"] },
      {
        op: "upsert",
        args: [
          [
            {
              tenant_id: TENANT,
              contact_id: "contact-1",
              channel: "whatsapp",
              suppressed: false,
              reason: "restored",
              source: "crm-ui",
              metadata: {},
              updated_by: null,
            },
          ],
          ON_CONFLICT,
        ],
      },
      { op: "select", args: ["*"] },
    ]);
  });

  test("setMany with only cross-tenant contacts issues no write", async () => {
    const { client, calls } = createMockSupabase({ data: [] });
    const store = createContactSuppressionStore(client, TENANT);

    await expect(
      store.setMany(["contact-other-tenant"], {
        channel: "sms",
        suppressed: true,
        reason: null,
        source: "crm-ui",
        updatedBy: "user-1",
      }),
    ).resolves.toEqual([]);
    expect(calls).toEqual([
      { op: "from", args: ["contacts"] },
      { op: "select", args: ["id"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "in", args: ["id", ["contact-other-tenant"]] },
    ]);
  });

  test("empty bulk input issues no write", async () => {
    const { client, calls } = createMockSupabase();
    const store = createContactSuppressionStore(client, TENANT);

    await expect(
      store.setMany([], {
        channel: "sms",
        suppressed: true,
        reason: null,
        source: "crm-ui",
        updatedBy: "user-1",
      }),
    ).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });
});
