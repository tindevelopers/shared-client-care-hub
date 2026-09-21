// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
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

function failure<T = never>(message = "Try again"): CrmUiResult<T> {
  return { ok: false, error: { code: "temporary", message, retryable: true } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function page(total = 3): ContactSuppressionPage {
  return {
    items: [
      base,
      { ...base, id: "suppression-2", channel: "sms", source: "import" },
      { ...base, id: "suppression-3", channel: "whatsapp", source: "api" },
    ],
    total,
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

  it("binds bulk selection to one exact channel", async () => {
    const source = adapter();
    const user = userEvent.setup();
    render(<SuppressionScreen adapter={source} capabilities={capabilities} />);
    await screen.findByRole("cell", { name: "email" });
    expect(screen.getByRole("button", { name: "Set selected suppression" })).toBeDisabled();
    expect(source.bulkSetSuppression).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("checkbox", { name: "Select Ada Lovelace email" }),
    );
    expect(screen.getByLabelText("Bulk channel")).toHaveValue("email");
    expect(screen.getByRole("checkbox", { name: "Select Ada Lovelace email" })).toBeChecked();

    await user.click(screen.getByRole("checkbox", { name: "Select Ada Lovelace sms" }));
    expect(screen.getByLabelText("Bulk channel")).toHaveValue("sms");
    expect(screen.getByRole("checkbox", { name: "Select Ada Lovelace email" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Ada Lovelace sms" })).toBeChecked();

    await user.selectOptions(screen.getByLabelText("Bulk channel"), "whatsapp");
    expect(screen.getByRole("checkbox", { name: "Select Ada Lovelace sms" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Set selected suppression" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Select Ada Lovelace whatsapp" }));
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

  it("filters and pages with the exact query", async () => {
    const listSuppressions = vi.fn(async () => ok(page(45)));
    const user = userEvent.setup();
    render(
      <SuppressionScreen
        adapter={adapter({ listSuppressions })}
        capabilities={capabilities}
      />,
    );
    await screen.findByRole("cell", { name: "email" });
    await user.selectOptions(screen.getByLabelText("Channel"), "sms");
    await user.selectOptions(screen.getByLabelText("State"), "false");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(listSuppressions).toHaveBeenLastCalledWith({
        channel: "sms",
        suppressed: false,
        limit: 20,
        offset: 20,
      }),
    );
  });

  it("retries an exact single mutation and retires retry after payload edits", async () => {
    const setSuppression = vi
      .fn<Parameters<SuppressionAdapter["setSuppression"]>, ReturnType<SuppressionAdapter["setSuppression"]>>()
      .mockResolvedValueOnce(failure<void>())
      .mockResolvedValue(ok(undefined));
    const source = adapter({ setSuppression });
    const user = userEvent.setup();
    render(<SuppressionScreen adapter={source} capabilities={capabilities} />);
    await screen.findByRole("cell", { name: "email" });
    await user.click(screen.getByRole("button", { name: "Allow email" }));
    const retry = await screen.findByRole("button", {
      name: "Retry setting email suppression",
    });
    await user.click(retry);
    await waitFor(() => expect(setSuppression).toHaveBeenCalledTimes(2));
    expect(setSuppression.mock.calls[1][0]).toEqual(setSuppression.mock.calls[0][0]);

    setSuppression.mockResolvedValue(failure<void>());
    await user.click(screen.getByRole("button", { name: "Allow email" }));
    expect(
      await screen.findByRole("button", { name: "Retry setting email suppression" }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Reason for Ada Lovelace email"), " changed");
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Retry setting email suppression" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("reconciles refreshed reason, source, state, and metadata", async () => {
    const refreshed: ContactSuppressionVm = {
      ...base,
      suppressed: false,
      reason: "Fresh reason",
      source: "sync",
      metadata: { revision: 2 },
      updated_at: "2026-09-20",
    };
    const listSuppressions = vi
      .fn<Parameters<SuppressionAdapter["listSuppressions"]>, ReturnType<SuppressionAdapter["listSuppressions"]>>()
      .mockResolvedValueOnce(ok(page()))
      .mockResolvedValue(
        ok({ items: [refreshed], total: 1, limit: 20, offset: 0 }),
      );
    const setSuppression = vi.fn(async () => ok(undefined));
    const source = adapter({ listSuppressions, setSuppression });
    const user = userEvent.setup();
    render(<SuppressionScreen adapter={source} capabilities={capabilities} />);
    await screen.findByRole("cell", { name: "email" });
    await user.clear(screen.getByLabelText("Reason for Ada Lovelace email"));
    await user.type(screen.getByLabelText("Reason for Ada Lovelace email"), "Stale draft");
    await user.click(screen.getByRole("button", { name: "Allow email" }));

    expect(await screen.findByDisplayValue("Fresh reason")).toBeInTheDocument();
    expect(screen.getByDisplayValue("sync")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suppress email" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Suppress email" }));
    await waitFor(() => expect(setSuppression).toHaveBeenCalledTimes(2));
    expect(setSuppression).toHaveBeenLastCalledWith({
      contact_id: "contact-1",
      channel: "email",
      suppressed: true,
      reason: "Fresh reason",
      source: "sync",
      metadata: { revision: 2 },
    });
  });

  it("retires single and bulk retries when update capability is revoked", async () => {
    const source = adapter({
      setSuppression: vi.fn(async () => failure<void>()),
      bulkSetSuppression: vi.fn(async () => failure<{ updated: number }>()),
    });
    const user = userEvent.setup();
    const view = render(<SuppressionScreen adapter={source} capabilities={capabilities} />);
    await screen.findByRole("cell", { name: "email" });
    await user.click(screen.getByRole("button", { name: "Allow email" }));
    await screen.findByRole("button", { name: "Retry setting email suppression" });
    await user.click(screen.getByRole("checkbox", { name: "Select Ada Lovelace email" }));
    await user.click(screen.getByRole("button", { name: "Set selected suppression" }));
    await screen.findByRole("button", { name: "Retry setting selected suppression" });

    view.rerender(
      <SuppressionScreen
        adapter={source}
        capabilities={{ ...capabilities, update: false }}
      />,
    );
    expect(screen.queryByRole("button", { name: /Retry setting/ })).not.toBeInTheDocument();
    view.rerender(<SuppressionScreen adapter={source} capabilities={capabilities} />);
    expect(screen.queryByRole("button", { name: /Retry setting/ })).not.toBeInTheDocument();
  });

  it("locks single-row payload controls while the write is pending", async () => {
    const result = deferred<CrmUiResult<void>>();
    const setSuppression = vi
      .fn<Parameters<SuppressionAdapter["setSuppression"]>, ReturnType<SuppressionAdapter["setSuppression"]>>()
      .mockReturnValue(result.promise);
    const user = userEvent.setup();
    render(
      <SuppressionScreen
        adapter={adapter({ setSuppression })}
        capabilities={capabilities}
      />,
    );
    await screen.findByRole("cell", { name: "email" });
    const reason = screen.getByLabelText("Reason for Ada Lovelace email");
    const source = screen.getByLabelText("Source for Ada Lovelace email");
    const action = screen.getByRole("button", { name: "Allow email" });
    await user.click(action);
    expect(reason).toBeDisabled();
    expect(source).toBeDisabled();
    expect(action).toBeDisabled();
    await user.type(reason, " changed");
    await user.click(action);
    expect(setSuppression).toHaveBeenCalledTimes(1);

    await act(async () => result.resolve(failure<void>()));
    expect(
      await screen.findByRole("button", { name: "Retry setting email suppression" }),
    ).toBeInTheDocument();
    expect(reason).toBeEnabled();
    expect(source).toBeEnabled();
    expect(action).toBeEnabled();
  });

  it("locks bulk payload, selection, and query controls while the write is pending", async () => {
    const result = deferred<CrmUiResult<{ updated: number }>>();
    const bulkSetSuppression = vi
      .fn<Parameters<SuppressionAdapter["bulkSetSuppression"]>, ReturnType<SuppressionAdapter["bulkSetSuppression"]>>()
      .mockReturnValue(result.promise);
    const user = userEvent.setup();
    render(
      <SuppressionScreen
        adapter={adapter({ bulkSetSuppression })}
        capabilities={capabilities}
      />,
    );
    await screen.findByRole("cell", { name: "email" });
    const selection = screen.getByRole("checkbox", { name: "Select Ada Lovelace email" });
    await user.click(selection);
    await user.click(screen.getByRole("button", { name: "Set selected suppression" }));

    expect(selection).toBeDisabled();
    expect(screen.getByLabelText("Bulk channel")).toBeDisabled();
    expect(screen.getByLabelText("Bulk state")).toBeDisabled();
    expect(screen.getByLabelText("Bulk reason")).toBeDisabled();
    expect(screen.getByLabelText("Bulk source")).toBeDisabled();
    expect(screen.getByLabelText("Search suppression")).toBeDisabled();
    expect(screen.getByLabelText("Channel")).toBeDisabled();
    expect(screen.getByLabelText("State")).toBeDisabled();
    await user.click(selection);
    await user.selectOptions(screen.getByLabelText("Bulk channel"), "sms");
    await user.click(screen.getByRole("button", { name: "Set selected suppression" }));
    expect(bulkSetSuppression).toHaveBeenCalledTimes(1);

    await act(async () => result.resolve(failure<{ updated: number }>()));
    expect(
      await screen.findByRole("button", { name: "Retry setting selected suppression" }),
    ).toBeInTheDocument();
    expect(selection).toBeEnabled();
    expect(screen.getByLabelText("Bulk channel")).toBeEnabled();
    expect(screen.getByLabelText("Search suppression")).toBeEnabled();
  });
});
