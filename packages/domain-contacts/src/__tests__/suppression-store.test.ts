import { describe, expect, test } from "vitest";
import { createContactSuppressionStore } from "../index.js";
import { createMockSupabase } from "./helpers/mock-supabase.js";

const TENANT = "11111111-1111-1111-1111-111111111111";

describe("contact suppression store", () => {
  test("lists canonical rows with strict tenant binding", async () => {
    const { client, calls } = createMockSupabase({ data: [] });
    const store = createContactSuppressionStore(client, TENANT);

    await expect(store.list()).resolves.toEqual([]);
    expect(calls).toContainEqual({ op: "eq", args: ["tenant_id", TENANT] });
  });

  test("upserts the canonical identity and persists actor in metadata", async () => {
    const row = { id: "suppression-1", contact_id: "contact-1", channel: "email" };
    const { client, calls } = createMockSupabase({ data: row });
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

    expect(calls).toContainEqual({
      op: "upsert",
      args: [
        {
          tenant_id: TENANT,
          contact_id: "contact-1",
          channel: "email",
          suppressed: true,
          reason: "requested",
          source: "crm-ui",
          metadata: { ticket: "T-1", updated_by: "user-1" },
        },
        { onConflict: "tenant_id,contact_id,channel" },
      ],
    });
    expect(calls).toContainEqual({ op: "eq", args: ["tenant_id", TENANT] });
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

  test("bulk upsert binds every row and query to the tenant", async () => {
    const rows = [{ id: "s-1" }, { id: "s-2" }];
    const { client, calls } = createMockSupabase({ data: rows });
    const store = createContactSuppressionStore(client, TENANT);

    await expect(
      store.setMany(["contact-1", "contact-other-tenant"], {
        channel: "whatsapp",
        suppressed: false,
        reason: "restored",
        source: "crm-ui",
        updatedBy: "user-1",
      }),
    ).resolves.toEqual(rows);

    expect(calls).toContainEqual({ op: "eq", args: ["tenant_id", TENANT] });
  });
});
