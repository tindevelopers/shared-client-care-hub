import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Minimal Supabase client mock for the support stores' payload-parity tests.
 * Mirrors domain-contacts' `src/__tests__/helpers/mock-supabase.ts` (query
 * builder call recording, sticky vs. one-shot queued results) and adds a
 * `storage` stub for the attachment store's bucket calls.
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
  const tail: MockResult = Array.isArray(results) ? {} : results;
  const calls: RecordedCall[] = [];

  const next = (): Resolved => {
    const r = queue.length > 0 ? (queue.shift() as MockResult) : tail;
    return { data: r.data ?? null, error: r.error ?? null, count: r.count ?? null };
  };

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
    storage: {
      from: (bucket: string) => {
        calls.push({ op: "storage.from", args: [bucket] });
        return {
          remove: async (paths: string[]) => {
            calls.push({ op: "storage.remove", args: [bucket, paths] });
            return next();
          },
          createSignedUrl: async (path: string, expiresIn: number) => {
            calls.push({ op: "storage.createSignedUrl", args: [bucket, path, expiresIn] });
            return next();
          },
        };
      },
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}
