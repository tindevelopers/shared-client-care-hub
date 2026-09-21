// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type {
  AudienceSourceExtensionDefinition,
  CrmCapabilities,
  CrmNavigation,
  CrmUiResult,
  JsonValue,
} from "../index";
import {
  defineAudienceSourceExtension,
  defineCampaignChannelExtension,
} from "../index";
import {
  CampaignAnalyticsScreen,
  CampaignDetailScreen,
  CampaignRecipientsScreen,
  CampaignsScreen,
  CampaignWizardScreen,
  type CampaignDetailVm,
  type CampaignPage,
  type CampaignsAdapter,
} from "../campaigns";

const capabilities: CrmCapabilities = {
  create: true,
  update: true,
  remove: true,
  import: true,
  bulkActions: true,
};

const navigation: CrmNavigation = {
  contacts: vi.fn(), contact: vi.fn(), editContact: vi.fn(), newContact: vi.fn(),
  importContacts: vi.fn(), lists: vi.fn(), list: vi.fn(), suppression: vi.fn(),
  campaigns: vi.fn(), campaign: vi.fn(), editCampaign: vi.fn(), newCampaign: vi.fn(),
  recipients: vi.fn(), analytics: vi.fn(),
};

function ok<T>(data: T): CrmUiResult<T> {
  return { ok: true, data };
}

function failure<T = never>(message = "Try again"): CrmUiResult<T> {
  return { ok: false, error: { code: "temporary", message, retryable: true } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const campaign = {
  id: "campaign-1",
  name: "Autumn launch",
  description: "Launch campaign",
  status: "draft",
  campaign_type: "email",
  schedule_start: null,
  schedule_end: null,
  provider: null,
  created_at: "2026-09-19",
  updated_at: "2026-09-19",
} satisfies CampaignPage["items"][number];

const detail = {
  ...campaign,
  tenant_id: "00000000-0000-0000-0000-000000000001",
  assistant_id: null,
  from_number: null,
  message_template: null,
  calling_window_start: null,
  calling_window_end: null,
  calling_days: null,
  max_attempts: null,
  retry_delay_minutes: null,
  max_concurrent_calls: null,
  calls_per_minute: null,
  settings: null,
  created_by: null,
  deleted_at: null,
  timezone: null,
  max_conversation_turns: 10,
  no_reply_timeout_minutes: 120,
  max_sends_per_recipient: 50,
  global_send_rate_per_minute: 60,
  provider_campaign_id: null,
  template_ref: null,
  segment_ref: null,
} satisfies CampaignDetailVm;

function adapter(overrides: Partial<CampaignsAdapter> = {}): CampaignsAdapter {
  return {
    listCampaigns: vi.fn(async () => ok({ items: [campaign], total: 1, limit: 20, offset: 0 })),
    getCampaign: vi.fn(async () => ok(detail)),
    createCampaign: vi.fn(async () => ok({ id: "campaign-new" })),
    updateCampaign: vi.fn(async () => ok(undefined)),
    deleteCampaign: vi.fn(async () => ok(undefined)),
    transitionCampaign: vi.fn(async (_id, action) =>
      ok({ ...detail, status: action === "schedule" ? "scheduled" : "running" })),
    getStats: vi.fn(async () => ok({
      total: 0, pending: 0, scheduled: 0, inProgress: 0, completed: 0,
      failed: 0, skipped: 0, optedOut: 0, noAnswer: 0, voicemail: 0,
    })),
    listRecipients: vi.fn(async (_id, query) => ok({
      items: [{
        id: "recipient-1", firstName: "Ada", lastName: "Lovelace",
        phone: "+15550001", email: "ada@example.com", timezone: null,
        status: "pending", scheduledAt: null, attempts: 0, completedAt: null,
      }],
      total: 21, limit: query?.limit ?? 20, offset: query?.offset ?? 0,
    })),
    previewAudience: vi.fn(async () => ok({ total: 0, sample: [] })),
    replaceAudience: vi.fn(async () => ok({ replaced: 0 })),
    ...overrides,
  };
}

describe("CampaignsScreen", () => {
  it("renders list, empty, and normalized adapter errors", async () => {
    const { rerender } = render(
      <CampaignsScreen adapter={adapter()} capabilities={capabilities} navigation={navigation} />,
    );
    expect(await screen.findByRole("button", { name: "Autumn launch" })).toBeInTheDocument();

    rerender(<CampaignsScreen adapter={adapter({
      listCampaigns: vi.fn(async () => ok({ items: [], total: 0, limit: 20, offset: 0 })),
    })} capabilities={capabilities} navigation={navigation} />);
    expect(await screen.findByText("No campaigns found.")).toBeInTheDocument();

    rerender(<CampaignsScreen adapter={adapter({
      listCampaigns: vi.fn(async () => { throw new Error("provider secret"); }),
    })} capabilities={capabilities} navigation={navigation} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("failed unexpectedly");
  });

  it("filters by canonical status and type and resets paging", async () => {
    const source = adapter({
      listCampaigns: vi.fn(async (query) => ok({
        items: [campaign], total: 40, limit: query?.limit ?? 20, offset: query?.offset ?? 0,
      })),
    });
    const user = userEvent.setup();
    render(<CampaignsScreen adapter={source} capabilities={capabilities} navigation={navigation} />);
    await screen.findByText("Autumn launch");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await user.selectOptions(screen.getByLabelText("Campaign status"), "running");
    await user.selectOptions(screen.getByLabelText("Campaign type"), "sms");
    await waitFor(() => expect(source.listCampaigns).toHaveBeenLastCalledWith({
      limit: 20, offset: 0, status: "running", type: "sms",
    }));
  });
});

describe("CampaignDetailScreen", () => {
  it("derives lifecycle actions from canonical statuses and hides all for unknown status", async () => {
    const { rerender } = render(
      <CampaignDetailScreen campaignId="campaign-1" adapter={adapter()}
        capabilities={capabilities} navigation={navigation} />,
    );
    expect(await screen.findByRole("button", { name: "Schedule campaign" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start campaign" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause campaign" })).not.toBeInTheDocument();

    rerender(<CampaignDetailScreen campaignId="campaign-2" adapter={adapter({
      getCampaign: vi.fn(async () => ok({ ...detail, id: "campaign-2", status: "drifted" as never })),
    })} capabilities={capabilities} navigation={navigation} />);
    await screen.findByText("drifted");
    for (const label of ["Schedule", "Start", "Pause", "Resume", "Complete", "Cancel"]) {
      expect(screen.queryByRole("button", { name: `${label} campaign` })).not.toBeInTheDocument();
    }
  });

  it("keeps lifecycle and delete writes behind one stable lock", async () => {
    const pending = deferred<CrmUiResult<CampaignDetailVm>>();
    const source = adapter({ transitionCampaign: vi.fn(() => pending.promise) });
    const user = userEvent.setup();
    render(<CampaignDetailScreen campaignId="campaign-1" adapter={source}
      capabilities={capabilities} navigation={navigation} />);
    await user.click(await screen.findByRole("button", { name: "Start campaign" }));
    expect(screen.getByRole("button", { name: "Delete campaign" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Delete campaign" }));
    expect(source.deleteCampaign).not.toHaveBeenCalled();
    await act(async () => pending.resolve(ok({ ...detail, status: "running" })));
  });

  it.each([
    ["draft", ["Schedule", "Start", "Cancel"]],
    ["scheduled", ["Start", "Pause", "Cancel"]],
    ["running", ["Pause", "Complete", "Cancel"]],
    ["paused", ["Resume", "Cancel"]],
    ["sent", ["Complete"]],
    ["completed", []],
    ["cancelled", []],
    [null, []],
  ] as const)("renders exact lifecycle actions for %s", async (status, labels) => {
    render(<CampaignDetailScreen campaignId="campaign-1" adapter={adapter({
      getCampaign: vi.fn(async () => ok({ ...detail, status })),
    })} capabilities={capabilities} navigation={navigation} />);
    await screen.findByRole("heading", { name: detail.name });
    for (const label of ["Schedule", "Start", "Pause", "Resume", "Complete", "Cancel"]) {
      const action = screen.queryByRole("button", { name: `${label} campaign` });
      expect(Boolean(action)).toBe(labels.includes(label as never));
    }
  });

  it("shows an update-gated edit action", async () => {
    const source = adapter();
    const user = userEvent.setup();
    const { rerender } = render(<CampaignDetailScreen campaignId="campaign-1"
      adapter={source} capabilities={capabilities} navigation={navigation} />);
    await user.click(await screen.findByRole("button", { name: "Edit campaign" }));
    expect(navigation.editCampaign).toHaveBeenCalledWith("campaign-1");
    rerender(<CampaignDetailScreen campaignId="campaign-1" adapter={source}
      capabilities={{ ...capabilities, update: false }} navigation={navigation} />);
    expect(screen.queryByRole("button", { name: "Edit campaign" })).not.toBeInTheDocument();
  });
});

describe("CampaignWizardScreen", () => {
  it("creates a campaign without extensions and replaces its canonical audience", async () => {
    const source = adapter();
    const user = userEvent.setup();
    render(<CampaignWizardScreen adapter={source} capabilities={capabilities}
      navigation={navigation} />);
    await user.type(screen.getByLabelText("Campaign name"), "New campaign");
    await user.selectOptions(screen.getByLabelText("Audience type"), "tag");
    await user.type(screen.getByLabelText("Audience tag"), "vip");
    await user.click(screen.getByRole("button", { name: "Create campaign" }));
    await waitFor(() => expect(source.createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ name: "New campaign", campaign_type: "email" }),
    ));
    expect(source.replaceAudience).toHaveBeenCalledWith("campaign-new", { type: "tag", tag: "vip" });
    expect(navigation.campaign).toHaveBeenCalledWith("campaign-new");
  });

  it("renders extension panels and turns thrown validation into a safe UI error", async () => {
    function Panel({ value, onChange }: {
      value: JsonValue; disabled: boolean; onChange(value: JsonValue): void;
    }) {
      return <label>Provider token<input value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)} /></label>;
    }
    const user = userEvent.setup();
    render(<CampaignWizardScreen adapter={adapter()} capabilities={capabilities}
      navigation={navigation} channelExtensions={[defineCampaignChannelExtension({
        id: "provider", label: "Provider", Panel,
        initialValue: null,
        validate: () => { throw new Error("secret"); },
        serialize: (value) => value,
      })]} />);
    await user.type(screen.getByLabelText("Campaign name"), "New campaign");
    await user.selectOptions(screen.getByLabelText("Channel configuration"), "provider");
    await user.type(screen.getByLabelText("Provider token"), "abc");
    await user.click(screen.getByRole("button", { name: "Create campaign" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("extension configuration failed");
    await user.selectOptions(screen.getByLabelText("Channel configuration"), "");
    expect(screen.queryByText("The extension configuration failed.")).not.toBeInTheDocument();
  });

  it("previews the currently selected canonical audience", async () => {
    const source = adapter({
      previewAudience: vi.fn(async () => ok({ total: 12, sample: [{
        id: "contact-1", first_name: "Ada", last_name: "Lovelace",
        email: "ada@example.com", phone: "+15550001", mobile: null,
        job_title: null, tags: [], sms_opt_out: false, email_opt_out: false,
        whatsapp_opt_out: false, updated_at: "2026-09-19", companyName: null,
      }] })),
    });
    const user = userEvent.setup();
    render(<CampaignWizardScreen adapter={source} capabilities={capabilities}
      navigation={navigation} />);
    await user.selectOptions(screen.getByLabelText("Audience type"), "list");
    await user.type(screen.getByLabelText("Audience list"), "list-7");
    await user.click(screen.getByRole("button", { name: "Preview audience" }));
    expect(await screen.findByText("12 contacts")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Ada Lovelace/ })).toHaveTextContent("ada@example.com");
    expect(source.previewAudience).toHaveBeenCalledWith({ type: "list", listId: "list-7" });
    await user.type(screen.getByLabelText("Audience list"), "-changed");
    expect(screen.queryByText("12 contacts")).not.toBeInTheDocument();
  });

  it("fails closed when create capability is absent", () => {
    render(<CampaignWizardScreen adapter={adapter()}
      capabilities={{ ...capabilities, create: false }} navigation={navigation} />);
    expect(screen.getByRole("button", { name: "Create campaign" })).toBeDisabled();
  });

  it("does not show fields loaded for the previous campaign identity", async () => {
    const second = deferred<CrmUiResult<CampaignDetailVm | null>>();
    const source = adapter({
      getCampaign: vi.fn(async (id) => id === "campaign-1"
        ? ok(detail)
        : second.promise),
    });
    const { rerender } = render(<CampaignWizardScreen campaignId="campaign-1"
      adapter={source} capabilities={capabilities} navigation={navigation} />);
    expect(await screen.findByDisplayValue("Autumn launch")).toBeInTheDocument();
    rerender(<CampaignWizardScreen campaignId="campaign-2"
      adapter={source} capabilities={capabilities} navigation={navigation} />);
    expect(screen.queryByDisplayValue("Autumn launch")).not.toBeInTheDocument();
    await act(async () => second.resolve(ok({ ...detail, id: "campaign-2", name: "Winter launch" })));
    expect(await screen.findByDisplayValue("Winter launch")).toBeInTheDocument();
  });

  it("preserves unknown audience and settings during a name-only edit", async () => {
    const originalStart = "2026-10-01T09:00:00+05:00";
    const source = adapter({
      getCampaign: vi.fn(async () => ok({
        ...detail, schedule_start: originalStart, settings: { providerSecret: "opaque" },
      })),
    });
    const user = userEvent.setup();
    render(<CampaignWizardScreen campaignId="campaign-1" adapter={source}
      capabilities={capabilities} navigation={navigation} />);
    const name = await screen.findByLabelText("Campaign name");
    await user.clear(name);
    await user.type(name, "Renamed");
    await user.click(screen.getByRole("button", { name: "Save campaign" }));
    await waitFor(() => expect(source.updateCampaign).toHaveBeenCalled());
    const patch = vi.mocked(source.updateCampaign).mock.calls[0]?.[1];
    expect(patch).not.toHaveProperty("settings");
    expect(patch?.schedule_start).toBe(originalStart);
    expect(source.replaceAudience).not.toHaveBeenCalled();
  });

  it("renders and normalizes every canonical input field", async () => {
    const source = adapter();
    const user = userEvent.setup();
    render(<CampaignWizardScreen adapter={source} capabilities={capabilities}
      navigation={navigation} />);
    await user.type(screen.getByLabelText("Campaign name"), "Complete input");
    await user.type(screen.getByLabelText("Schedule start"), "2026-10-01T09:00");
    await user.type(screen.getByLabelText("Schedule end"), "2026-10-02T09:00");
    await user.type(screen.getByLabelText("Calling window start"), "09:00");
    await user.type(screen.getByLabelText("Calling window end"), "17:00");
    await user.type(screen.getByLabelText("Calling days"), "1, 3, 5");
    await user.type(screen.getByLabelText("Timezone"), "UTC");
    await user.type(screen.getByLabelText("Message template"), "Hello");
    await user.click(screen.getByRole("button", { name: "Create campaign" }));
    await waitFor(() => expect(source.createCampaign).toHaveBeenCalledWith(expect.objectContaining({
      schedule_start: new Date("2026-10-01T09:00").toISOString(),
      schedule_end: new Date("2026-10-02T09:00").toISOString(),
      calling_window_start: "09:00",
      calling_window_end: "17:00",
      calling_days: [1, 3, 5],
      timezone: "UTC",
      message_template: "Hello",
    })));
  });

  it.each([
    {
      label: "schedule order",
      fill: async (user: ReturnType<typeof userEvent.setup>) => {
        await user.type(screen.getByLabelText("Schedule start"), "2026-10-02T09:00");
        await user.type(screen.getByLabelText("Schedule end"), "2026-10-01T09:00");
      },
      message: "Schedule end must be after schedule start.",
    },
    {
      label: "calling window order",
      fill: async (user: ReturnType<typeof userEvent.setup>) => {
        await user.type(screen.getByLabelText("Calling window start"), "17:00");
        await user.type(screen.getByLabelText("Calling window end"), "09:00");
      },
      message: "Calling window end must be after its start.",
    },
    {
      label: "timezone",
      fill: async (user: ReturnType<typeof userEvent.setup>) => {
        await user.type(screen.getByLabelText("Timezone"), "Mars/Olympus");
      },
      message: "Enter a valid IANA timezone.",
    },
    {
      label: "empty calling-day token",
      fill: async (user: ReturnType<typeof userEvent.setup>) => {
        await user.type(screen.getByLabelText("Calling days"), "1,,3");
      },
      message: "Calling days must be unique integers from 0 through 6.",
    },
    {
      label: "duplicate calling day",
      fill: async (user: ReturnType<typeof userEvent.setup>) => {
        await user.type(screen.getByLabelText("Calling days"), "1,1");
      },
      message: "Calling days must be unique integers from 0 through 6.",
    },
    {
      label: "out-of-range calling day",
      fill: async (user: ReturnType<typeof userEvent.setup>) => {
        await user.type(screen.getByLabelText("Calling days"), "7");
      },
      message: "Calling days must be unique integers from 0 through 6.",
    },
  ])("rejects invalid $label", async ({ fill, message }) => {
    const source = adapter();
    const user = userEvent.setup();
    render(<CampaignWizardScreen adapter={source} capabilities={capabilities}
      navigation={navigation} />);
    await user.type(screen.getByLabelText("Campaign name"), "Invalid campaign");
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Create campaign" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(source.createCampaign).not.toHaveBeenCalled();
  });

  it("fully resets state across create and edit owners before paint", async () => {
    const pending = deferred<CrmUiResult<CampaignDetailVm | null>>();
    const source = adapter({ getCampaign: vi.fn(() => pending.promise) });
    const user = userEvent.setup();
    const { rerender } = render(<CampaignWizardScreen adapter={source}
      capabilities={capabilities} navigation={navigation} />);
    await user.type(screen.getByLabelText("Campaign name"), "Create draft");
    await user.type(screen.getByLabelText("Timezone"), "UTC");
    rerender(<CampaignWizardScreen campaignId="campaign-2" adapter={source}
      capabilities={capabilities} navigation={navigation} />);
    expect(screen.queryByDisplayValue("Create draft")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save campaign" })).not.toBeInTheDocument();
    await act(async () => pending.resolve(ok({
      ...detail, id: "campaign-2", name: "Edit owner", timezone: "America/New_York",
    })));
    expect(await screen.findByDisplayValue("Edit owner")).toBeInTheDocument();
    rerender(<CampaignWizardScreen adapter={source}
      capabilities={capabilities} navigation={navigation} />);
    expect(screen.getByLabelText("Campaign name")).toHaveValue("");
    expect(screen.getByLabelText("Timezone")).toHaveValue("");
    expect(screen.queryByDisplayValue("Edit owner")).not.toBeInTheDocument();
  });

  it("supports mixed strongly typed extension definitions without host casts", async () => {
    type FileConfig = { path: string };
    type SheetConfig = { sheetId: number };
    function FilePanel({ value }: {
      value: FileConfig; disabled: boolean; onChange(value: FileConfig): void;
    }) {
      return <p>File {value.path}</p>;
    }
    function SheetPanel({ value }: {
      value: SheetConfig; disabled: boolean; onChange(value: SheetConfig): void;
    }) {
      return <p>Sheet {value.sheetId}</p>;
    }
    const file = defineAudienceSourceExtension<FileConfig>({
      id: "file", label: "File", initialValue: { path: "contacts.csv" },
      Panel: FilePanel, validate: () => ok(undefined), serialize: (value) => value,
    });
    const sheet = defineAudienceSourceExtension<SheetConfig>({
      id: "sheet", label: "Sheet", initialValue: { sheetId: 42 },
      Panel: SheetPanel, validate: () => ok(undefined), serialize: (value) => value,
    });
    expectTypeOf([file, sheet]).toMatchTypeOf<AudienceSourceExtensionDefinition[]>();
    const user = userEvent.setup();
    render(<CampaignWizardScreen adapter={adapter()} capabilities={capabilities}
      navigation={navigation} audienceExtensions={[file, sheet]} />);
    await user.selectOptions(screen.getByLabelText("Audience configuration"), "file");
    expect(screen.getByText("File contacts.csv")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Audience configuration"), "sheet");
    expect(screen.getByText("Sheet 42")).toBeInTheDocument();
  });

  it("keeps extension configs scoped while switching selections", async () => {
    function ConfigPanel({ value, onChange }: {
      value: JsonValue; disabled: boolean; onChange(value: JsonValue): void;
    }) {
      return <label>Extension value<input value={String(value)}
        onChange={(event) => onChange(event.target.value)} /></label>;
    }
    const extensions = [
      defineCampaignChannelExtension({
        id: "one", label: "One", initialValue: "one",
        Panel: ConfigPanel, validate: () => ok(undefined), serialize: (value) => value,
      }),
      defineCampaignChannelExtension({
        id: "two", label: "Two", initialValue: "two",
        Panel: ConfigPanel, validate: () => ok(undefined), serialize: (value) => value,
      }),
    ];
    const user = userEvent.setup();
    render(<CampaignWizardScreen adapter={adapter()} capabilities={capabilities}
      navigation={navigation} channelExtensions={extensions} />);
    await user.selectOptions(screen.getByLabelText("Channel configuration"), "one");
    await user.clear(screen.getByLabelText("Extension value"));
    await user.type(screen.getByLabelText("Extension value"), "custom");
    await user.selectOptions(screen.getByLabelText("Channel configuration"), "two");
    expect(screen.getByLabelText("Extension value")).toHaveValue("two");
    await user.selectOptions(screen.getByLabelText("Channel configuration"), "one");
    expect(screen.getByLabelText("Extension value")).toHaveValue("custom");
  });

  it("contains throwing extension panels and keeps the canonical form usable", async () => {
    let shouldThrow = true;
    function ThrowingPanel() {
      if (shouldThrow) throw new Error("secret panel failure");
      return <p>Panel recovered</p>;
    }
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const user = userEvent.setup();
      render(<CampaignWizardScreen adapter={adapter()} capabilities={capabilities}
        navigation={navigation} channelExtensions={[defineCampaignChannelExtension({
          id: "thrower", label: "Thrower", Panel: ThrowingPanel,
          initialValue: null,
          validate: () => ok(undefined), serialize: (value) => value,
        })]} />);
      await user.selectOptions(screen.getByLabelText("Channel configuration"), "thrower");
      expect(await screen.findByText("Extension panel unavailable.")).toBeInTheDocument();
      expect(screen.getByLabelText("Campaign name")).toBeInTheDocument();
      shouldThrow = false;
      await user.click(screen.getByRole("button", { name: "Retry extension panel" }));
      expect(await screen.findByText("Panel recovered")).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("ignores stale provider callbacks after the wizard owner changes", async () => {
    let delayedChange: ((value: JsonValue) => void) | undefined;
    function DelayedPanel({ onChange }: {
      value: JsonValue; disabled: boolean; onChange(value: JsonValue): void;
    }) {
      delayedChange = onChange;
      return <p>Delayed panel</p>;
    }
    const extension = defineCampaignChannelExtension({
      id: "delayed", label: "Delayed", initialValue: { token: "" },
      Panel: DelayedPanel, validate: () => ok(undefined), serialize: (value) => value,
    });
    const source = adapter({
      getCampaign: vi.fn(async (id) => ok({
        ...detail, id, name: id === "campaign-a" ? "Campaign A" : "Campaign B",
      })),
    });
    const user = userEvent.setup();
    const { rerender } = render(<CampaignWizardScreen campaignId="campaign-a"
      adapter={source} capabilities={capabilities} navigation={navigation}
      channelExtensions={[extension]} />);
    await screen.findByDisplayValue("Campaign A");
    await user.selectOptions(screen.getByLabelText("Channel configuration"), "delayed");
    expect(delayedChange).toBeDefined();
    const staleChange = delayedChange;
    rerender(<CampaignWizardScreen campaignId="campaign-b"
      adapter={source} capabilities={capabilities} navigation={navigation}
      channelExtensions={[extension]} />);
    const name = await screen.findByDisplayValue("Campaign B");
    act(() => staleChange?.({ token: "stale" }));
    await user.clear(name);
    await user.type(name, "Campaign B renamed");
    await user.click(screen.getByRole("button", { name: "Save campaign" }));
    await waitFor(() => expect(source.updateCampaign).toHaveBeenCalled());
    expect(vi.mocked(source.updateCampaign).mock.calls.at(-1)?.[1]).not.toHaveProperty("settings");
  });

  it("retries the exact edit mutation and clears retry when update is revoked", async () => {
    const source = adapter({
      updateCampaign: vi.fn()
        .mockResolvedValueOnce(failure("Save failed"))
        .mockResolvedValueOnce(ok(undefined)),
    });
    const user = userEvent.setup();
    const { rerender } = render(<CampaignWizardScreen campaignId="campaign-1"
      adapter={source} capabilities={capabilities} navigation={navigation} />);
    const name = await screen.findByLabelText("Campaign name");
    await user.clear(name);
    await user.type(name, "Retry name");
    await user.click(screen.getByRole("button", { name: "Save campaign" }));
    await user.click(await screen.findByRole("button", { name: "Retry saving campaign" }));
    expect(source.updateCampaign).toHaveBeenCalledTimes(2);

    vi.mocked(source.updateCampaign).mockResolvedValueOnce(failure("Again"));
    await user.click(screen.getByRole("button", { name: "Save campaign" }));
    expect(await screen.findByText("Again")).toBeInTheDocument();
    rerender(<CampaignWizardScreen campaignId="campaign-1" adapter={source}
      capabilities={{ ...capabilities, update: false }} navigation={navigation} />);
    expect(screen.queryByRole("button", { name: "Retry saving campaign" })).not.toBeInTheDocument();
  });
});

describe("CampaignRecipientsScreen", () => {
  it("requests recipient pages from the adapter", async () => {
    const source = adapter();
    const user = userEvent.setup();
    render(<CampaignRecipientsScreen campaignId="campaign-1" adapter={source}
      capabilities={capabilities} navigation={navigation} />);
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next recipients" }));
    await waitFor(() => expect(source.listRecipients).toHaveBeenLastCalledWith(
      "campaign-1", { limit: 20, offset: 20 },
    ));
    expect(screen.getByRole("button", { name: "Next recipients" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous recipients" })).toBeEnabled();
    await user.selectOptions(screen.getByLabelText("Recipient status"), "failed");
    await waitFor(() => expect(source.listRecipients).toHaveBeenLastCalledWith(
      "campaign-1", { limit: 20, offset: 0, status: "failed" },
    ));
  });

  it("normalizes recipient errors and ignores stale campaign results", async () => {
    const old = deferred<CrmUiResult<ReturnType<CampaignsAdapter["listRecipients"]> extends Promise<CrmUiResult<infer T>> ? T : never>>();
    const source = adapter({
      listRecipients: vi.fn((id) => id === "old"
        ? old.promise
        : Promise.resolve(failure("Recipients failed"))),
    });
    const { rerender } = render(<CampaignRecipientsScreen campaignId="old" adapter={source}
      capabilities={capabilities} navigation={navigation} />);
    rerender(<CampaignRecipientsScreen campaignId="new" adapter={source}
      capabilities={capabilities} navigation={navigation} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Recipients failed");
    await act(async () => old.resolve(ok({
      items: [], total: 0, limit: 20, offset: 0,
    })));
    expect(screen.getByRole("alert")).toHaveTextContent("Recipients failed");
  });
});

describe("CampaignAnalyticsScreen", () => {
  it("renders zero values as accessible numeric data and charts only through extensions", async () => {
    const Panel = vi.fn(({ campaignId }: { campaignId: string; data: JsonValue }) =>
      <p>Provider analytics {campaignId}</p>);
    render(<CampaignAnalyticsScreen campaignId="campaign-1" adapter={adapter()}
      capabilities={capabilities} navigation={navigation}
      analyticsExtensions={[{ id: "provider", label: "Provider", Panel }]} />);
    expect(await screen.findByRole("table", { name: "Campaign analytics" })).toBeInTheDocument();
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    expect(screen.getByText("Provider analytics campaign-1")).toBeInTheDocument();
    expect(Panel).toHaveBeenCalledWith(expect.objectContaining({
      campaignId: "campaign-1",
      data: expect.objectContaining({ total: 0 }),
    }), undefined);
  });

  it("normalizes analytics errors, ignores stale identity, and contains throwing panels", async () => {
    const old = deferred<CrmUiResult<Awaited<ReturnType<CampaignsAdapter["getStats"]>> extends CrmUiResult<infer T> ? T : never>>();
    function ThrowingAnalytics(): never {
      throw new Error("analytics secret");
    }
    const source = adapter({
      getStats: vi.fn((id) => id === "old" ? old.promise : Promise.resolve(ok({
        total: 1, pending: 1, scheduled: 0, inProgress: 0, completed: 0,
        failed: 0, skipped: 0, optedOut: 0, noAnswer: 0, voicemail: 0,
      }))),
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { rerender } = render(<CampaignAnalyticsScreen campaignId="old" adapter={source}
        capabilities={capabilities} navigation={navigation} analyticsExtensions={[{
          id: "thrower", label: "Thrower", Panel: ThrowingAnalytics,
        }]} />);
      rerender(<CampaignAnalyticsScreen campaignId="new" adapter={source}
        capabilities={capabilities} navigation={navigation} analyticsExtensions={[{
          id: "thrower", label: "Thrower", Panel: ThrowingAnalytics,
        }]} />);
      expect(await screen.findByText("Extension panel unavailable.")).toBeInTheDocument();
      await act(async () => old.resolve(failure("Old analytics")));
      expect(screen.queryByText("Old analytics")).not.toBeInTheDocument();
      expect(screen.getByRole("table", { name: "Campaign analytics" })).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("renders retryable analytics errors", async () => {
    render(<CampaignAnalyticsScreen campaignId="campaign-1" adapter={adapter({
      getStats: vi.fn(async () => failure("Analytics failed")),
    })} capabilities={capabilities} navigation={navigation} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Analytics failed");
    expect(screen.getByRole("button", { name: "Retry loading analytics" })).toBeInTheDocument();
  });

  it("recovers a failed analytics panel when its implementation is replaced", async () => {
    function Broken(): never {
      throw new Error("broken");
    }
    function Replacement() {
      return <p>Replacement analytics</p>;
    }
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const source = adapter();
      const { rerender } = render(<CampaignAnalyticsScreen campaignId="campaign-1"
        adapter={source} capabilities={capabilities} navigation={navigation}
        analyticsExtensions={[{ id: "provider", label: "Provider", Panel: Broken }]} />);
      expect(await screen.findByText("Extension panel unavailable.")).toBeInTheDocument();
      rerender(<CampaignAnalyticsScreen campaignId="campaign-1"
        adapter={source} capabilities={capabilities} navigation={navigation}
        analyticsExtensions={[{ id: "provider", label: "Provider", Panel: Replacement }]} />);
      expect(await screen.findByText("Replacement analytics")).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });
});
