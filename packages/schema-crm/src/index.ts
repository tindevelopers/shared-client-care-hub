// Relative specifiers carry explicit .js extensions so the ESM build is
// Node-resolvable without a bundler.
export * from "./contacts.js";
export * from "./contact-groups.js";
export * from "./suppressions.js";
export * from "./campaigns.js";
export * from "./sync.js";
export * from "./companies.js";
export * from "./deals.js";
export * from "./tasks.js";
export * from "./notes.js";
export * from "./activities.js";
export {
  CRM_TABLE_NAMES,
  crmManifest,
  tables as crmTables,
  type CrmSchemaManifest,
  type CrmTableInfo,
  type CrmTableName,
} from "./manifest.js";
