import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { crmManifest } from "../manifest";

const MIGRATION = "20260919013000_atomic_campaign_recipient_replacement.sql";
const migrationPath = join(dirname(fileURLToPath(import.meta.url)), "../../migrations", MIGRATION);
const RPC = "public.replace_campaign_recipients(UUID, UUID, JSONB)";

/**
 * The 26 campaign_recipients columns a draft may carry: the 31 effective
 * columns minus `id`, `created_at`, `updated_at` (DB-owned) and `tenant_id`,
 * `campaign_id` (injected by the RPC, never read from the caller payload).
 */
const DRAFT_COLUMNS = [
  "list_id",
  "contact_id",
  "first_name",
  "last_name",
  "phone",
  "email",
  "timezone",
  "client_type",
  "custom_fields",
  "status",
  "scheduled_at",
  "attempts",
  "last_attempt_at",
  "completed_at",
  "call_control_id",
  "conversation_id",
  "result",
  "conversation_status",
  "last_turn_at",
  "turn_count",
  "sms_opt_out",
  "retry_attempts",
  "last_inbound_at",
  "provider_recipient_id",
  "provider_message_id",
  "engagement",
] as const;

/** The jsonb_to_recordset column-definition block: what the RPC reads. */
function recordsetColumns(sql: string): string {
  const start = sql.indexOf("jsonb_to_recordset(p_recipients) AS d(");
  expect(start).toBeGreaterThan(-1);
  const rest = sql.slice(start);
  return rest.slice(0, rest.indexOf(");"));
}

describe("atomic campaign recipient replacement RPC", () => {
  it("manifest references the replacement migration for campaign_recipients", () => {
    expect(crmManifest.tables.campaign_recipients.migrations).toContain(MIGRATION);
  });

  it("declares a SECURITY INVOKER RPC over (campaign, tenant, JSONB drafts) with a hardened search_path", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.replace_campaign_recipients(");
    expect(sql).toContain("p_campaign_id UUID");
    expect(sql).toContain("p_tenant_id UUID");
    expect(sql).toContain("p_recipients JSONB");
    expect(sql).toContain("RETURNS INTEGER");
    // SECURITY INVOKER: the caller's RLS still governs every row touched.
    expect(sql).toContain("SECURITY INVOKER");
    expect(sql).not.toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public, pg_temp");
    // Explicit schema qualification on every relation referenced.
    expect(sql).toContain("FROM public.campaigns");
    expect(sql).toContain("DELETE FROM public.campaign_recipients");
    expect(sql).toContain("INSERT INTO public.campaign_recipients (");
  });

  it("locks the live campaign row and validates tenant ownership before any mutation", () => {
    const sql = readFileSync(migrationPath, "utf8");
    const lock = sql.indexOf("FOR UPDATE");
    const remove = sql.indexOf("DELETE FROM public.campaign_recipients");

    expect(lock).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(lock);
    // The locking read is the ownership check: id + bound tenant + live row.
    expect(sql).toContain("c.id = p_campaign_id");
    expect(sql).toContain("c.tenant_id = p_tenant_id");
    expect(sql).toContain("c.deleted_at IS NULL");
    // A missing, foreign, or soft-deleted campaign aborts before deleting.
    expect(sql).toContain("RAISE EXCEPTION");
    expect(sql).toContain("ERRCODE = '42501'");
  });

  it("deletes and inserts only within the bound tenant and campaign", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("r.tenant_id = p_tenant_id");
    expect(sql).toContain("r.campaign_id = p_campaign_id");
    expect(sql).toMatch(/INSERT INTO public\.campaign_recipients \(\s*tenant_id,\s*campaign_id,/);
    expect(sql).toMatch(/SELECT\s*p_tenant_id,\s*p_campaign_id,/);
    expect(sql).toContain("GET DIAGNOSTICS v_replaced = ROW_COUNT");
    expect(sql).toContain("RETURN v_replaced");
  });

  it("injects ownership keys and never reads them from the caller payload", () => {
    const block = recordsetColumns(readFileSync(migrationPath, "utf8"));

    // Caller-supplied tenant_id / campaign_id / id are structurally ignored:
    // they are not part of the recordset definition at all.
    expect(block).not.toContain("tenant_id");
    expect(block).not.toContain("campaign_id");
    expect(block).not.toMatch(/\bid UUID/);
  });

  it("accepts every canonical campaign_recipients draft field", () => {
    const block = recordsetColumns(readFileSync(migrationPath, "utf8"));

    for (const column of DRAFT_COLUMNS) {
      expect(block).toContain(column);
    }
    expect(DRAFT_COLUMNS).toHaveLength(26);
  });

  it("preserves the campaign_recipients column defaults for omitted draft fields", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("COALESCE(d.timezone, 'America/New_York')");
    expect(sql).toContain("COALESCE(d.custom_fields, '{}'::jsonb)");
    expect(sql).toContain("COALESCE(d.status, 'pending')");
    expect(sql).toContain("COALESCE(d.attempts, 0)");
    expect(sql).toContain("COALESCE(d.result, '{}'::jsonb)");
    expect(sql).toContain("COALESCE(d.conversation_status, 'not_started')");
    expect(sql).toContain("COALESCE(d.turn_count, 0)");
    expect(sql).toContain("COALESCE(d.sms_opt_out, false)");
    expect(sql).toContain("COALESCE(d.retry_attempts, 0)");
    expect(sql).toContain("COALESCE(d.engagement, '{}'::jsonb)");
  });

  it("grants EXECUTE only to the intended Supabase roles", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain(`REVOKE ALL ON FUNCTION ${RPC} FROM PUBLIC`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION ${RPC} FROM anon`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${RPC} TO authenticated`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${RPC} TO service_role`);

    const grants = sql.match(
      new RegExp(`GRANT EXECUTE ON FUNCTION ${RPC.replace(/[()]/g, "\\$&")} TO \\w+;`, "g"),
    );
    expect(grants).toHaveLength(2);
    expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION ${RPC} TO anon`);
    expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION ${RPC} TO PUBLIC`);
  });

  it("is rerunnable and rejects a non-array payload", () => {
    const sql = readFileSync(migrationPath, "utf8");

    // CREATE OR REPLACE + idempotent REVOKE/GRANT make reapplication a no-op.
    expect(sql).toContain("CREATE OR REPLACE FUNCTION");
    expect(sql).toContain("jsonb_typeof(p_recipients) IS DISTINCT FROM 'array'");
    // No destructive or identity-changing DDL that a rerun could trip on.
    expect(sql).not.toContain("DROP TABLE");
    expect(sql).not.toContain("DROP FUNCTION");
  });
});
