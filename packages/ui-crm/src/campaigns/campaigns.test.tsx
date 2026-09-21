// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CrmCapabilities, CrmUiResult } from "../index";
import type { AnalyticsExtension, CampaignChannelExtension, ProviderPanelProps } from "../core/provider-extensions";
import {
  CampaignAnalyticsScreen,
  CampaignDetailScreen,
  CampaignRecipientsScreen,
  CampaignsScreen,
  CampaignWizardScreen,
  type CampaignDetailVm,
  type CampaignRecipientPage,
  type CampaignsAdapter,
  type CampaignStatsVm,
  type CampaignSummaryVm,
} from "../campaigns";

const capabilities: CrmCapabilities = {
  create: true,
  update: true,
  remove: true,
  import: true,
  bulkActions: true,
};

const navigation = {
  contacts: vi.fn(),
  contact: vi.fn(),
  editContact: vi.fn(),
  newContact: vi.fn(),
  importContacts: vi.fn(),
  lists: vi.fn(),
  list: vi.fn(),
  suppression: vi.fn(),
  campaigns: vi.fn(),
  campaign: vi.fn(),
  editCampaign: vi.fn(),
  newCampaign: vi.fn(),
  recipients: vi.fn(),
  analytics: vi.fn(),
};

function ok<T>(data: T): CrmUiResult<T> {
  return { ok: true, data };
}

function failure<T = never>(message = "Try again"): CrmUiResult<T> {
  return { ok: false, error: { code: "temporary", message, retryable: true } };
}

const baseCampaign: CampaignDetailVm = {
  id: "campaign-1",
  tenant_id: "tenant-1",
  name: "Spring sale",
  description: null,
  status: "draft",
  campaign_type: "sms",
  assistant_id: null,
  from_number: null,
  message_template: null,
  schedule_start: null,
  schedule_end: null,
  calling_window_start: null,
  calling_window_end: null,
  calling_days: null,
  max_attempts: null,
  retry_delay_minutes: null,
  max_concurrent_calls: null,
  calls_per_minute: null,
  settings: null,
  created_by: null,
  created_at: "2026-09-19T00:00:00Z",
  updated_at: "2026-09-19T00:00:00Z",
  deleted_at: null,
  timezone: null,
  max_conversation_turns: 10,
  no_reply_timeout_minutes: 120,
  max_sends_per_recipient: 50,
  global_send_rate_per_minute: 60,
  provider: null,
  provider_campaign_id: null,
  template_ref: null,
  segment_ref: null,
};

const summaryFrom = (campaign: CampaignDetailVm): CampaignSummaryVm => ({
  id: campaign.id,
  name: campaign.name,
  description: campaign.description,
  status: campaign.status,
  campaign_type: campaign.campaign_type,
  schedule_start: campaign.schedule_start,
  schedule_end: campaign.schedule_end,
  provider: campaign.provider,
  created_at: campaign.created_at,
  updated_at: campaign.updated_at,
});

const zeroStats: CampaignStatsVm = {
  total: 0,
  pending: 0,
  scheduled: 0,
  inProgress: 0,
  completed: 0,
  failed: 0,
  skipped: 0,
  optedOut: 0,
  noAnswer: 0,
  voicemail: 0,
};

function adapter(overrides: Partial<CampaignsAdapter> = {}): CampaignsAdapter {
  return {
    listCampaigns: vi.fn(async () => ok({ items: [], total: 0, limit: 20, offset: 0 })),
    getCampaign: vi.fn(async () => ok(baseCampaign)),
    createCampaign: vi.fn(async () => ok({ id: "campaign-new" })),
    updateCampaign: vi.fn(async () => ok(undefined)),
    deleteCampaign: vi.fn(async () => ok(undefined)),
    transitionCampaign: vi.fn(async () => ok(baseCampaign)),
    getStats: vi.fn(async () => ok(zeroStats)),
    listRecipients: vi.fn(async () => ok({ items: [], total: 0, limit: 20, offset: 0 })),
    previewAudience: vi.fn(async () => ok({ total: 0, sample: [] })),
    replaceAudience: vi.fn(async () => ok({ replaced: 0 })),
    ...overrides,
  };
}

describe("CampaignsScreen", () => {
  it("lists campaigns", async () => {
    const source = adapter({
      listCampaigns: vi.fn(async () =>
        ok({
          items: [summaryFrom(baseCampaign), summaryFrom({ ...baseCampaign, id: "campaign-2", name: "Fall promo" })],
          total: 2,
          limit: 20,
          offset: 0,
        }),
      ),
    });
    render(<CampaignsScreen adapter={source} capabilities={capabilities} navigation={navigation} />);
    expect(await screen.findByRole("button", { name: "Spring sale" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fall promo" })).toBeInTheDocument();
  });

  it("shows an empty state when there are no campaigns", async () => {
    render(<CampaignsScreen adapter={adapter()} capabilities={capabilities} navigation={navigation} />);
    expect(await screen.findByText("No campaigns found.")).toBeInTheDocument();
  });

  it("converts a rejected promise into a safe, retryable-aware message", async () => {
    render(
      <CampaignsScreen
        adapter={adapter({ listCampaigns: vi.fn(async () => Promise.reject(new Error("secret"))) })}
        capabilities={capabilities}
        navigation={navigation}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("The operation failed unexpectedly.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("secret");
  });
});

describe("CampaignDetailScreen lifecycle", () => {
  it("shows only the valid lifecycle actions for a running campaign", async () => {
    const source = adapter({ getCampaign: vi.fn(async () => ok({ ...baseCampaign, status: "running" })) });
    render(
      <CampaignDetailScreen
        adapter={source}
        capabilities={capabilities}
        navigation={navigation}
        campaignId="campaign-1"
      />,
    );
    expect(await screen.findByRole("button", { name: "Pause campaign" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete campaign" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel campaign" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Schedule campaign" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start campaign" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume campaign" })).not.toBeInTheDocument();
  });

  it("hides every lifecycle action once a campaign is completed", async () => {
    const source = adapter({ getCampaign: vi.fn(async () => ok({ ...baseCampaign, status: "completed" })) });
    render(
      <CampaignDetailScreen
        adapter={source}
        capabilities={capabilities}
        navigation={navigation}
        campaignId="campaign-1"
      />,
    );
    await screen.findByRole("heading", { name: "Spring sale" });
    expect(screen.queryByRole("heading", { name: "Lifecycle" })).not.toBeInTheDocument();
  });

  it("runs a valid transition and reflects the campaign's new status", async () => {
    const transitionCampaign = vi.fn(async () => ok({ ...baseCampaign, status: "running" as const }));
    const source = adapter({
      getCampaign: vi.fn(async () => ok({ ...baseCampaign, status: "draft" })),
      transitionCampaign,
    });
    const user = userEvent.setup();
    render(
      <CampaignDetailScreen
        adapter={source}
        capabilities={capabilities}
        navigation={navigation}
        campaignId="campaign-1"
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Start campaign" }));
    expect(transitionCampaign).toHaveBeenCalledWith("campaign-1", "start");
    await waitFor(() => expect(screen.getByRole("button", { name: "Pause campaign" })).toBeInTheDocument());
  });
});

describe("CampaignRecipientsScreen", () => {
  const page = (offset: number): CampaignRecipientPage => ({
    items: [
      {
        id: `recipient-${offset}`,
        firstName: "Ada",
        lastName: "Lovelace",
        phone: "+15551234567",
        email: null,
        timezone: null,
        status: "pending",
        scheduledAt: null,
        attempts: 0,
        completedAt: null,
      },
    ],
    total: 25,
    limit: 20,
    offset,
  });

  it("pages recipients without loading the whole campaign", async () => {
    const listRecipients = vi.fn(async (_id: string, query) => ok(page(query?.offset ?? 0)));
    const source = adapter({ listRecipients });
    const user = userEvent.setup();
    render(<CampaignRecipientsScreen adapter={source} capabilities={capabilities} navigation={navigation} campaignId="campaign-1" />);
    await screen.findByText("Ada Lovelace");
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(listRecipients).toHaveBeenLastCalledWith("campaign-1", { limit: 20, offset: 20 }));
  });

  it("filters recipients by status", async () => {
    const listRecipients = vi.fn(async () => ok(page(0)));
    const source = adapter({ listRecipients });
    const user = userEvent.setup();
    render(<CampaignRecipientsScreen adapter={source} capabilities={capabilities} navigation={navigation} campaignId="campaign-1" />);
    await screen.findByText("Ada Lovelace");
    await user.selectOptions(screen.getByLabelText("Status"), "completed");
    await waitFor(() =>
      expect(listRecipients).toHaveBeenLastCalledWith("campaign-1", { limit: 20, offset: 0, status: "completed" }),
    );
  });
});

describe("CampaignAnalyticsScreen", () => {
  it("renders canonical numeric cards for a zero-data campaign", async () => {
    render(
      <CampaignAnalyticsScreen adapter={adapter()} capabilities={capabilities} navigation={navigation} campaignId="campaign-1" />,
    );
    await screen.findByText("Total");
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a provider analytics extension bound to the loaded stats", async () => {
    const Panel = ({ campaignId, data }: { campaignId: string; data: unknown }) => (
      <p data-testid="analytics-extension-panel">
        {campaignId}:{JSON.stringify(data)}
      </p>
    );
    const extension: AnalyticsExtension = { id: "telnyx", label: "Telnyx analytics", Panel };
    render(
      <CampaignAnalyticsScreen
        adapter={adapter()}
        capabilities={capabilities}
        navigation={navigation}
        campaignId="campaign-1"
        analyticsExtensions={[extension]}
      />,
    );
    expect(await screen.findByTestId("analytics-extension-panel")).toHaveTextContent("campaign-1");
  });
});

function fakeChannelExtension(overrides: Partial<CampaignChannelExtension> = {}): CampaignChannelExtension {
  const Panel = ({ value, disabled, onChange }: ProviderPanelProps<string>) => (
    <label>
      Telnyx from number
      <input
        value={typeof value === "string" ? value : ""}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
  return {
    id: "telnyx",
    label: "Telnyx",
    Panel: Panel as CampaignChannelExtension["Panel"],
    validate: vi.fn(() => ok(undefined)),
    serialize: vi.fn((value) => value),
    ...overrides,
  };
}

describe("CampaignWizardScreen", () => {
  it("creates a campaign with no provider extension selected", async () => {
    const createCampaign = vi.fn(async () => ok({ id: "campaign-new" }));
    const replaceAudience = vi.fn(async () => ok({ replaced: 3 }));
    const source = adapter({ createCampaign, replaceAudience });
    const user = userEvent.setup();
    render(
      <CampaignWizardScreen adapter={source} capabilities={capabilities} navigation={navigation} />,
    );
    await user.type(screen.getByLabelText("Campaign name"), "Spring sale");
    await user.click(screen.getByRole("button", { name: "Create campaign" }));
    await waitFor(() =>
      expect(createCampaign).toHaveBeenCalledWith(expect.objectContaining({ name: "Spring sale", campaign_type: "sms" })),
    );
    expect(replaceAudience).toHaveBeenCalledWith("campaign-new", { type: "all_contacts" });
    expect(navigation.campaign).toHaveBeenCalledWith("campaign-new");
  });

  it("previews each canonical audience type with its own arguments", async () => {
    const previewAudience = vi.fn(async () => ok({ total: 4, sample: [] }));
    const source = adapter({ previewAudience });
    const user = userEvent.setup();
    render(<CampaignWizardScreen adapter={source} capabilities={capabilities} navigation={navigation} />);

    await user.selectOptions(screen.getByLabelText("Audience source"), "tag");
    await user.type(screen.getByLabelText("Tag"), "vip");
    await user.click(screen.getByRole("button", { name: "Preview audience" }));
    await waitFor(() => expect(previewAudience).toHaveBeenLastCalledWith({ type: "tag", tag: "vip" }));
    expect(await screen.findByText("4 contacts match this audience.")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Audience source"), "list");
    await user.type(screen.getByLabelText("List id"), "list-9");
    await user.click(screen.getByRole("button", { name: "Preview audience" }));
    await waitFor(() => expect(previewAudience).toHaveBeenLastCalledWith({ type: "list", listId: "list-9" }));
  });

  it("renders a provider channel extension and blocks submit on its validation error", async () => {
    const validate = vi.fn(() => failure<void>("From number is required"));
    const extension = fakeChannelExtension({ validate });
    const createCampaign = vi.fn(async () => ok({ id: "campaign-new" }));
    const source = adapter({ createCampaign });
    const user = userEvent.setup();
    render(
      <CampaignWizardScreen
        adapter={source}
        capabilities={capabilities}
        navigation={navigation}
        channelExtensions={[extension]}
      />,
    );
    await user.type(screen.getByLabelText("Campaign name"), "Spring sale");
    await user.selectOptions(screen.getByLabelText("Provider channel"), "telnyx");
    expect(await screen.findByLabelText("Telnyx from number")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create campaign" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("From number is required");
    expect(createCampaign).not.toHaveBeenCalled();
  });

  it("serializes a valid provider channel extension into campaign settings", async () => {
    const extension = fakeChannelExtension();
    const createCampaign = vi.fn(async () => ok({ id: "campaign-new" }));
    const source = adapter({ createCampaign });
    const user = userEvent.setup();
    render(
      <CampaignWizardScreen
        adapter={source}
        capabilities={capabilities}
        navigation={navigation}
        channelExtensions={[extension]}
      />,
    );
    await user.type(screen.getByLabelText("Campaign name"), "Spring sale");
    await user.selectOptions(screen.getByLabelText("Provider channel"), "telnyx");
    await user.type(await screen.findByLabelText("Telnyx from number"), "+15550001111");
    await user.click(screen.getByRole("button", { name: "Create campaign" }));
    await waitFor(() =>
      expect(createCampaign).toHaveBeenCalledWith(
        expect.objectContaining({ settings: { telnyx: "+15550001111" } }),
      ),
    );
  });

  it("loads an existing campaign for edit and saves without re-selecting an audience", async () => {
    const updateCampaign = vi.fn(async () => ok(undefined));
    const replaceAudience = vi.fn(async () => ok({ replaced: 1 }));
    const source = adapter({
      getCampaign: vi.fn(async () => ok({ ...baseCampaign, name: "Original name" })),
      updateCampaign,
      replaceAudience,
    });
    const user = userEvent.setup();
    render(
      <CampaignWizardScreen
        adapter={source}
        capabilities={capabilities}
        navigation={navigation}
        campaignId="campaign-1"
      />,
    );
    const nameField = await screen.findByLabelText("Campaign name");
    expect(nameField).toHaveValue("Original name");
    await user.clear(nameField);
    await user.type(nameField, "Updated name");
    await user.click(screen.getByRole("button", { name: "Save campaign" }));
    await waitFor(() =>
      expect(updateCampaign).toHaveBeenCalledWith(
        "campaign-1",
        expect.objectContaining({ name: "Updated name" }),
      ),
    );
    expect(navigation.campaign).toHaveBeenCalledWith("campaign-1");
  });
});
