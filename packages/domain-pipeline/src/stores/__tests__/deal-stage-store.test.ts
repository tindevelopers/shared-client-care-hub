import { describe, expect, it } from "vitest";
import { createMockSupabase } from "./helpers/mock-supabase";
import { createDealStageStore, DEFAULT_DEAL_STAGES } from "../deal-stage-store";

const TENANT = "ten-1";

function stageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ds-1",
    tenant_id: TENANT,
    name: "Lead",
    position: 0,
    color: "#94a3b8",
    is_closed: false,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("createDealStageStore", () => {
  it("list() scopes to the tenant, ordered by position ascending", async () => {
    const { client, calls } = createMockSupabase({ data: [stageRow()] });
    const store = createDealStageStore(client, TENANT);

    await store.list();

    expect(calls.find((c) => c.op === "from")?.args).toEqual(["deal_stages"]);
    expect(calls.filter((c) => c.op === "eq").map((c) => c.args)).toContainEqual(["tenant_id", TENANT]);
    expect(calls.find((c) => c.op === "order")?.args).toEqual(["position", { ascending: true }]);
  });

  it("create() injects tenant_id and defaults color/is_closed", async () => {
    const { client, calls } = createMockSupabase({ data: stageRow() });
    const store = createDealStageStore(client, TENANT);

    await store.create({ name: "Lead", position: 0, color: "" });

    const insertArgs = calls.find((c) => c.op === "insert")?.args[0] as Record<string, unknown>;
    expect(insertArgs).toMatchObject({ tenant_id: TENANT, name: "Lead", position: 0, color: null, is_closed: false });
  });

  it("update() scopes to id + tenant", async () => {
    const { client, calls } = createMockSupabase({ data: stageRow({ name: "Renamed" }) });
    const store = createDealStageStore(client, TENANT);

    await store.update("ds-1", { name: "Renamed" });

    const eqArgs = calls.filter((c) => c.op === "eq").map((c) => c.args);
    expect(eqArgs).toContainEqual(["id", "ds-1"]);
    expect(eqArgs).toContainEqual(["tenant_id", TENANT]);
  });

  it("seedDefaults() inserts the six default stages when the tenant has none yet", async () => {
    const defaultRows = DEFAULT_DEAL_STAGES.map((stage, i) => stageRow({ ...stage, id: `ds-${i}` }));
    const { client, calls } = createMockSupabase([
      { data: [] }, // list() finds nothing
      { data: defaultRows }, // insert of the six defaults
    ]);
    const store = createDealStageStore(client, TENANT);

    const result = await store.seedDefaults();

    expect(result).toHaveLength(6);
    const insertArgs = calls.find((c) => c.op === "insert")?.args[0] as Array<Record<string, unknown>>;
    expect(insertArgs).toHaveLength(6);
    expect(insertArgs.map((s) => s.name)).toEqual(["Lead", "Qualified", "Proposal", "Negotiation", "Won", "Lost"]);
    expect(insertArgs.every((s) => s.tenant_id === TENANT)).toBe(true);
  });

  it("seedDefaults() is a no-op when the tenant already has stages", async () => {
    const { client, calls } = createMockSupabase([{ data: [stageRow()] }]);
    const store = createDealStageStore(client, TENANT);

    const result = await store.seedDefaults();

    expect(result).toEqual([stageRow()]);
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });
});
