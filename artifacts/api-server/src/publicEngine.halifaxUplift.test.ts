import { afterEach, describe, expect, it, vi } from "vitest";

import type { HalifaxUpliftFile } from "./halifaxUplift";

// Fixture follows the data/exports/halifax_uplift.json contract exactly: percentages are fractions,
// Renovation is ready, Addition lacks the 100 treated pairs and must contribute 0.
const upliftFixture: HalifaxUpliftFile = {
  generatedAt: "2026-06-08T00:00:00+00:00",
  source: "PVSC Parcel Sales History repeat-sale pairs joined to HRM geolocated building permits (<= 30 m)",
  method:
    "Repeat-sale pairs were time-adjusted to the baseline month, treated parcels matched to permits within 30 m, and excess uplift compared against matched control pairs; thin categories are reported as insufficient-data.",
  baselineMonth: "2026-04",
  minTreatedPairs: 100,
  categories: {
    Renovation: {
      status: "ready",
      treatedPairs: 240,
      controlPairs: 960,
      medianExcessUpliftPercent: 0.12,
      p25ExcessUpliftPercent: 0.05,
      p75ExcessUpliftPercent: 0.21,
      medianPermitValue: 48_000,
      note: "240 treated repeat-sale pairs within 30 m of a renovation permit.",
    },
    Addition: {
      status: "insufficient-data",
      treatedPairs: 14,
      controlPairs: 70,
      medianExcessUpliftPercent: null,
      p25ExcessUpliftPercent: null,
      p75ExcessUpliftPercent: null,
      medianPermitValue: null,
      note: "Only 14 treated pairs, below the 100-pair minimum, so no uplift is reported.",
    },
  },
  flagCategoryMap: {
    renovatedKitchen: "Renovation",
    renovatedBathrooms: "Renovation",
    energyEfficient: "Renovation",
    deferredMaintenanceResolved: "Renovation",
    roofIssueResolved: "Renovation",
    legalSuiteAdded: "Addition",
  },
};

const halifaxProperty = {
  postalCode: "B3H 1A1",
  propertyType: "Detached" as const,
  livingAreaSqft: 2_000,
  bedrooms: 4,
  bathrooms: 2.5,
  yearBuilt: new Date().getFullYear() - 40,
};

async function importPublicEngineWithUplift(file: HalifaxUpliftFile | null) {
  vi.resetModules();
  vi.doMock("./halifaxUplift", async () => {
    const actual = await vi.importActual<typeof import("./halifaxUplift")>("./halifaxUplift");
    return { ...actual, loadHalifaxUplift: () => file };
  });
  return import("./publicEngine");
}

afterEach(() => {
  vi.doUnmock("./halifaxUplift");
  vi.resetModules();
});

describe("Halifax public simulate with the local uplift export", () => {
  it("sums observed medians once per distinct category and zeroes insufficient ones", async () => {
    const { buildPublicSimulate } = await importPublicEngineWithUplift(upliftFixture);

    const response = buildPublicSimulate({
      ...halifaxProperty,
      // Two Renovation flags plus one Addition flag: Renovation must count once, Addition contributes 0.
      plannedFlags: ["renovatedKitchen", "renovatedBathrooms", "legalSuiteAdded"],
    });

    expect(response.status).toBe("ready");
    expect(response.modelVersion).toBe("public-halifax-observed-uplift-v1");
    expect(response.upliftPercent).toBe(0.12);
    expect(response.upliftPercentConfidenceLow).toBe(0.05);
    expect(response.upliftPercentConfidenceHigh).toBe(0.21);

    const baseValue = response.baseValue ?? 0;
    expect(baseValue).toBeGreaterThan(0);
    expect(response.upliftValue).toBe(Math.round(baseValue * 0.12));
    expect(response.upliftConfidenceLow).toBe(Math.round(baseValue * 0.05));
    expect(response.upliftConfidenceHigh).toBe(Math.round(baseValue * 0.21));

    expect(response.dataSources?.halifaxUplift).toBe("data/exports/halifax_uplift.json");
    expect(response.dataSources?.evidence).toBe("data/exports/market_evidence.json");
    expect(response.rowCounts?.renovationTreatedPairs).toBe(240);
    expect(response.rowCounts?.renovationControlPairs).toBe(960);
    expect(response.rowCounts?.additionTreatedPairs).toBe(14);
    expect(response.methodNotes?.join(" ")).toContain("Only 14 treated pairs");
    expect(response.observedShare).toBe(0.5);

    const drivers = response.topUpliftDrivers ?? [];
    expect(drivers).toHaveLength(2);
    const renovation = drivers.find((driver) => driver.label.includes("Renovation"));
    const addition = drivers.find((driver) => driver.label.includes("Addition"));
    expect(renovation?.value).toBe(Math.round(baseValue * 0.12));
    expect(renovation?.upliftPercent).toBe(0.12);
    expect(addition?.value).toBe(0);
    expect(addition?.upliftPercent).toBe(0);
    expect(addition?.rationale).toContain("Only 14 treated pairs");
  });

  it("reports zero uplift with the observed band when only an insufficient category is selected", async () => {
    const { buildPublicSimulate } = await importPublicEngineWithUplift(upliftFixture);

    const response = buildPublicSimulate({ ...halifaxProperty, plannedFlags: ["legalSuiteAdded"] });

    expect(response.modelVersion).toBe("public-halifax-observed-uplift-v1");
    expect(response.upliftPercent).toBe(0);
    expect(response.upliftValue).toBe(0);
    expect(response.finalValueGuardrailed).toBe(response.baseValue);
    expect(response.observedShare).toBe(0);
  });

  it("keeps the generic Halifax behavior unchanged when the export is absent", async () => {
    const { buildPublicEstimate, buildPublicSimulate } = await importPublicEngineWithUplift(null);

    const response = buildPublicSimulate({ ...halifaxProperty, plannedFlags: ["renovatedKitchen"] });
    const estimate = buildPublicEstimate(halifaxProperty);

    expect(response.modelVersion).toBe("public-uplift-screening-v1");
    expect(response.dataSources?.halifaxUplift).toBeUndefined();
    // Generic Detached kitchen rate is 0.045 with no stacking discount for the first item.
    const expectedUplift = Math.round((estimate.baseValue * 0.045) / 1_000) * 1_000;
    expect(response.upliftValue).toBe(expectedUplift);
    expect(response.upliftPercentConfidenceHigh).toBeCloseTo((response.upliftPercent ?? 0) + 0.025, 10);
  });

  it("keeps the generic path when the export exists but no category is ready", async () => {
    const allInsufficient: HalifaxUpliftFile = {
      ...upliftFixture,
      categories: {
        Renovation: { ...upliftFixture.categories.Renovation, status: "insufficient-data", medianExcessUpliftPercent: null, p25ExcessUpliftPercent: null, p75ExcessUpliftPercent: null },
        Addition: upliftFixture.categories.Addition,
      },
    };
    const { buildPublicSimulate } = await importPublicEngineWithUplift(allInsufficient);

    const response = buildPublicSimulate({ ...halifaxProperty, plannedFlags: ["renovatedKitchen"] });

    expect(response.modelVersion).toBe("public-uplift-screening-v1");
    expect(response.dataSources?.halifaxUplift).toBeUndefined();
  });

  it("leaves the Vancouver simulate path untouched even when the export is loaded", async () => {
    const { buildPublicSimulate } = await importPublicEngineWithUplift(upliftFixture);

    const response = buildPublicSimulate({
      postalCode: "V6B 1X9",
      propertyType: "Condo",
      livingAreaSqft: 708,
      bedrooms: 1,
      bathrooms: 1,
      yearBuilt: 2012,
      plannedFlags: ["renovatedKitchen"],
    });

    expect(response.modelVersion).toBe("public-uplift-screening-v1");
    expect(response.dataSources?.halifaxUplift).toBeUndefined();
    expect(response.dataSources?.modelSummary).toBe("reports/model_metrics_report.md");
  });
});

describe("halifax uplift loader", () => {
  it("parses a contract-valid export through the repo-file loader", async () => {
    vi.resetModules();
    vi.doMock("./repoFiles", () => ({
      findRepoRoot: () => "/nonexistent",
      readRepoJson: () => upliftFixture,
    }));
    const { loadHalifaxUplift, hasReadyUpliftCategory } = await import("./halifaxUplift");

    const file = loadHalifaxUplift();

    expect(file).not.toBeNull();
    expect(file?.minTreatedPairs).toBe(100);
    expect(hasReadyUpliftCategory(file as HalifaxUpliftFile)).toBe(true);

    vi.doUnmock("./repoFiles");
    vi.resetModules();
  });

  it("returns null when the export is missing so the generic path stays active", async () => {
    vi.resetModules();
    vi.doMock("./repoFiles", () => ({
      findRepoRoot: () => "/nonexistent",
      readRepoJson: () => {
        throw new Error("ENOENT: halifax_uplift.json is missing");
      },
    }));
    const { loadHalifaxUplift } = await import("./halifaxUplift");

    expect(loadHalifaxUplift()).toBeNull();

    vi.doUnmock("./repoFiles");
    vi.resetModules();
  });
});
