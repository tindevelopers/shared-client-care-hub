/**
 * Segment Materializer
 * --------------------
 * Queries Konnect's Postgres to resolve a segment definition into a set of
 * contacts, filters out opted-out contacts, and returns the list of eligible
 * emails. The campaignService uses these emails to bulk-add contacts to a
 * Brevo list via the MarketingAutomationProvider.
 *
 * Design:
 *   - segment definition: a structured filter object stored in campaign.settings.
 *     Initially simple: { tags?: string[], lifecycleStage?: LifecycleStage,
 *     contactGroupId?: string, customFilter?: Record<string, unknown> }.
 *   - Resolves contacts from the `contacts` table with the tenant scope.
 *   - Excludes contacts where email_opt_out = true or email_valid = false.
 *   - Returns the list of eligible emails for the campaignService to add to
 *     the Brevo list via the provider.
 *
 * Moved from apps/app/src/core/campaigns/segment-materializer.ts with drift
 * fix #1 applied (ground truth: the hosted DB returns Postgres 42703 for
 * `contacts.lifecycle_stage` and `contacts.score`):
 *   - `lifecycle_stage` and `score` are dropped from the SELECT/projection;
 *   - a `lifecycleStage` segment filter throws LifecycleStageUnsupportedError
 *     BEFORE any DB call instead of crashing at the query;
 *   - `contactGroupId` resolves through `contact_group_members` (a
 *     `contacts.contact_group_id` column does not exist);
 *   - the service-role client is injected by the caller (domains never
 *     construct clients).
 * The opt-out filtering and the zero-eligible early-return shape are
 * preserved exactly.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createLogger } from "@tindevelopers/core-kernel/logger";
import type { LifecycleStage } from "@tindevelopers/adapter-kit/crm/contacts-sync-interface";
import { LifecycleStageUnsupportedError } from "../errors.js";

const log = createLogger("campaigns/materializer");

// ──── Types ────────────────────────────────────────────────────────────

export interface SegmentDefinition {
  /** Filter by contact tags. */
  tags?: string[];
  /** Filter by lifecycle stage. */
  lifecycleStage?: LifecycleStage;
  /** Filter by contact group id. */
  contactGroupId?: string;
  /** Arbitrary custom filter appended to the query WHERE clause.
   *  Only used in internal paths; never from user input without sanitization. */
  customFilter?: Record<string, unknown>;
}

export interface MaterializedAudience {
  /** Number of contacts in the segment (before opt-out filtering). */
  segmentCount: number;
  /** Number of contacts excluded due to opt-out. */
  optedOutCount: number;
  /** Number of contacts actually upserted to the Brevo list. */
  materializedCount: number;
  /** The Brevo list id used. */
  listId: number;
  /** Email addresses that were materialized. */
  emails: string[];
}

/** Injected dependencies — the host app supplies its service-role client. */
export interface SegmentMaterializerDeps {
  client: SupabaseClient;
}

// ──── Public API ──────────────────────────────────────────────────────────

/**
 * Materialize a Konnect segment into a Brevo list, filtering out opted-out
 * contacts.  The caller is responsible for using the returned listId when
 * creating the campaign.
 *
 * @param tenantId    — tenant id
 * @param segment     — segment definition (tags, contactGroupId, etc.)
 * @param _listName   — human-readable list name for Brevo
 * @param deps        — injected service-role client (domains never construct clients)
 */
export async function materializeSegment(
  tenantId: string,
  segment: SegmentDefinition,
  _listName: string,
  deps: SegmentMaterializerDeps
): Promise<MaterializedAudience> {
  // 0. Reject lifecycleStage filters before ANY DB call — the hosted schema
  //    has no contacts.lifecycle_stage column (drift fix #1).
  if (segment.lifecycleStage) {
    throw new LifecycleStageUnsupportedError();
  }

  const admin = deps.client;

  // 1. Build the query for segment contacts
  let query = admin
    .from("contacts")
    .select("id, email, first_name, last_name, phone, tags, custom_fields, sms_opt_out, email_opt_out, email_valid")
    .eq("tenant_id", tenantId)
    .not("email", "is", null);

  // 1a. Filter by tags (contacts.tags is a text[] column)
  if (segment.tags && segment.tags.length > 0) {
    query = query.contains("tags", segment.tags);
  }

  // 1b. Filter by lifecycle stage — unsupported on the hosted schema; thrown
  //     above before any DB call.

  // 1c. Filter by contact group — resolve membership through the existing
  //     contact_group_members table (contacts has no contact_group_id column).
  if (segment.contactGroupId) {
    const { data: memberRows, error: memberError } = await admin
      .from("contact_group_members")
      .select("contact_id")
      .eq("tenant_id", tenantId)
      .eq("group_id", segment.contactGroupId);

    if (memberError) {
      log.error("Failed to query contact group members", { tenantId, error: String(memberError) });
      throw new Error(`Segment query failed: ${memberError.message}`);
    }

    const memberIds = [
      ...new Set(
        ((memberRows ?? []) as Array<{ contact_id: string }>).map((r) =>
          String(r.contact_id),
        ),
      ),
    ];
    query = query.in("id", memberIds);
  }

  const { data: contactsRaw, error: queryError } = await (query as any);

  if (queryError) {
    log.error("Failed to query segment contacts", { tenantId, error: String(queryError) });
    throw new Error(`Segment query failed: ${queryError.message}`);
  }

  const contacts = (contactsRaw ?? []) as Array<{
    id: string;
    email: string;
    email_opt_out?: boolean;
    email_valid?: boolean;
  }>;

  const segmentCount = contacts.length;

  // 2. Filter out opted-out contacts
  const eligibleContacts = contacts.filter(
    (c) => !(c as any).email_opt_out && (c as any).email_valid !== false
  );
  const optedOutCount = segmentCount - eligibleContacts.length;

  // 3. Collect emails
  const emails = eligibleContacts
    .map((c) => c.email)
    .filter((e): e is string => !!e);

  if (emails.length === 0) {
    log.warn("No eligible contacts in segment after opt-out filtering", {
      tenantId,
      segmentCount,
      optedOutCount,
    });
    return {
      segmentCount,
      optedOutCount,
      materializedCount: 0,
      listId: 0,
      emails: [],
    };
  }

  // 4. Use a synthetic listId (actual list creation/upsert is done by the
  //    campaignService via the BrevoMarketingProvider.addContactsToList)
  const listId = 1000 + Math.floor(Math.random() * 9000);

  log.info("Segment materialized", {
    tenantId,
    segmentCount,
    optedOutCount,
    materializedCount: emails.length,
    listId,
  });

  return {
    segmentCount,
    optedOutCount,
    materializedCount: emails.length,
    listId,
    emails,
  };
}
