import { describe, expect, it } from "vitest";
import { buildUpstreamTicket, selectEscalationTarget } from "../escalation";
import { canChangeStatus, canEscalate } from "../status";
import { ownerColumns, ownerOf } from "../types";
import { attachment, category, thread, ticket } from "./fixtures";

const tenant = { scope: "tenant", tenantId: "ten-1" } as const;
const subtenantParent = { scope: "tenant", tenantId: "ten-parent" } as const;
const partner = { scope: "partner", partnerId: "par-1" } as const;
const platform = { scope: "platform" } as const;

describe("selectEscalationTarget", () => {
  it("allows each owner's direct parent", () => {
    expect(selectEscalationTarget(tenant, subtenantParent)).toEqual(subtenantParent);
    expect(selectEscalationTarget(tenant, partner)).toEqual(partner);
    expect(selectEscalationTarget(tenant, platform)).toEqual(platform);
    expect(selectEscalationTarget(partner, platform)).toEqual(platform);
  });

  it("treats the platform as the top of the chain", () => {
    expect(() => selectEscalationTarget(platform, null)).toThrow("top of the support chain");
    expect(() => selectEscalationTarget(tenant, null)).toThrow("top of the support chain");
  });

  it("rejects escalating to the same owner or downwards", () => {
    expect(() => selectEscalationTarget(tenant, tenant)).toThrow("its own owner");
    expect(() => selectEscalationTarget(partner, tenant)).toThrow("only escalate to the platform");
  });
});

describe("buildUpstreamTicket", () => {
  const base = {
    ticket: ticket({
      support_code: "KX-NUM-004",
      category: category,
      created_by_user: { id: "user-customer", full_name: "Ann Lee", email: "ann@example.com" },
    }),
    threads: [
      thread({ id: "th-1", message: "Customer says it fails at login" }),
      thread({ id: "th-2", message: "Internal: suspect SSO", is_internal: true }),
    ],
    attachments: [attachment],
    target: partner,
    actorId: "user-agent",
    fromOwnerLabel: "Acme Retail",
  };

  it("creates an open ticket owned by the target, authored by the escalating agent", () => {
    const { draft } = buildUpstreamTicket(base);
    expect(draft.ticket).toMatchObject({
      ...ownerColumns(partner),
      status: "open",
      subject: "Login broken",
      priority: "high",
      created_by: "user-agent",
      assigned_to: null,
      category_id: null,
      support_code: "KX-NUM-004",
    });
    expect(draft.ticket.description).toContain("Escalated from Acme Retail, ticket TKT-1.");
    expect(draft.ticket.description).toContain("Category: Billing");
  });

  it("withholds requester identity, replies, notes and attachments by default", () => {
    const { draft, shared } = buildUpstreamTicket(base);
    const text = JSON.stringify(draft);
    expect(text).not.toContain("Ann Lee");
    expect(text).not.toContain("ann@example.com");
    expect(text).not.toContain("suspect SSO");
    expect(draft.threads).toEqual([]);
    expect(draft.attachment_ids).toEqual([]);
    expect(shared).toEqual({
      fields: ["subject", "description", "priority", "source_owner", "source_ticket_number", "support_code", "category_name"],
      requester_contact: false,
      description_edited: false,
      thread_ids: [],
      attachment_ids: [],
    });
  });

  it("shares exactly what the agent chose, and records it", () => {
    const { draft, shared } = buildUpstreamTicket({
      ...base,
      choices: {
        description: "Login fails for SSO users",
        includeRequesterContact: true,
        threadIds: ["th-2"],
        attachmentIds: ["a-1"],
      },
    });
    expect(draft.ticket.description).toMatch(/^Login fails for SSO users/);
    expect(draft.ticket.description).toContain("Requester: Ann Lee <ann@example.com>");
    expect(draft.threads).toEqual([{ message: "Internal: suspect SSO", is_internal: true }]);
    expect(draft.attachment_ids).toEqual(["a-1"]);
    expect(shared).toMatchObject({
      requester_contact: true,
      description_edited: true,
      thread_ids: ["th-2"],
      attachment_ids: ["a-1"],
    });
    expect(shared.fields).toContain("requester_contact");
  });

  it("rejects a selected reply or attachment from another ticket", () => {
    expect(() => buildUpstreamTicket({ ...base, choices: { threadIds: ["th-other"] } })).toThrow(
      'reply or note "th-other" does not belong',
    );
    expect(() => buildUpstreamTicket({ ...base, choices: { attachmentIds: ["a-other"] } })).toThrow(
      'attachment "a-other" does not belong',
    );
  });

  it("refuses to share requester contact it does not have", () => {
    expect(() =>
      buildUpstreamTicket({
        ...base,
        ticket: ticket(),
        choices: { includeRequesterContact: true },
      }),
    ).toThrow("no requester details");
  });
});

describe("status rules", () => {
  it("never allows waiting_on_upstream to be set or cleared by hand", () => {
    expect(canChangeStatus("in_progress", "waiting_on_upstream")).toBe(false);
    expect(canChangeStatus("waiting_on_upstream", "in_progress")).toBe(false);
    expect(canChangeStatus("waiting_on_upstream", "resolved")).toBe(false);
  });

  it("lets a requester reopen a resolved ticket, never a closed one", () => {
    expect(canChangeStatus("resolved", "in_progress")).toBe(true);
    expect(canChangeStatus("closed", "in_progress")).toBe(false);
  });

  it("escalates only tickets the owner is still working on", () => {
    expect(["open", "in_progress", "waiting_on_customer"].every((s) => canEscalate(s as never))).toBe(true);
    expect(["waiting_on_upstream", "resolved", "closed"].some((s) => canEscalate(s as never))).toBe(false);
  });
});

describe("ownerOf", () => {
  it("reads each valid owner", () => {
    expect(ownerOf(ownerColumns(tenant))).toEqual(tenant);
    expect(ownerOf(ownerColumns(partner))).toEqual(partner);
    expect(ownerOf(ownerColumns(platform))).toEqual(platform);
  });

  it("rejects rows that break the exactly-one-owner rule", () => {
    expect(() => ownerOf({ owner_scope: "tenant", tenant_id: null, partner_id: null })).toThrow("invalid owner");
    expect(() => ownerOf({ owner_scope: "partner", tenant_id: "ten-1", partner_id: "par-1" })).toThrow();
    expect(() => ownerOf({ owner_scope: "platform", tenant_id: "ten-1", partner_id: null })).toThrow();
  });
});
