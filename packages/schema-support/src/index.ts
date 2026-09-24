// Relative specifiers carry explicit .js extensions so the ESM build is
// Node-resolvable without a bundler.
export * from "./categories.js";
export * from "./tickets.js";
export * from "./threads.js";
export * from "./attachments.js";
export * from "./history.js";
export {
  SUPPORT_TABLE_NAMES,
  supportManifest,
  tables as supportTables,
  type SupportSchemaManifest,
  type SupportTableInfo,
  type SupportTableName,
} from "./manifest.js";
