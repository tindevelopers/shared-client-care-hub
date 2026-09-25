import type { SupabaseClient } from "@supabase/supabase-js";
import { createActivityStore } from "./activity-store.js";
import type { ActivityStore } from "./activity-store.js";
import { createCompanyStore } from "./company-store.js";
import type { CompanyStore } from "./company-store.js";
import { createDealStageStore } from "./deal-stage-store.js";
import type { DealStageStore } from "./deal-stage-store.js";
import { createDealStore } from "./deal-store.js";
import type { DealStore } from "./deal-store.js";
import { createNoteStore } from "./note-store.js";
import type { NoteStore } from "./note-store.js";
import { createTaskStore } from "./task-store.js";
import type { TaskStore } from "./task-store.js";

export interface PipelineStore {
  companies: CompanyStore;
  dealStages: DealStageStore;
  deals: DealStore;
  tasks: TaskStore;
  notes: NoteStore;
  activities: ActivityStore;
}

/**
 * Compose the six table-scoped stores into a single injected-client entry
 * point for the whole CRM pipeline data layer (companies, deal stages,
 * deals, tasks, notes, activities) — the same composition pattern
 * `domain-support`'s `createSupportStore` uses.
 */
export function createPipelineStore(client: SupabaseClient, tenantId: string): PipelineStore {
  return {
    companies: createCompanyStore(client, tenantId),
    dealStages: createDealStageStore(client, tenantId),
    deals: createDealStore(client, tenantId),
    tasks: createTaskStore(client, tenantId),
    notes: createNoteStore(client, tenantId),
    activities: createActivityStore(client, tenantId),
  };
}
