import type { CrmCapabilities } from "../core/capabilities.js";
import type { CrmUiResult } from "../core/result.js";
import type {
  BulkSetSuppressionInput,
  ContactSuppressionPage,
  SetSuppressionInput,
  SuppressionQuery,
} from "./types.js";

export interface SuppressionAdapter {
  listSuppressions(query?: SuppressionQuery): Promise<CrmUiResult<ContactSuppressionPage>>;
  setSuppression(input: SetSuppressionInput): Promise<CrmUiResult<void>>;
  bulkSetSuppression(
    input: BulkSetSuppressionInput,
  ): Promise<CrmUiResult<{ updated: number }>>;
}

export interface SuppressionScreenProps {
  adapter: SuppressionAdapter;
  capabilities: CrmCapabilities;
  className?: string;
}
