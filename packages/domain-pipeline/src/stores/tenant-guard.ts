import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Verifies a host-supplied foreign key id belongs to the same tenant before
 * it is written to a row this package owns. A foreign key only proves the
 * row exists somewhere — not that it belongs to this tenant (a service-role
 * client can otherwise link across tenants by id alone). Shared by
 * deal-store, task-store, and note-store, which each accept host-supplied
 * `company_id`/`contact_id`/`deal_id`/`stage_id` references.
 */
export async function assertBelongsToTenant(
  client: SupabaseClient,
  table: string,
  id: string,
  tenantId: string,
  label: string,
): Promise<void> {
  const { data } = await (client.from(table) as any)
    .select("id")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) {
    throw new Error(`${label} not found`);
  }
}
