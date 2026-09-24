/**
 * Phase 0 boundary enforcement for the shell-base-crm hub.
 *
 * Encodes the invariants from konnect-caas-base
 * docs/superpowers/specs/2026-09-12-src-core-promotion-design.md ("Layering"):
 *   R1 — no vendor SDK in a domain package (use an adapter-kit port)
 *   R5 — a domain never imports another domain (use core-kernel/events or
 *        injected callbacks)
 * plus enforcement input #2: service-role access is injection-only in this
 * hub, so domain packages never import core-kernel's admin-client module.
 *
 * schema-* packages are not domains (schema-crm is leaf typing), so the R5
 * pair and the vendor deny-list apply to packages/domain-* only.
 *
 * Every rule below is proven to fire by tests/boundary/rules-fire.test.ts.
 * A rule that cannot fail is not enforcement. tests/boundary/domain-set.test.ts
 * binds the domain enumeration here to the real packages/domain-* set.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-domain-to-domain",
      comment:
        "R5 — domain-contacts must not import domain-campaigns. " +
        "Cross-domain communication goes through core-kernel/events or " +
        "injected callbacks (e.g. the audience resolver). Matches the " +
        "resolved workspace path and the bare specifier (an undeclared " +
        "cross-domain import stays unresolved as '@tindevelopers/…').",
      severity: "error",
      from: { path: "^packages/domain-contacts/" },
      to: { path: "^(@tindevelopers/domain-campaigns|packages/domain-campaigns/)" },
    },
    {
      name: "no-domain-to-domain-reverse",
      comment: "R5 — the reverse direction of no-domain-to-domain.",
      severity: "error",
      from: { path: "^packages/domain-campaigns/" },
      to: { path: "^(@tindevelopers/domain-contacts|packages/domain-contacts/)" },
    },
    {
      name: "no-domain-support-to-contacts",
      comment:
        "R5 — domain-support must not import domain-contacts. Cross-domain " +
        "communication goes through core-kernel/events or injected callbacks.",
      severity: "error",
      from: { path: "^packages/domain-support/" },
      to: { path: "^(@tindevelopers/domain-contacts|packages/domain-contacts/)" },
    },
    {
      name: "no-domain-support-to-contacts-reverse",
      comment: "R5 — the reverse direction of no-domain-support-to-contacts.",
      severity: "error",
      from: { path: "^packages/domain-contacts/" },
      to: { path: "^(@tindevelopers/domain-support|packages/domain-support/)" },
    },
    {
      name: "no-domain-support-to-campaigns",
      comment:
        "R5 — domain-support must not import domain-campaigns. Cross-domain " +
        "communication goes through core-kernel/events or injected callbacks.",
      severity: "error",
      from: { path: "^packages/domain-support/" },
      to: { path: "^(@tindevelopers/domain-campaigns|packages/domain-campaigns/)" },
    },
    {
      name: "no-domain-support-to-campaigns-reverse",
      comment: "R5 — the reverse direction of no-domain-support-to-campaigns.",
      severity: "error",
      from: { path: "^packages/domain-campaigns/" },
      to: { path: "^(@tindevelopers/domain-support|packages/domain-support/)" },
    },
    {
      name: "no-vendor-in-domain",
      comment:
        "R1 — a domain package imports a port from adapter-kit, never a vendor SDK. " +
        "Matches the bare specifier (how dependency-cruiser records an import it " +
        "cannot resolve — the fixture's `stripe` is not in any package.json here) " +
        "and resolved node_modules paths including the pnpm store layout " +
        "(.pnpm/<pkg>@<ver>/node_modules/<pkg> still contains node_modules/<pkg>).",
      severity: "error",
      from: { path: "^packages/domain-" },
      to: {
        path:
          "^(@shopify/|@hubspot/|stripe($|/)|telnyx($|/)|axios($|/)|node-fetch($|/))" +
          "|node_modules/(@shopify/|@hubspot/|stripe/|telnyx/|axios/|node-fetch/)",
      },
    },
    {
      name: "no-apps-import",
      comment:
        "Packages never import apps. No apps/ path and no Next.js '@/' alias.",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^(apps/|@/)" },
    },
    {
      name: "no-ui-crm-host-runtime-imports",
      comment:
        "ui-crm is host-agnostic presentation code and must not import app paths, " +
        "Next.js, server-only modules, or vendor runtimes.",
      severity: "error",
      from: { path: "^packages/ui-crm/" },
      to: {
        path:
          "^(apps/|@/|next($|/)|@supabase/|server-only($|/)|@unkey/|telnyx($|/)|brevo($|/)|resend($|/))" +
          "|node_modules/(next/|@supabase/|server-only/|@unkey/|telnyx/|brevo/|resend/)",
      },
    },
    {
      name: "no-domain-import-ui-crm",
      comment:
        "Domain packages may not depend on presentation code from ui-crm.",
      severity: "error",
      from: { path: "^packages/domain-" },
      to: { path: "^(@tindevelopers/ui-crm($|/)|packages/ui-crm/)" },
    },
    {
      name: "domains-never-import-admin-client",
      comment:
        "Enforcement input #2 — the service role is injection-only in this hub: " +
        "a domain package receives a SupabaseClient through its public API and " +
        "never constructs or imports core-kernel's admin client. Matches the " +
        "bare specifier (unresolved while core-kernel is undeclared here) and " +
        "resolved node_modules paths — both the specifier-shaped path and the " +
        "dist/ file that core-kernel's exports map resolves " +
        "'./database/admin-client' to (pnpm store paths still contain " +
        "node_modules/@tindevelopers/core-kernel/).",
      severity: "error",
      from: { path: "^packages/domain-" },
      to: {
        path:
          "^@tindevelopers/core-kernel/database/admin-client" +
          "|node_modules/@tindevelopers/core-kernel/database/admin-client" +
          "|node_modules/@tindevelopers/core-kernel/dist/database/admin-client",
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
    // `exclude` removes modules from the graph BEFORE rule evaluation —
    // unlike doNotFollow above, which only stops recursion and leaves the
    // edge in place as a graph leaf for rule matching. Listing node_modules
    // here would strip every resolved dependency edge and silently defeat
    // the node_modules-path matchers of no-vendor-in-domain and
    // domains-never-import-admin-client (proven by the resolved-path cases
    // in tests/boundary/rules-fire.test.ts). Only package build output is
    // excluded, anchored to packages/*/dist so nothing under a real
    // node_modules path (e.g. core-kernel's dist/) can ever match it.
    exclude: { path: ["^packages/[^/]+/dist/"] },
  },
};
