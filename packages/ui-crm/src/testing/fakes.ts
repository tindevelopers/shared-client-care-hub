import type { CrmUiResult } from "../index";

export interface FakeCrmAdapter<TArgs extends unknown[], TResult> {
  calls: TArgs[];
  invoke(...args: TArgs): Promise<CrmUiResult<TResult>>;
}

export function createFakeCrmAdapter<TArgs extends unknown[], TResult>(
  result: CrmUiResult<TResult>,
): FakeCrmAdapter<TArgs, TResult> {
  const calls: TArgs[] = [];
  return {
    calls,
    async invoke(...args: TArgs) {
      calls.push(args);
      return result;
    },
  };
}
