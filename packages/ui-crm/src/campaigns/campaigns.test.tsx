// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CrmCapabilities, CrmNavigation, CrmUiResult, JsonValue } from "../index";
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
      navigation={navigation} channelExtensions={[{
        id: "provider", label: "Provider", Panel,
        validate: () => { throw new Error("secret"); },
        serialize: (value) => value,
      }]} />);
    await user.type(screen.getByLabelText("Campaign name"), "New campaign");
    await user.selectOptions(screen.getByLabelText("Channel configuration"), "provider");
    await user.type(screen.getByLabelText("Provider token"), "abc");
    await user.click(screen.getByRole("button", { name: "Create campaign" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("extension configuration failed");
  });

  it("previews the currently selected canonical audience", async () => {
    const source = adapter({
      previewAudience: vi.fn(async () => ok({ total: 12, sample: [] })),
    });
    const user = userEvent.setup();
    render(<CampaignWizardScreen adapter={source} capabilities={capabilities}
      navigation={navigation} />);
    await user.selectOptions(screen.getByLabelText("Audience type"), "list");
    await user.type(screen.getByLabelText("Audience list"), "list-7");
    await user.click(screen.getByRole("button", { name: "Preview audience" }));
    expect(await screen.findByText("12 contacts")).toBeInTheDocument();
    expect(source.previewAudience).toHaveBeenCalledWith({ type: "list", listId: "list-7" });
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
});
