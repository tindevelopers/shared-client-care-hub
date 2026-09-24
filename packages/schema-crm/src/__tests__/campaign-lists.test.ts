import { describe, expect, it } from "vitest";
import {
  campaignListInsertSchema,
  campaignListRowSchema,
  campaignListSourceTypeSchema,
  campaignListStatusSchema,
  campaignListUpdateSchema,
} from "../campaign-lists";

const NOW = "2026-09-24T10:00:00.000+00:00";

/** Ground-truth fixture: campaign_lists effective DDL (11 columns, 20260210000000). */
const campaignListFixture = {
  id: "9a1b2c3d-0000-4000-8000-000000000070",
  tenant_id: "9a1b2c3d-0000-4000-8000-000000000010",
  campaign_id: "9a1b2c3d-0000-4000-8000-000000000080",
  name: "Q3 prospects",
  source_type: "csv",
  source_config: { delimiter: "," },
  field_mapping: { phone: "Phone Number" },
  total_records: 500,
  imported_records: 480,
  status: "completed",
  last_synced_at: NOW,
  created_at: NOW,
};

describe("campaign_lists", () => {
  it("campaign_lists row round-trip (11 columns)", () => {
    expect(Object.keys(campaignListRowSchema.shape).sort()).toEqual(
      [
        "campaign_id",
        "created_at",
        "field_mapping",
        "id",
        "imported_records",
        "last_synced_at",
        "name",
        "source_config",
        "source_type",
        "status",
        "tenant_id",
        "total_records",
      ].sort(),
    );
    const parsed = campaignListRowSchema.parse(campaignListFixture);
    expect(parsed).toEqual(campaignListFixture);
  });

  it("source_type is NOT NULL; status is nullable", () => {
    expect(
      campaignListRowSchema.safeParse({ ...campaignListFixture, source_type: null }).success,
    ).toBe(false);
    expect(campaignListRowSchema.safeParse({ ...campaignListFixture, status: null }).success).toBe(
      true,
    );
  });

  it("source_type enum covers the eight CHECK values", () => {
    for (const value of [
      "csv",
      "excel",
      "google_sheets",
      "airtable",
      "gohighlevel",
      "hubspot",
      "salesforce",
      "pipedrive",
    ]) {
      expect(campaignListSourceTypeSchema.safeParse(value).success).toBe(true);
    }
    expect(campaignListSourceTypeSchema.safeParse("zoho").success).toBe(false);
  });

  it("status enum covers the four CHECK values", () => {
    for (const value of ["pending", "importing", "completed", "failed"]) {
      expect(campaignListStatusSchema.safeParse(value).success).toBe(true);
    }
    expect(campaignListStatusSchema.safeParse("cancelled").success).toBe(false);
  });

  it("insert requires tenant_id/campaign_id/name/source_type", () => {
    expect(
      campaignListInsertSchema.safeParse({
        tenant_id: campaignListFixture.tenant_id,
        campaign_id: campaignListFixture.campaign_id,
        name: "Q3 prospects",
        source_type: "csv",
      }).success,
    ).toBe(true);
    for (const required of ["tenant_id", "campaign_id", "name", "source_type"]) {
      const payload: Record<string, unknown> = {
        tenant_id: campaignListFixture.tenant_id,
        campaign_id: campaignListFixture.campaign_id,
        name: "Q3 prospects",
        source_type: "csv",
      };
      delete payload[required];
      expect(campaignListInsertSchema.safeParse(payload).success).toBe(false);
    }
  });

  it("update accepts partial patches and rejects unknown keys", () => {
    expect(campaignListUpdateSchema.safeParse({ status: "importing" }).success).toBe(true);
    expect(campaignListUpdateSchema.safeParse({ archived: true }).success).toBe(false);
  });
});
