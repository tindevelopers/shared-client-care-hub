/**
 * Support graduation tests (Pass C — Task C5).
 *
 * The thin layer is always the system of record: the first-party ticket is
 * written BEFORE any specialist is contacted, a specialist outage never
 * blocks the tenant, and disabling the binding leaves a fully working
 * thin layer (R2 + R3). External references resolve generically through
 * the bound provider's canonical name — no provider-specific branches.
 */
import { describe, expect, it, vi } from 'vitest'
import { createTicketGraduated, addThreadGraduated, toCanonicalTicket, type SupportGraduationDeps } from '../graduation'

function fakeDb() {
  return {
    insertTicket: vi.fn().mockImplementation(async (input: Record<string, unknown>) => ({
      id: 'ticket-1',
      ticket_number: 'TKT-1',
      ...input,
      status: input.status ?? 'open',
    })),
    mergeExternalRefs: vi.fn(),
    setSyncState: vi.fn(),
    deadLetter: vi.fn(),
    insertThread: vi.fn(),
    getTicketById: vi.fn().mockResolvedValue(null),
  }
}

function input() {
  return {
    subject: 'Login broken',
    description: 'User cannot sign in',
    priority: 'high',
    category_id: null,
    created_by: '00000000-0000-0000-0000-000000000001',
    status: 'open',
  } as never
}

/** A resolved specialist: canonical provider name + the port instance. */
function bound(name: string, port: unknown) {
  return { name, port }
}

function deps(provider: unknown, db = fakeDb()): SupportGraduationDeps {
  return {
    resolveProvider: vi.fn().mockResolvedValue(provider),
    store: db as never,
  }
}

describe('createTicketGraduated', () => {
  it('writes first-party only when no provider is bound', async () => {
    const d = deps(null)
    const t = await createTicketGraduated(d, input(), 'ten1')

    expect(d.store.insertTicket).toHaveBeenCalledOnce()
    expect(t.syncState.status).toBe('clean')
    expect(t.externalRefs).toEqual({})
    expect(d.store.setSyncState).not.toHaveBeenCalled()
  })

  it('pushes to the specialist and records the external ref', async () => {
    const port = {
      capabilities: () => ({ features: ['sla'] }),
      create: vi.fn().mockResolvedValue({
        externalRefs: { freshdesk: { id: '42' } },
        syncState: { status: 'clean' },
      }),
    }
    const d = deps(bound('freshdesk', port))
    const t = await createTicketGraduated(d, input(), 'ten1')

    expect(port.create).toHaveBeenCalledOnce()
    expect(t.externalRefs.freshdesk?.id).toBe('42')
    expect(d.store.mergeExternalRefs).toHaveBeenCalledWith('ten1', 'ticket-1', { freshdesk: { id: '42' } })
    expect(t.syncState.status).toBe('clean')
  })

  it('keeps the first-party ticket when the specialist push fails', async () => {
    const port = {
      capabilities: () => ({ features: [] }),
      create: vi.fn().mockRejectedValue(new Error('desk down')),
    }
    const d = deps(bound('freshdesk', port))
    const t = await createTicketGraduated(d, input(), 'ten1')

    expect(t.id).toBeTruthy()
    expect(t.syncState.status).toBe('error')
    expect(d.store.deadLetter).toHaveBeenCalledOnce()
    expect(d.store.setSyncState).toHaveBeenCalledWith('ten1', 'ticket-1', expect.objectContaining({ status: 'error' }))
  })
})

describe('addThreadGraduated', () => {
  it('writes the thread first-party always, pushes to the specialist when bound', async () => {
    const port = {
      capabilities: () => ({ features: ['threads'] }),
      addThread: vi.fn().mockResolvedValue(undefined),
    }
    const d = deps(bound('freshdesk', port))
    d.store.getTicketById = vi.fn().mockResolvedValue({
      id: 'ticket-1',
      tenant_id: 'ten1',
      status: 'in_progress',
      external_refs: { freshdesk: { id: '42' } },
    })

    await addThreadGraduated(d, 'ten1', 'ticket-1', { message: 'reply', authorEmail: 'agent@x.com', userId: 'u1' })
    expect(d.store.insertThread).toHaveBeenCalledOnce()
    expect(port.addThread).toHaveBeenCalledWith('42', 'reply', 'agent@x.com')
  })

  it('resolves the external ref generically for any bound provider name', async () => {
    const port = {
      capabilities: () => ({ features: ['threads'] }),
      addThread: vi.fn().mockResolvedValue(undefined),
    }
    const d = deps(bound('chatwoot', port))
    d.store.getTicketById = vi.fn().mockResolvedValue({
      id: 'ticket-1',
      tenant_id: 'ten1',
      status: 'open',
      external_refs: { chatwoot: { id: 'cw-99' } },
    })

    await addThreadGraduated(d, 'ten1', 'ticket-1', { message: 'reply', authorEmail: 'a@x.com', userId: 'u1' })
    expect(port.addThread).toHaveBeenCalledWith('cw-99', 'reply', 'a@x.com')
  })

  it('skips the specialist when the bound provider has no external ref on the ticket', async () => {
    const port = {
      capabilities: () => ({ features: ['threads'] }),
      addThread: vi.fn(),
    }
    const d = deps(bound('chatwoot', port))
    d.store.getTicketById = vi.fn().mockResolvedValue({
      id: 'ticket-1',
      tenant_id: 'ten1',
      status: 'open',
      external_refs: { freshdesk: { id: '42' } },
    })

    await addThreadGraduated(d, 'ten1', 'ticket-1', { message: 'reply', authorEmail: 'a@x.com', userId: 'u1' })
    expect(port.addThread).not.toHaveBeenCalled()
    expect(d.store.insertThread).toHaveBeenCalledOnce()
  })

  it('never throws when the specialist thread push fails', async () => {
    const port = {
      capabilities: () => ({ features: ['threads'] }),
      addThread: vi.fn().mockRejectedValue(new Error('gone')),
    }
    const d = deps(bound('freshdesk', port))
    d.store.getTicketById = vi.fn().mockResolvedValue({
      id: 'ticket-1', tenant_id: 'ten1', status: 'open',
      external_refs: { freshdesk: { id: '42' } },
    })

    await expect(
      addThreadGraduated(d, 'ten1', 'ticket-1', { message: 'reply', authorEmail: 'a@x.com', userId: 'u1' }),
    ).resolves.toBeUndefined()
    expect(d.store.deadLetter).toHaveBeenCalledOnce()
  })

  it('skips the specialist when the ticket has no external ref yet', async () => {
    const port = {
      capabilities: () => ({ features: ['threads'] }),
      addThread: vi.fn(),
    }
    const d = deps(bound('freshdesk', port))
    d.store.getTicketById = vi.fn().mockResolvedValue({
      id: 'ticket-1', tenant_id: 'ten1', status: 'open', external_refs: {},
    })

    await addThreadGraduated(d, 'ten1', 'ticket-1', { message: 'reply', authorEmail: 'a@x.com', userId: 'u1' })
    expect(port.addThread).not.toHaveBeenCalled()
    expect(d.store.insertThread).toHaveBeenCalledOnce()
  })
})

describe('vocabulary mapping (first-party ↔ canonical)', () => {
  it('maps first-party in_progress onto the canonical in_progress status', () => {
    const c = toCanonicalTicket({
      id: 't', tenant_id: 'ten1', subject: 's', description: 'b',
      status: 'in_progress', priority: 'high',
      requester_email: 'a@b.c', created_at: '2026-01-01T00:00:00Z',
    } as never)
    expect(c.status).toBe('in_progress')
    expect(c.priority).toBe('high')
  })

  it('maps first-party medium priority onto the canonical medium priority', () => {
    const c = toCanonicalTicket({
      id: 't', tenant_id: 'ten1', subject: 's', description: 'b',
      status: 'open', priority: 'medium',
      requester_email: 'a@b.c', created_at: '2026-01-01T00:00:00Z',
    } as never)
    expect(c.status).toBe('open')
    expect(c.priority).toBe('medium')
  })

  it('falls back to open/medium for unknown first-party vocabulary', () => {
    const c = toCanonicalTicket({
      id: 't', tenant_id: 'ten1', subject: 's', description: 'b',
      status: 'weird', priority: 'weird',
      requester_email: 'a@b.c', created_at: '2026-01-01T00:00:00Z',
    } as never)
    expect(c.status).toBe('open')
    expect(c.priority).toBe('medium')
  })
})
