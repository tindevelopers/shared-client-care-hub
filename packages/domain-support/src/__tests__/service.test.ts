import { describe, expect, it, vi } from "vitest";
import { createSupportService, type SupportStore } from "../store";
import type { SupportNotification } from "../notifications";
import type {
  SupportCategory,
  SupportTicket,
  SupportTicketAttachment,
  SupportTicketThread,
} from "../types";
import type { CreateSupportTicketInput } from "../stores/ticket-store";

function ticket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  return {
    id: "t-1",
    tenant_id: "ten-1",
    partner_id: null,
    owner_scope: "tenant",
    ticket_number: "TKT-1",
    subject: "Login broken",
    description: "Cannot sign in",
    status: "open",
    priority: "high",
    category_id: null,
    group_id: null,
    created_by: "user-customer",
    assigned_to: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    support_code: null,
    support_ref: null,
    escalated_to_platform_admin_at: null,
    external_refs: {},
    sync_state: {},
    ...overrides,
  };
}

function draft(overrides: Partial<CreateSupportTicketInput> = {}): CreateSupportTicketInput {
  return {
    subject: "Login broken",
    description: "Cannot sign in",
    priority: "high",
    created_by: "user-customer",
    ...overrides,
  };
}

function thread(overrides: Partial<SupportTicketThread> = {}): SupportTicketThread {
  return {
    id: "th-1",
    ticket_id: "t-1",
    tenant_id: "ten-1",
    partner_id: null,
    owner_scope: "tenant",
    user_id: "user-agent",
    message: "We are on it",
    is_internal: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const attachment: SupportTicketAttachment = {
  id: "a-1",
  ticket_id: "t-1",
  thread_id: null,
  tenant_id: "ten-1",
  partner_id: null,
  owner_scope: "tenant",
  file_name: "log.txt",
  file_path: "support-tickets/ten-1/t-1/log.txt",
  file_size: 12,
  mime_type: "text/plain",
  uploaded_by: "user-customer",
  created_at: "2026-01-01T00:00:00Z",
};

const category: SupportCategory = {
  id: "c-1",
  tenant_id: "ten-1",
  partner_id: null,
  owner_scope: "tenant",
  name: "Billing",
  description: null,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function fakeStore(): SupportStore {
  return {
    listTickets: vi.fn().mockResolvedValue([ticket()]),
    getTicket: vi.fn().mockResolvedValue(ticket()),
    createTicket: vi.fn().mockImplementation(async (input: CreateSupportTicketInput) =>
      ticket({
        subject: input.subject,
        description: input.description ?? null,
        priority: input.priority ?? "medium",
        created_by: input.created_by,
        assigned_to: input.assigned_to ?? null,
      }),
    ),
    updateTicket: vi.fn().mockImplementation(async (_id: string, input) => ticket(input)),
    listThreads: vi.fn().mockResolvedValue([thread()]),
    appendThread: vi.fn().mockImplementation(async (input) =>
      thread({
        ticket_id: input.ticket_id,
        user_id: input.user_id,
        message: input.message,
        is_internal: input.is_internal ?? false,
      }),
    ),
    listAttachments: vi.fn().mockResolvedValue([attachment]),
    listCategories: vi.fn().mockResolvedValue([category]),
    saveCategory: vi.fn().mockResolvedValue(category),
    deleteCategory: vi.fn().mockResolvedValue(undefined),
  };
}

function setup(options?: {
  send?: (input: SupportNotification) => Promise<void>;
  syncDeskBestEffort?: (t: SupportTicket) => Promise<void>;
}) {
  const store = fakeStore();
  const sent: SupportNotification[] = [];
  const calls: string[] = [];
  const notifications = {
    send:
      options?.send ??
      (async (input: SupportNotification) => {
        sent.push(input);
      }),
  };
  const syncDeskBestEffort =
    options?.syncDeskBestEffort ??
    (async () => {
      calls.push("syncDeskBestEffort");
    });
  (store.createTicket as ReturnType<typeof vi.fn>).mockImplementation(
    async (input: CreateSupportTicketInput) => {
      calls.push("createTicket");
      return ticket({
        subject: input.subject,
        description: input.description ?? null,
        created_by: input.created_by,
        assigned_to: input.assigned_to ?? null,
      });
    },
  );
  const service = createSupportService({ store, notifications, syncDeskBestEffort });
  return { service, store, sent, calls };
}

describe("createSupportService — store delegation", () => {
  it("lists tickets through the injected store only", async () => {
    const { service, store } = setup();
    const query = { status: "open" as const };
    await expect(service.listTickets(query)).resolves.toEqual([ticket()]);
    expect(store.listTickets).toHaveBeenCalledWith(query);
  });

  it("gets a ticket through the injected store only", async () => {
    const { service, store } = setup();
    await expect(service.getTicket("t-1")).resolves.toEqual(ticket());
    expect(store.getTicket).toHaveBeenCalledWith("t-1");
  });

  it("lists threads through the injected store only", async () => {
    const { service, store } = setup();
    await expect(service.listThreads("t-1")).resolves.toEqual([thread()]);
    expect(store.listThreads).toHaveBeenCalledWith("t-1");
  });

  it("lists attachments through the injected store only", async () => {
    const { service, store } = setup();
    await expect(service.listAttachments("t-1")).resolves.toEqual([attachment]);
    expect(store.listAttachments).toHaveBeenCalledWith("t-1");
  });

  it("lists categories through the injected store only", async () => {
    const { service, store } = setup();
    await expect(service.listCategories()).resolves.toEqual([category]);
    expect(store.listCategories).toHaveBeenCalledOnce();
  });

  it("saves a category through the injected store only", async () => {
    const { service, store } = setup();
    const input = { name: "Billing", description: null };
    await expect(service.saveCategory(input)).resolves.toEqual(category);
    expect(store.saveCategory).toHaveBeenCalledWith(input);
  });

  it("deletes a category through the injected store only", async () => {
    const { service, store } = setup();
    await service.deleteCategory("c-1");
    expect(store.deleteCategory).toHaveBeenCalledWith("c-1");
  });
});

describe("createSupportService — ticket creation", () => {
  it("writes the first-party ticket before any desk sync", async () => {
    const { service, calls } = setup();
    await service.createTicket(draft({ assigned_to: "user-agent" }));
    expect(calls).toEqual(["createTicket", "syncDeskBestEffort"]);
  });

  it("notifies the customer and the assignee after creation", async () => {
    const { service, sent } = setup();
    const saved = await service.createTicket(draft({ assigned_to: "user-agent" }));
    expect(saved.id).toBe("t-1");
    expect(sent.map((n) => [n.type, n.recipient])).toEqual([
      ["ticket_created", "customer"],
      ["ticket_created", "assignee"],
    ]);
  });

  it("never breaks ticket creation when a notification fails", async () => {
    const { service, store } = setup({
      send: vi.fn().mockRejectedValue(new Error("smtp down")),
    });
    const saved = await service.createTicket(draft());
    expect(saved.id).toBe("t-1");
    expect(store.createTicket).toHaveBeenCalledOnce();
  });

  it("never breaks ticket creation when the desk sync fails", async () => {
    const { service, store } = setup({
      syncDeskBestEffort: vi.fn().mockRejectedValue(new Error("desk down")),
    });
    const saved = await service.createTicket(draft());
    expect(saved.id).toBe("t-1");
    expect(store.createTicket).toHaveBeenCalledOnce();
  });
});

describe("createSupportService — ticket updates", () => {
  it("merges the input onto the stored ticket and notifies changed fields", async () => {
    const { service, store, sent } = setup();
    (store.getTicket as ReturnType<typeof vi.fn>).mockResolvedValue(ticket());

    const updated = await service.updateTicket("t-1", { status: "resolved", priority: "low" });

    expect(store.updateTicket).toHaveBeenCalledWith(
      "t-1",
      expect.objectContaining({ status: "resolved", priority: "low" }),
    );
    expect(updated?.status).toBe("resolved");
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("ticket_updated");
    expect(sent[0].recipient).toBe("customer");
    expect(sent[0].html).toContain("resolved");
  });

  it("sends an escalation notification when escalated_to_platform_admin_at is newly set", async () => {
    const { service, sent } = setup();
    await service.updateTicket("t-1", {
      escalated_to_platform_admin_at: "2026-01-02T00:00:00Z",
    });
    expect(sent.map((n) => n.type)).toContain("ticket_escalated");
    expect(sent.find((n) => n.type === "ticket_escalated")?.recipient).toBe("platform_admins");
  });

  it("sends no notification when nothing changed", async () => {
    const { service, sent } = setup();
    await service.updateTicket("t-1", { status: "open" });
    expect(sent).toEqual([]);
  });

  it("returns null when the ticket does not exist", async () => {
    const { service, store } = setup();
    (store.getTicket as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(service.updateTicket("missing", { status: "closed" })).resolves.toBeNull();
    expect(store.updateTicket).not.toHaveBeenCalled();
  });
});

describe("createSupportService — threads", () => {
  it("appends a thread through the store and notifies the customer on an agent reply", async () => {
    const { service, store, sent } = setup();
    (store.getTicket as ReturnType<typeof vi.fn>).mockResolvedValue(
      ticket({ created_by: "user-customer" }),
    );

    const created = await service.appendThread({
      ticket_id: "t-1",
      user_id: "user-agent",
      message: "We are on it",
    });

    expect(store.appendThread).toHaveBeenCalledOnce();
    expect(created.id).toBe("th-1");
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("ticket_reply");
    expect(sent[0].recipient).toBe("customer");
  });

  it("notifies the assignee on a customer reply", async () => {
    const { service, store, sent } = setup();
    (store.getTicket as ReturnType<typeof vi.fn>).mockResolvedValue(
      ticket({ assigned_to: "user-agent" }),
    );

    await service.appendThread({
      ticket_id: "t-1",
      user_id: "user-customer",
      message: "Any update?",
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("ticket_reply");
    expect(sent[0].recipient).toBe("assignee");
  });

  it("sends no reply notification when the customer replies to an unassigned ticket", async () => {
    const { service, sent } = setup();
    await service.appendThread({
      ticket_id: "t-1",
      user_id: "user-customer",
      message: "Any update?",
    });
    expect(sent).toEqual([]);
  });

  it("sends no notification for an internal note", async () => {
    const { service, sent } = setup();
    await service.appendThread({
      ticket_id: "t-1",
      user_id: "user-agent",
      message: "internal",
      is_internal: true,
    });
    expect(sent).toEqual([]);
  });
});
