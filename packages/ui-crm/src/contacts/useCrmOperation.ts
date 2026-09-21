import { useCallback, useEffect, useRef, useState } from "react";
import type { CrmUiError, CrmUiResult } from "../core/result.js";

/**
 * Identity of the context an operation belongs to: a contact id, a selected-id
 * set, a capability, or an import snapshot. When it changes, every operation
 * started for the previous context is invalid — its result is dropped, its
 * error is cleared, and its retry disappears.
 */
export type OperationScope = string;

/**
 * One adapter operation plus its own retry.
 *
 * `retry` replays the exact operation that failed — same arguments, same
 * success handling — so a failed mutation can never be "retried" by reloading
 * data. `pending` doubles as the double-submit guard: `start` is a no-op while
 * an attempt is in flight, and callers disable their control with it.
 *
 * `scope` keeps that state from outliving its context: a settlement arriving
 * after a scope change or after unmount neither invokes `onSuccess` nor sets
 * state, so contact A can never mutate, render for, or navigate from B.
 */
export interface CrmOperation {
  pending: boolean;
  error: CrmUiError | null;
  start<T>(
    operation: () => Promise<CrmUiResult<T>>,
    onSuccess: (data: T) => void,
  ): Promise<boolean>;
  retry(): Promise<void>;
}

export function useCrmOperation(scope?: OperationScope): CrmOperation {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<CrmUiError | null>(null);
  const [trackedScope, setTrackedScope] = useState(scope);
  const lastAttempt = useRef<(() => Promise<void>) | null>(null);
  const inFlight = useRef(false);
  /** Bumped by every scope change and by unmount. */
  const generation = useRef(0);

  // Reset during render, not in an effect: an effect would leave a window in
  // which a stale settlement could still land on the new context.
  if (trackedScope !== scope) {
    setTrackedScope(scope);
    generation.current += 1;
    lastAttempt.current = null;
    inFlight.current = false;
    setPending(false);
    setError(null);
  }

  // After unmount nothing may be called back or set: invalidate in-flight work.
  useEffect(
    () => () => {
      generation.current += 1;
      lastAttempt.current = null;
      inFlight.current = false;
    },
    [],
  );

  const start = useCallback(
    async <T>(
      operation: () => Promise<CrmUiResult<T>>,
      onSuccess: (data: T) => void,
    ): Promise<boolean> => {
      if (inFlight.current) return false;
      const startedAt = generation.current;
      let succeeded = false;
      const attempt = async () => {
        if (generation.current !== startedAt) return;
        inFlight.current = true;
        setPending(true);
        setError(null);
        let result: CrmUiResult<T>;
        try {
          result = await operation();
        } finally {
          if (generation.current === startedAt) inFlight.current = false;
        }
        // Stale settlement: no callback, no state.
        if (generation.current !== startedAt) return;
        setPending(false);
        if (result.ok) {
          succeeded = true;
          onSuccess(result.data);
        } else {
          succeeded = false;
          setError(result.error);
        }
      };
      lastAttempt.current = attempt;
      await attempt();
      return succeeded;
    },
    [],
  );

  const retry = useCallback(async () => {
    const attempt = lastAttempt.current;
    if (!attempt || inFlight.current) return;
    await attempt();
  }, []);

  return { pending, error, start, retry };
}
