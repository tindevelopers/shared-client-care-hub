export interface CrmUiError {
  code: string;
  message: string;
  retryable: boolean;
}

export type CrmUiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: CrmUiError };

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
