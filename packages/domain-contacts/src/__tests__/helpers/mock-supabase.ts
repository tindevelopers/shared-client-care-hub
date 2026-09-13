import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Minimal Supabase client mock for payload-parity tests.
 *
 * Records every query-builder call (`from`, `insert`, `update`, `delete`,
 * `upsert`, `select`, `eq`, `in`, `or`, `order`, `limit`, `range`, `not`,
 * `contains`, `single`, `maybeSingle`) in order, so tests can assert the
 * EXACT query shape the store produces against the cataloged writer payloads
 * (W1–W11, W17, W18).
 *
 * Terminal results: pass a single object for a sticky result, or an array for
 * a one-shot queue (each `await`/`single()`/`maybeSingle()` consumes the next
 * entry; the array's last entry does not stick — supply a final entry to cover
 * remaining calls).
 */
export interface RecordedCall {
  op: string;
  args: unknown[];
}

export interface MockResult {
  data?: unknown;
  error?: unknown;
  count?: number | null;
}

interface Resolved {
  data: unknown;
  error: unknown;
  count: number | null;
}

const CHAIN_OPS = [
  "insert",
  "update",
  "delete",
  "upsert",
  "select",
  "eq",
  "in",
  "or",
  "order",
  "limit",
  "range",
  "not",
  "contains",
] as const;

export function createMockSupabase(results: MockResult | MockResult[] = {}) {
  const queue: MockResult[] = Array.isArray(results) ? [...results] : [];
  const tail: MockResult = Array.isArray(results)
    ? {}
    : results;
  const calls: RecordedCall[] = [];

  const next = (): Resolved => {
    const r = queue.length > 0 ? (queue.shift() as MockResult) : tail;
    return {
      data: r.data ?? null,
      error: r.error ?? null,
      count: r.count ?? null,
    };
  };

  // A PostgREST builder is a Promise itself (awaitable without .single()).
  const makeBuilder = (): Record<string, unknown> => {
    const builder: Record<string, unknown> = {};
    for (const op of CHAIN_OPS) {
      builder[op] = (...args: unknown[]) => {
        calls.push({ op, args });
        return builder;
      };
    }
    builder.single = async () => {
      calls.push({ op: "single", args: [] });
      return next();
    };
    builder.maybeSingle = async () => {
      calls.push({ op: "maybeSingle", args: [] });
      return next();
    };
    builder.then = (
      onFulfilled?: (v: Resolved) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve(next()).then(onFulfilled, onRejected);
    return builder;
  };

  const builder = makeBuilder();
  const client = {
    from: (table: string) => {
      calls.push({ op: "from", args: [table] });
      return builder;
    },
  };

  return {
    client: client as unknown as SupabaseClient,
    calls,
  };
}
