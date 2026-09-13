import { describe, expect, test } from "vitest";
import { createContactsStore } from "../tenant-store.js";
import { createMockSupabase } from "./helpers/mock-supabase.js";

const TENANT = "11111111-1111-1111-1111-111111111111";
const JOIN_SELECT = "*, company:companies(*)";

/**
 * Read-side parity with the cataloged readers in
 * `apps/app/app/actions/crm/contacts.ts` (getContacts, getContactsByIds,
 * getContact, listContactDialTargetsAction, getAllTags) — VAL-CONTACTS-017.
 */
describe("tenant store read parity", () => {
  test("list/get include company:companies(*) join with created_at desc order", async () => {
    const rows = [{ id: "c-1" }, { id: "c-2" }];
    const listMock = createMockSupabase({ data: rows });
    const list = await createContactsStore(listMock.client, TENANT).list();

    expect(list).toEqual(rows);
    expect(listMock.calls).toEqual([
      { op: "from", args: ["contacts"] },
      { op: "select", args: [JOIN_SELECT] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "order", args: ["created_at", { ascending: false }] },
    ]);

    const getMock = createMockSupabase({ data: rows[0] });
    const got = await createContactsStore(getMock.client, TENANT).get("c-1");

    expect(got).toEqual(rows[0]);
    expect(getMock.calls).toEqual([
      { op: "from", args: ["contacts"] },
      { op: "select", args: [JOIN_SELECT] },
      { op: "eq", args: ["id", "c-1"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "maybeSingle", args: [] },
    ]);
  });

  test("list/get surface reader errors unchanged", async () => {
    const boom = { message: "connection refused" };
    const listMock = createMockSupabase({ error: boom });
    await expect(createContactsStore(listMock.client, TENANT).list()).rejects.toEqual(boom);

    const getMock = createMockSupabase({ error: boom });
    await expect(createContactsStore(getMock.client, TENANT).get("c-1")).rejects.toEqual(boom);
  });

  test("listByIds early-returns [] for empty ids (no query)", async () => {
    const { client, calls } = createMockSupabase();
    await expect(createContactsStore(client, TENANT).listByIds([])).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });

  test("listByIds joins company, filters tenant + ids, orders created_at desc", async () => {
    const rows = [{ id: "c-1" }];
    const { client, calls } = createMockSupabase({ data: rows });

    const out = await createContactsStore(client, TENANT).listByIds(["c-1", "c-2"]);

    expect(out).toEqual(rows);
    expect(calls).toEqual([
      { op: "from", args: ["contacts"] },
      { op: "select", args: [JOIN_SELECT] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "in", args: ["id", ["c-1", "c-2"]] },
      { op: "order", args: ["created_at", { ascending: false }] },
    ]);
  });

  test("listDialTargets returns {value,label} options (phone + mobile, deduped, name fallback)", async () => {
    const rows = [
      { id: "c-1", first_name: "Ada", last_name: "Lovelace", phone: "+15550000001", mobile: "+15550000002" },
      { id: "c-2", first_name: "Bo", last_name: "", phone: "+15550000001", mobile: "  " },
      { id: "c-3", first_name: "", last_name: "", phone: "+15550000003", mobile: null },
    ];
    const { client, calls } = createMockSupabase({ data: rows });

    const options = await createContactsStore(client, TENANT).listDialTargets();

    expect(options).toEqual([
      { value: "+15550000001", label: "Ada Lovelace · +15550000001" },
      { value: "+15550000002", label: "Ada Lovelace · +15550000002 (mobile)" },
      { value: "+15550000003", label: "Contact · +15550000003" },
    ]);
    expect(calls).toEqual([
      { op: "from", args: ["contacts"] },
      { op: "select", args: ["id,first_name,last_name,phone,mobile"] },
      { op: "eq", args: ["tenant_id", TENANT] },
      { op: "order", args: ["updated_at", { ascending: false }] },
      { op: "limit", args: [200] },
    ]);
  });

  test("listDialTargets clamps limit to [1, 500]", async () => {
    const high = createMockSupabase({ data: [] });
    await createContactsStore(high.client, TENANT).listDialTargets(900);
    expect(high.calls[4]).toEqual({ op: "limit", args: [500] });

    const low = createMockSupabase({ data: [] });
    await createContactsStore(low.client, TENANT).listDialTargets(0);
    expect(low.calls[4]).toEqual({ op: "limit", args: [1] });
  });

  test("listTags returns deduped tag set", async () => {
    const rows = [
      { tags: ["beta", "alpha"] },
      { tags: ["alpha", ""] },
      { tags: null },
      { tags: ["gamma"] },
    ];
    const { client, calls } = createMockSupabase({ data: rows });

    const tags = await createContactsStore(client, TENANT).listTags();

    expect(tags).toEqual(["alpha", "beta", "gamma"]);
    expect(calls).toEqual([
      { op: "from", args: ["contacts"] },
      { op: "select", args: ["tags"] },
      { op: "eq", args: ["tenant_id", TENANT] },
    ]);
  });
});
