import { useCallback, useRef, useState } from "react";
import type { CrmUiError, CrmUiResult } from "../core/result.js";

/**
 * One adapter operation plus its own retry.
 *
 * `retry` replays the exact operation that failed — same arguments, same
 * success handling — so a failed mutation can never be "retried" by reloading
 * data. `pending` doubles as the double-submit guard: `start` is a no-op while
 * an attempt is in flight, and callers disable their control with it.
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

export function useCrmOperation(): CrmOperation {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<CrmUiError | null>(null);
  const lastAttempt = useRef<(() => Promise<void>) | null>(null);
  const inFlight = useRef(false);

  const start = useCallback(
    async <T>(
      operation: () => Promise<CrmUiResult<T>>,
      onSuccess: (data: T) => void,
    ): Promise<boolean> => {
      if (inFlight.current) return false;
      let succeeded = false;
      const attempt = async () => {
        inFlight.current = true;
        setPending(true);
        setError(null);
        try {
          const result = await operation();
          if (result.ok) {
            succeeded = true;
            onSuccess(result.data);
          } else {
            succeeded = false;
            setError(result.error);
          }
        } finally {
          inFlight.current = false;
          setPending(false);
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
