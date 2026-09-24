import { describe, expect, it } from "vitest";
import { createMockSupabase } from "./helpers/mock-supabase";
import { createSupportAttachmentStore } from "../attachment-store";

const TENANT = "ten-1";

function attachmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "a-1",
    ticket_id: "t-1",
    thread_id: null,
    tenant_id: TENANT,
    file_name: "log.txt",
    file_path: "support-tickets/ten-1/t-1/log.txt",
    file_size: 12,
    mime_type: "text/plain",
    uploaded_by: "user-1",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("createSupportAttachmentStore", () => {
  it("create() verifies the ticket exists in the tenant, then inserts with the injected uploaded_by", async () => {
    const { client, calls } = createMockSupabase([{ data: { id: "t-1" } }, { data: attachmentRow() }]);
    const store = createSupportAttachmentStore(client, TENANT);

    const created = await store.create({
      ticket_id: "t-1",
      file_name: "log.txt",
      file_path: "support-tickets/ten-1/t-1/log.txt",
      file_size: 12,
      mime_type: "text/plain",
      uploaded_by: "user-1",
    });

    expect(created.id).toBe("a-1");
    const insertArgs = calls.find((c) => c.op === "insert")?.args[0] as Record<string, unknown>;
    expect(insertArgs.uploaded_by).toBe("user-1");
    expect(insertArgs.thread_id).toBeNull();
  });

  it("create() rejects when the ticket does not exist in this tenant", async () => {
    const { client } = createMockSupabase([{ data: null }]);
    const store = createSupportAttachmentStore(client, TENANT);

    await expect(
      store.create({
        ticket_id: "missing",
        file_name: "x",
        file_path: "support-tickets/x",
        file_size: 1,
        mime_type: "text/plain",
        uploaded_by: "user-1",
      }),
    ).rejects.toThrow("Ticket not found");
  });

  it("remove() deletes the storage object (bucket-relative path) then the row", async () => {
    const { client, calls } = createMockSupabase([
      { data: { file_path: "support-tickets/ten-1/t-1/log.txt" } },
      { data: null },
    ]);
    const store = createSupportAttachmentStore(client, TENANT);

    await store.remove("a-1");

    const removeCall = calls.find((c) => c.op === "storage.remove");
    expect(removeCall?.args).toEqual(["support-tickets", ["ten-1/t-1/log.txt"]]);
  });

  it("remove() still deletes the row when the storage removal errors", async () => {
    const { client } = createMockSupabase([
      { data: { file_path: "support-tickets/ten-1/t-1/log.txt" } },
      { error: { message: "storage down" } },
      { data: null },
    ]);
    const store = createSupportAttachmentStore(client, TENANT);
    await expect(store.remove("a-1")).resolves.toBeUndefined();
  });

  it("getDownloadUrl() returns a signed URL scoped to the bucket-relative path", async () => {
    const { client, calls } = createMockSupabase([
      { data: { file_path: "support-tickets/ten-1/t-1/log.txt" } },
      { data: { signedUrl: "https://signed.example/log.txt" } },
    ]);
    const store = createSupportAttachmentStore(client, TENANT);

    await expect(store.getDownloadUrl("a-1", 60)).resolves.toBe("https://signed.example/log.txt");
    const signCall = calls.find((c) => c.op === "storage.createSignedUrl");
    expect(signCall?.args).toEqual(["support-tickets", "ten-1/t-1/log.txt", 60]);
  });

  it("getDownloadUrl() returns null when the attachment does not exist", async () => {
    const { client } = createMockSupabase([{ data: null }]);
    const store = createSupportAttachmentStore(client, TENANT);
    await expect(store.getDownloadUrl("missing")).resolves.toBeNull();
  });
});
