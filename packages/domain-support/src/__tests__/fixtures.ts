import { vi } from "vitest";
import type { SupportEscalationGateway, SupportStore } from "../store";
import type { SupportOwnerChain } from "../escalation";
import type {
  SupportCategory,
  SupportGroup,
  SupportTicket,
  SupportTicketAttachment,
  SupportTicketLink,
  SupportTicketThread,
} from "../types";

export const TENANT = { owner_scope: "tenant", tenant_id: "ten-1", partner_id: null } as const;
export const PARTNER = { owner_scope: "partner", tenant_id: null, partner_id: "par-1" } as const;

export function ticket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  return {
    ...TENANT,
    id: "t-1",
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
    ...overrides,
  };
}

export function thread(overrides: Partial<SupportTicketThread> = {}): SupportTicketThread {
  return {
    ...TENANT,
    id: "th-1",
    ticket_id: "t-1",
    user_id: "user-agent",
    message: "We are on it",
    is_internal: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export const attachment: SupportTicketAttachment = {
  ...TENANT,
  id: "a-1",
  ticket_id: "t-1",
  thread_id: null,
  file_name: "log.txt",
  file_path: "support-tickets/ten-1/t-1/log.txt",
  file_size: 12,
  mime_type: "text/plain",
  uploaded_by: "user-customer",
  created_at: "2026-01-01T00:00:00Z",
};

export const category: SupportCategory = {
  ...TENANT,
  id: "c-1",
  name: "Billing",
  description: null,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

export const group: SupportGroup = {
  ...TENANT,
  id: "g-1",
  name: "Technical support",
  rank: 2,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
};

export function link(overrides: Partial<SupportTicketLink> = {}): SupportTicketLink {
  return {
    id: "l-1",
    kind: "escalation",
    from_ticket_id: "t-down",
    to_ticket_id: "t-1",
    provider: null,
    external_id: null,
    state: "active",
    shared: {},
    resolution: null,
    created_by: "user-agent",
    created_at: "2026-01-01T00:00:00Z",
    closed_at: null,
    ...overrides,
  };
}

export function fakeStore(): SupportStore {
  return {
    listTickets: vi.fn().mockResolvedValue([ticket()]),
    getTicket: vi.fn().mockResolvedValue(ticket()),
    saveTicket: vi.fn().mockImplementation(async (t: SupportTicket) => t),
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
    listGroups: vi.fn().mockResolvedValue([group]),
    saveGroup: vi.fn().mockResolvedValue(group),
    listLinks: vi.fn().mockResolvedValue([]),
    listStatusEvents: vi.fn().mockResolvedValue([]),
  };
}

export function fakeGateway(): SupportEscalationGateway {
  return {
    createUpstreamTicket: vi.fn().mockImplementation(async (input) => ({
      upstreamTicket: ticket({ ...input.draft.ticket, id: "t-up", ticket_number: "TKT-UP-1" }),
      link: link({ from_ticket_id: input.downstreamTicketId, to_ticket_id: "t-up" }),
    })),
    handBack: vi.fn().mockImplementation(async ({ updates }) =>
      updates.map((u: { downstreamTicketId: string }) =>
        ticket({ id: u.downstreamTicketId, ticket_number: `TKT-${u.downstreamTicketId}` }),
      ),
    ),
    withdraw: vi.fn().mockResolvedValue(undefined),
    merge: vi.fn().mockResolvedValue(undefined),
  };
}

export function fakeOwnerChain(parent: Awaited<ReturnType<SupportOwnerChain["parentOf"]>>): SupportOwnerChain {
  return { parentOf: vi.fn().mockResolvedValue(parent) };
}
