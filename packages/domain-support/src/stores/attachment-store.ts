import type { SupabaseClient } from "@supabase/supabase-js";
import type { SupportTicketAttachment } from "../types.js";

/**
 * Tenant-tier support ticket attachment store, ported from
 * `@tindevelopers/core-kernel/support/attachments`. Injection-only:
 * `uploaded_by` is an explicit argument on `create`, never resolved from a
 * request session. Storage access (upload bytes elsewhere, delete, signed
 * URLs) goes through the injected `SupabaseClient`'s `storage` API against
 * the `support-tickets` bucket — same bucket and path convention as before.
 */

const ATTACHMENT_SELECT = `
  *,
  uploaded_by_user:users!support_ticket_attachments_uploaded_by_fkey(id, full_name, email)
`;

const BUCKET = "support-tickets";

function storagePath(filePath: string): string {
  return filePath.replace(/^\/?support-tickets\//, "");
}

// file_path is host-supplied; without this a caller could record, sign or delete another tenant's object.
function tenantStoragePath(filePath: string, tenantId: string): string {
  const path = storagePath(filePath);
  if (!path.startsWith(`${tenantId}/`) || path.split("/").includes("..")) {
    throw new Error("Attachment path is outside the tenant's storage folder");
  }
  return path;
}

export interface CreateSupportAttachmentInput {
  ticket_id: string;
  thread_id?: string;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  /** The actor uploading the file — resolved and injected by the host. */
  uploaded_by: string;
}

export interface SupportAttachmentStore {
  list(ticketId: string, threadId?: string): Promise<SupportTicketAttachment[]>;
  get(id: string): Promise<SupportTicketAttachment | null>;
  create(input: CreateSupportAttachmentInput): Promise<SupportTicketAttachment>;
  remove(id: string): Promise<void>;
  getDownloadUrl(id: string, expiresIn?: number): Promise<string | null>;
}

export function createSupportAttachmentStore(
  client: SupabaseClient,
  tenantId: string,
): SupportAttachmentStore {
  const table = () => client.from("support_ticket_attachments") as any;
  const tickets = () => client.from("support_tickets") as any;
  const threads = () => client.from("support_ticket_threads") as any;

  return {
    async list(ticketId, threadId) {
      let q = table()
        .select(ATTACHMENT_SELECT)
        .eq("ticket_id", ticketId)
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (threadId) q = q.eq("thread_id", threadId);

      const { data, error } = await q;
      if (error) throw error;
      return (data as SupportTicketAttachment[]) ?? [];
    },

    async get(id) {
      const { data, error } = await table()
        .select(ATTACHMENT_SELECT)
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .single();
      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      return data as SupportTicketAttachment;
    },

    async create(input) {
      tenantStoragePath(input.file_path, tenantId);
      const { data: ticket } = await tickets()
        .select("id")
        .eq("id", input.ticket_id)
        .eq("tenant_id", tenantId)
        .single();
      if (!ticket) {
        throw new Error("Ticket not found");
      }

      // thread_id is host-supplied; without this a caller could attach a
      // file to another tenant's thread by id alone.
      if (input.thread_id) {
        const { data: thread } = await threads()
          .select("id")
          .eq("id", input.thread_id)
          .eq("ticket_id", input.ticket_id)
          .eq("tenant_id", tenantId)
          .single();
        if (!thread) {
          throw new Error("Thread not found");
        }
      }

      const { data, error } = await table()
        .insert({
          ticket_id: input.ticket_id,
          thread_id: input.thread_id ?? null,
          tenant_id: tenantId,
          file_name: input.file_name,
          file_path: input.file_path,
          file_size: input.file_size,
          mime_type: input.mime_type,
          uploaded_by: input.uploaded_by,
        })
        .select(ATTACHMENT_SELECT)
        .single();
      if (error) throw error;
      return data as SupportTicketAttachment;
    },

    async remove(id) {
      const { data: attachment } = await table()
        .select("file_path")
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .single();

      if (attachment) {
        const { error: storageError } = await client.storage
          .from(BUCKET)
          .remove([tenantStoragePath((attachment as { file_path: string }).file_path, tenantId)]);
        if (storageError) {
          console.error("Failed to delete file from storage:", storageError);
          // Continue with database deletion even if storage deletion fails.
        }
      }

      const { error } = await table().delete().eq("id", id).eq("tenant_id", tenantId);
      if (error) throw error;
    },

    async getDownloadUrl(id, expiresIn = 3600) {
      const { data: attachment } = await table()
        .select("file_path")
        .eq("id", id)
        .eq("tenant_id", tenantId)
        .single();
      if (!attachment) return null;

      const { data } = await client.storage
        .from(BUCKET)
        .createSignedUrl(tenantStoragePath((attachment as { file_path: string }).file_path, tenantId), expiresIn);
      return data?.signedUrl ?? null;
    },
  };
}
