import type { CrmUiError } from "../core/result.js";

export interface ErrorNoticeProps {
  error: CrmUiError;
  /** Operation-specific retry label, e.g. "Retry saving note". */
  retryLabel?: string;
  onRetry?(): void;
}

/**
 * Adapter results are the only error source. Retry is offered only when the
 * adapter marked the failure retryable, and it always replays the operation
 * that failed rather than reloading the screen.
 */
export function ErrorNotice({ error, retryLabel, onRetry }: ErrorNoticeProps) {
  const canRetry = error.retryable && Boolean(retryLabel) && Boolean(onRetry);
  return (
    <div role="alert">
      <p>{error.message}</p>
      {canRetry && (
        <button type="button" onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}
