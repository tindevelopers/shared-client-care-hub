// Relative specifiers carry explicit .js extensions so the ESM build is
// Node-resolvable without a bundler.
//
// Root barrel: stores + errors + types only. Subscriber modules
// (suppression, crm-sync) will be exposed via subpath exports, never here.
export { createContactsStore } from "./tenant-store.js";
export type { ContactsStore } from "./tenant-store.js";
export { createSystemContactsStore } from "./system-store.js";
export type { SystemContactsStore } from "./system-store.js";
export { ContactNotFoundError, DuplicateEmailError, TenantIdRequiredError } from "./errors.js";
export type {
  BrevoSyncMetadata,
  ContactCompany,
  ContactDialTarget,
  ContactProjection,
  ContactUnsubscribedEmit,
  ContactWithCompany,
  ProjectionAction,
  ServiceRoleContactColumn,
  SuppressionKind,
  TenantContactInsert,
  TenantContactUpdate,
} from "./types.js";
