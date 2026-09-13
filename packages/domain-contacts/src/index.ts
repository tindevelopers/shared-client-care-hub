// Relative specifiers carry explicit .js extensions so the ESM build is
// Node-resolvable without a bundler.
//
// Root barrel: store + errors + types only. Subscriber modules
// (suppression, crm-sync) will be exposed via subpath exports, never here.
export { createContactsStore } from "./tenant-store.js";
export type { ContactsStore } from "./tenant-store.js";
export { ContactNotFoundError, DuplicateEmailError } from "./errors.js";
export type {
  ContactCompany,
  ContactDialTarget,
  ContactWithCompany,
  ServiceRoleContactColumn,
  TenantContactInsert,
  TenantContactUpdate,
} from "./types.js";
