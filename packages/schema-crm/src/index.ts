// Relative specifiers carry explicit .js extensions so the ESM build is
// Node-resolvable without a bundler.
export * from "./contacts.js";
export * from "./contact-groups.js";
export * from "./suppressions.js";
export * from "./campaigns.js";
export * from "./sync.js";
export {
  CRM_TABLE_NAMES,
  crmManifest,
  tables as crmTables,
  type CrmSchemaManifest,
  type CrmTableInfo,
  type CrmTableName,
} from "./manifest.js";
