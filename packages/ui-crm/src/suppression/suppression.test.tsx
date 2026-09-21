// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CrmCapabilities, CrmUiResult } from "../index";
import {
  SuppressionScreen,
  type ContactSuppressionPage,
  type ContactSuppressionVm,
  type SuppressionAdapter,
} from "../suppression";

const capabilities: CrmCapabilities = {
  create: true,
  update: true,
  remove: true,
  import: true,
  bulkActions: true,
};

const base: ContactSuppressionVm = {
  id: "suppression-1",
  tenant_id: "tenant-1",
  contact_id: "contact-1",
  channel: "email",
  suppressed: true,
  reason: "Requested",
  source: "manual",
  metadata: {},
  updated_by: null,
  created_at: "2026-09-19",
  updated_at: "2026-09-19",
  contact: {
    id: "contact-1",
    first_name: "Ada",
    last_name: "Lovelace",
    email: "ada@example.com",
    phone: null,
    mobile: null,
    job_title: null,
    tags: [],
    sms_opt_out: false,
    email_opt_out: true,
    whatsapp_opt_out: false,
    updated_at: "2026-09-19",
    companyName: null,
  },
};

function ok<T>(data: T): CrmUiResult<T> {
  return { ok: true, data };
}

function page(): ContactSuppressionPage {
  return {
    items: [
      base,
      { ...base, id: "suppression-2", channel: "sms", source: "import" },
      { ...base, id: "suppression-3", channel: "whatsapp", source: "api" },
    ],
    total: 3,
    limit: 20,
    offset: 0,
  };
}

function adapter(overrides: Partial<SuppressionAdapter> = {}): SuppressionAdapter {
  return {
    listSuppressions: vi.fn(async () => ok(page())),
    setSuppression: vi.fn(async () => ok(undefined)),
    bulkSetSuppression: vi.fn(async (input) => ok({ updated: input.contactIds.length })),
    ...overrides,
  };
}

describe("SuppressionScreen", () => {
  it("shows all channels, reasons, and sources and performs a single update", async () => {
    const source = adapter();
    const user = userEvent.setup();
    render(<SuppressionScreen adapter={source} capabilities={capabilities} />);
    await screen.findByRole("cell", { name: "email" });
    expect(screen.getByRole("cell", { name: "sms" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "whatsapp" })).toBeInTheDocument();
    expect(screen.getAllByDisplayValue("Requested")).toHaveLength(3);
    expect(screen.getByDisplayValue("import")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Allow email" }));
    await waitFor(() =>
      expect(source.setSuppression).toHaveBeenCalledWith(
        expect.objectContaining({
          contact_id: "contact-1",
          channel: "email",
          suppressed: false,
          reason: "Requested",
          source: "manual",
        }),
      ),
    );
  });

  it("bulk updates the exact selection and leaves an empty selection inert", async () => {
    const source = adapter();
    const user = userEvent.setup();
    render(<SuppressionScreen adapter={source} capabilities={capabilities} />);
    await screen.findByRole("cell", { name: "email" });
    expect(screen.getByRole("button", { name: "Set selected suppression" })).toBeDisabled();
    expect(source.bulkSetSuppression).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("checkbox", { name: "Select Ada Lovelace email" }),
    );
    await user.selectOptions(screen.getByLabelText("Bulk channel"), "whatsapp");
    await user.type(screen.getByLabelText("Bulk reason"), "Policy");
    await user.click(screen.getByRole("button", { name: "Set selected suppression" }));
    await waitFor(() =>
      expect(source.bulkSetSuppression).toHaveBeenCalledWith({
        contactIds: ["contact-1"],
        channel: "whatsapp",
        suppressed: true,
        reason: "Policy",
        source: "manual",
        metadata: {},
      }),
    );
  });

  it("converts rejected promises to a safe message", async () => {
    render(
      <SuppressionScreen
        adapter={adapter({ listSuppressions: vi.fn(async () => Promise.reject(new Error("secret"))) })}
        capabilities={capabilities}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The operation failed unexpectedly.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("secret");
  });

  it("retries the same failed bulk mutation", async () => {
    const bulkSetSuppression = vi
      .fn<Parameters<SuppressionAdapter["bulkSetSuppression"]>, ReturnType<SuppressionAdapter["bulkSetSuppression"]>>()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "temporary", message: "Try again", retryable: true },
      })
      .mockResolvedValue(ok({ updated: 1 }));
    const source = adapter({ bulkSetSuppression });
    const user = userEvent.setup();
    render(<SuppressionScreen adapter={source} capabilities={capabilities} />);
    await screen.findByRole("cell", { name: "email" });
    await user.click(screen.getByRole("checkbox", { name: "Select Ada Lovelace email" }));
    await user.click(screen.getByRole("button", { name: "Set selected suppression" }));
    await user.click(await screen.findByRole("button", { name: "Retry setting selected suppression" }));
    await waitFor(() => expect(bulkSetSuppression).toHaveBeenCalledTimes(2));
    expect(bulkSetSuppression.mock.calls[1][0]).toEqual(bulkSetSuppression.mock.calls[0][0]);
  });
});
