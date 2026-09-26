import { describe, expect, it } from "vitest";
import {
  supportTicketAttachmentInsertSchema,
  supportTicketAttachmentRowSchema,
  supportTicketAttachmentUpdateSchema,
} from "../attachments";

const NOW = "2026-09-24T10:00:00.000+00:00";
const TENANT = "9a1b2c3d-0000-4000-8000-000000000010";
const TICKET = "9a1b2c3d-0000-4000-8000-000000000001";
const THREAD = "9a1b2c3d-0000-4000-8000-000000000002";
const USER = "9a1b2c3d-0000-4000-8000-000000000011";

/** Ground-truth fixture: support_ticket_attachments composite DDL (2 migrations). */
const attachmentFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000003",
  ticket_id: TICKET,
  thread_id: THREAD,
  tenant_id: TENANT,
  partner_id: null,
  owner_scope: "tenant",
  file_name: "screenshot.png",
  file_path: "support-tickets/9a1b2c3d.../screenshot.png",
  file_size: 102400,
  mime_type: "image/png",
  uploaded_by: USER,
  created_at: NOW,
};

describe("support_ticket_attachments", () => {
  it("row round-trip (12 columns, no updated_at)", () => {
    expect(Object.keys(supportTicketAttachmentRowSchema.shape).sort()).toEqual(
      [
        "id",
        "ticket_id",
        "thread_id",
        "tenant_id",
        "partner_id",
        "owner_scope",
        "file_name",
        "file_path",
        "file_size",
        "mime_type",
        "uploaded_by",
        "created_at",
      ].sort(),
    );
    const parsed = supportTicketAttachmentRowSchema.parse(attachmentFixture);
    expect(parsed).toEqual(attachmentFixture);
    expect(supportTicketAttachmentRowSchema.parse(parsed)).toEqual(parsed);
  });

  it("rejects unrecognized keys (strict)", () => {
    expect(
      supportTicketAttachmentRowSchema.safeParse({ ...attachmentFixture, extra: true }).success,
    ).toBe(false);
  });

  it("owner_scope rejects a value outside tenant/partner/platform", () => {
    expect(
      supportTicketAttachmentRowSchema.safeParse({ ...attachmentFixture, owner_scope: "bogus" })
        .success,
    ).toBe(false);
  });

  it("thread_id is nullable (attachment can be on the ticket directly)", () => {
    expect(
      supportTicketAttachmentRowSchema.safeParse({ ...attachmentFixture, thread_id: null }).success,
    ).toBe(true);
  });

  it("tenant_id is nullable (20260924100000 — overwritten by the owner-inherit trigger anyway)", () => {
    expect(
      supportTicketAttachmentRowSchema.safeParse({
        ...attachmentFixture,
        tenant_id: null,
        owner_scope: "platform",
      }).success,
    ).toBe(true);
  });

  it("insert requires every NOT NULL column except id/created_at/tenant_id/partner_id/owner_scope", () => {
    const required = {
      ticket_id: TICKET,
      file_name: "screenshot.png",
      file_path: "support-tickets/x/screenshot.png",
      file_size: 100,
      mime_type: "image/png",
      uploaded_by: USER,
    };
    expect(supportTicketAttachmentInsertSchema.safeParse(required).success).toBe(true);
    for (const key of Object.keys(required)) {
      const payload = { ...required } as Record<string, unknown>;
      delete payload[key];
      expect(supportTicketAttachmentInsertSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("update accepts partial patches and rejects unknown keys", () => {
    expect(
      supportTicketAttachmentUpdateSchema.safeParse({ file_name: "renamed.png" }).success,
    ).toBe(true);
    expect(supportTicketAttachmentUpdateSchema.safeParse({ nope: 1 }).success).toBe(false);
  });
});
