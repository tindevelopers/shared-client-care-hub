import { describe, expect, it } from "vitest";
import { createMockSupabase } from "./helpers/mock-supabase";
import { createPipelineStore } from "../pipeline-store";

const TENANT = "ten-1";

describe("createPipelineStore", () => {
  it("composes every entity store", () => {
    const { client } = createMockSupabase();
    const store = createPipelineStore(client, TENANT);

    for (const key of [
      "companies",
      "dealStages",
      "deals",
      "tasks",
      "notes",
      "activities",
      "customFields",
    ] as const) {
      expect(store[key]).toBeTruthy();
    }
    expect(store.companies.list).toBeInstanceOf(Function);
    expect(store.dealStages.seedDefaults).toBeInstanceOf(Function);
    expect(store.deals.listByStage).toBeInstanceOf(Function);
    expect(store.tasks.bulkComplete).toBeInstanceOf(Function);
    expect(store.notes.create).toBeInstanceOf(Function);
    expect(store.activities.logEntityCreated).toBeInstanceOf(Function);
    expect(store.customFields.list).toBeInstanceOf(Function);
  });
});
