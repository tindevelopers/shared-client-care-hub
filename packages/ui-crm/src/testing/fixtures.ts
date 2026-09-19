import type { CrmCapabilities, CrmUiError, Page } from "../index";

export const crmUiErrorFixture: CrmUiError = {
  code: "fixture_error",
  message: "Fixture error",
  retryable: false,
};

export const crmCapabilitiesFixture: CrmCapabilities = {
  create: true,
  update: true,
  remove: true,
  import: true,
  bulkActions: true,
};

export function pageFixture<T>(items: T[]): Page<T> {
  return { items, total: items.length, limit: items.length, offset: 0 };
}
