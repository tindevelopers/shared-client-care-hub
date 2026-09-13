// Relative specifiers carry explicit .js extensions so the ESM build is
// Node-resolvable without a bundler.
//
// Root barrel: stores, segment materializer, errors + types only. Subscriber
// modules (suppression, crm-sync) are exposed via subpath exports, never
// here — they are server-only and must not load from a client context.
export { createContactsStore } from "./tenant-store.js";
export type { ContactsStore } from "./tenant-store.js";
export { createSystemContactsStore } from "./system-store.js";
export type { SystemContactsStore } from "./system-store.js";
export { materializeSegment } from "./campaigns/segment-materializer.js";
export type {
  MaterializedAudience,
  SegmentDefinition,
  SegmentMaterializerDeps,
} from "./campaigns/segment-materializer.js";
export {
  ContactNotFoundError,
  DuplicateEmailError,
  LifecycleStageUnsupportedError,
  TenantIdRequiredError,
} from "./errors.js";
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
