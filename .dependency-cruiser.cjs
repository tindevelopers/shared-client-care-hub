// Scaffold placeholder: keeps `pnpm test` (depcruise leg) green while the hub
// has zero packages. The hub-guardrails step replaces this with the full
// mandated rule set: the domain-contacts <-> domain-campaigns (R5) pair,
// the vendor-SDK deny-list (R1), the packages-never-import-apps rule, and the
// packages/domain-* ban on @tindevelopers/core-kernel/database/admin-client.
module.exports = {
  forbidden: [],
};
