export interface CrmCapabilities {
  create: boolean;
  update: boolean;
  remove: boolean;
  import: boolean;
  bulkActions: boolean;
}

export const DENY_ALL_CRM_CAPABILITIES: CrmCapabilities = {
  create: false,
  update: false,
  remove: false,
  import: false,
  bulkActions: false,
};
