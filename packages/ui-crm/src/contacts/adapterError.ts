import type { CrmUiError, CrmUiResult } from "../core/result.js";

/**
 * Adapters must return results, not throw. A throw or rejection is reported as
 * this stable non-retryable error so no screen is left perma-pending and no
 * rejection goes unhandled.
 */
export const ADAPTER_THROWN: CrmUiError = {
  code: "adapter_error",
  message: "The operation failed unexpectedly.",
  retryable: false,
};

/** Runs an adapter call, converting a throw/rejection into a result. */
export async function safeAdapterCall<T>(
  call: () => Promise<CrmUiResult<T>>,
): Promise<CrmUiResult<T>> {
  try {
    return await call();
  } catch {
    return { ok: false, error: ADAPTER_THROWN };
  }
}
