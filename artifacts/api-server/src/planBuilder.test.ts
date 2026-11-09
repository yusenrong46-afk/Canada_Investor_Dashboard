import { describe, expect, it, vi } from "vitest";

import { resultProvenance, type EstimateResponse, type SimulateResponse } from "@vvl/shared";

import { computeDealRobustness } from "./dealRobustness";
import { buildPlan } from "./planBuilder";

const baseEstimate: EstimateResponse = {
  provenance: resultProvenance({
    engineType: "rules",
    evidenceLevel: "assumption",
    validationStatus: "unvalidated",
    version: "test",
    dataAsOf: null,
    sourceIds: [],
    limitations: [],
  }),
  modelVersion: "test",
  trainingMode: "public-interactive-estimator",
  modelFamily: "rules",
  modelScope: "Condo",
  market: "vancouver",
  marketLabel: "Vancouver",
  baseValue: 800_000,
  confidenceLow: 720_000,
  confidenceHigh: 880_000,
  anchorValue: 800_000,
  pricePerSqft: 1_000,
  confidenceRatio: 0.1,
  modelQuality: {
    trainingRows: 0,
    cvMae: null,
    cvMape: null,
    cvR2: null,
    holdoutMae: null,
    holdoutMape: null,
    holdoutR2: null,
    outlierRemovedRate: null,
    validationSummary: {
      trainHoldoutSplit: "n/a",
      crossValidation: "n/a",
      bootstrap: "n/a",
      bootstrapRanges: {
        mae: { mean: null, p05: null, p50: null, p95: null },
        mape: { mean: null, p05: null, p50: null, p95: null },
        r2: { mean: null, p05: null, p50: null, p95: null },
      },
      missingnessNotes: [],
      locationFeatures: "n/a",
      clusterCount: 0,
    },
  },
  drivers: [],
  marketContext: {
    localAreaLabel: "Test",
    localAreaScope: "fsa",
    localMedianValue: 780_000,
    localMedianPricePerSqft: 1_000,
    cityMedianValue: 780_000,
    cityMedianPricePerSqft: 1_000,
    vancouverMedianValue: 780_000,
    vancouverMedianPricePerSqft: 1_000,
    percentileRank: 50,
    practicalCeiling: 960_000,
    premiumGap: 20_000,
    comparableCount: 30,
  },
  uncertainty: { method: "error-ratio", calibrationNote: "test" },
  explanationMethod: "heuristic",
  marketFreshness: { status: "not-applied", message: "test" },
};

function readySimulate(upliftValue: number): SimulateResponse {
  return {
    provenance: baseEstimate.provenance,
    status: "ready",
    message: "ready",
    baseValue: baseEstimate.baseValue,
    upliftPercent: upliftValue / baseEstimate.baseValue,
    upliftValue,
    finalValueRaw: baseEstimate.baseValue + upliftValue,
    finalValueGuardrailed: baseEstimate.baseValue + upliftValue,
    treatedQuantileRange: {
      lowPercent: Math.max(0, upliftValue - 10_000) / baseEstimate.baseValue,
      highPercent: (upliftValue + 10_000) / baseEstimate.baseValue,
      lowValue: Math.max(0, upliftValue - 10_000),
      highValue: upliftValue + 10_000,
    },
    plannedFlags: [],
  };
}

describe("buildPlan", () => {
  it("emits a budget overflow note when committed scope exceeds the budget", async () => {
    const simulate = vi.fn(async (request) => {
      const flags = request.plannedFlags ?? [];
      const uplift = flags.includes("renovatedKitchen") ? 40_000 : flags.includes("legalSuiteAdded") ? 20_000 : 0;
      return readySimulate(uplift);
    });

    const plan = await buildPlan({
      request: {
        postalCode: "V6B 1X9",
        propertyType: "Condo",
        livingAreaSqft: 708,
        bedrooms: 1,
        bathrooms: 1,
        plannedFlags: ["renovatedKitchen", "legalSuiteAdded"],
        targetPrice: 900_000,
        budget: 50_000,
        timelineMonths: 12,
      },
      estimate: baseEstimate,
      simulate,
      dataSources: {},
      provenance: { engineType: "rules", version: "test-plan", sourceIds: [], limitations: [] },
      message: "test plan",
    });

    expect(plan.status).toBe("ready");
    expect(plan.methodNotes?.some((note) => note.includes("above the 50,000 dollar budget"))).toBe(true);
  });

  it("skips zero-uplift recommended candidates", async () => {
    const simulate = vi.fn(async (request) => {
      const flags = request.plannedFlags ?? [];
      const uplift = flags.includes("renovatedKitchen") ? 30_000 : 0;
      return readySimulate(uplift);
    });

    const plan = await buildPlan({
      request: {
        postalCode: "V6B 1X9",
        propertyType: "Condo",
        livingAreaSqft: 708,
        bedrooms: 1,
        bathrooms: 1,
        plannedFlags: ["renovatedKitchen"],
        targetPrice: 900_000,
        budget: 200_000,
        timelineMonths: 12,
      },
      estimate: baseEstimate,
      simulate,
      dataSources: {},
      provenance: { engineType: "rules", version: "test-plan", sourceIds: [], limitations: [] },
      message: "test plan",
    });

    expect(plan.status).toBe("ready");
    expect(plan.items?.every((item) => item.projectedUplift > 0 || item.origin === "committed")).toBe(true);
    expect(plan.items?.filter((item) => item.origin === "recommended").every((item) => item.projectedUplift > 0)).toBe(true);
  });

  it("uses horizonMonths in simulate requests and reconciles achievableValue to the final combined simulation", async () => {
    const simulate = vi.fn(async (request) => {
      const flags = request.plannedFlags ?? [];
      const horizon = request.horizonMonths ?? 12;
      const uplift = flags.includes("renovatedKitchen") ? 30_000 + (18 - horizon) * 1_000 : 0;
      return readySimulate(uplift);
    });

    const plan = await buildPlan({
      request: {
        postalCode: "V6B 1X9",
        propertyType: "Condo",
        livingAreaSqft: 708,
        bedrooms: 1,
        bathrooms: 1,
        plannedFlags: ["renovatedKitchen"],
        targetPrice: 900_000,
        budget: 200_000,
        timelineMonths: 6,
      },
      estimate: baseEstimate,
      simulate,
      dataSources: {},
      provenance: { engineType: "rules", version: "test-plan", sourceIds: [], limitations: [] },
      message: "test plan",
    });

    expect(plan.status).toBe("ready");
    expect(simulate.mock.calls.some((call) => call[0].horizonMonths === 6)).toBe(true);
    expect(plan.achievableValue).toBe(842_000);
  });

  it("returns data-missing when the baseline simulate is not ready", async () => {
    const plan = await buildPlan({
      request: {
        postalCode: "V6B 1X9",
        propertyType: "Condo",
        livingAreaSqft: 708,
        bedrooms: 1,
        bathrooms: 1,
        plannedFlags: [],
        targetPrice: 900_000,
        budget: 50_000,
        timelineMonths: 12,
      },
      estimate: baseEstimate,
      simulate: async () => ({
        provenance: baseEstimate.provenance,
        status: "data-missing",
        message: "uplift unavailable",
      }),
      dataSources: {},
      provenance: { engineType: "rules", version: "test-plan", sourceIds: [], limitations: [] },
      message: "test plan",
    });

    expect(plan.status).toBe("data-missing");
    expect(plan.message).toContain("uplift unavailable");
  });

  it("reports no uplift band when nothing is planned, so the stress test cannot invent upside", async () => {
    // The simulator still returns a non-zero band for the empty scenario, as the public engine does.
    const simulate = vi.fn(async () => readySimulate(0));

    const plan = await buildPlan({
      request: {
        postalCode: "V6B 1X9",
        propertyType: "Condo",
        livingAreaSqft: 708,
        bedrooms: 1,
        bathrooms: 1,
        plannedFlags: [],
        targetPrice: 900_000,
        budget: 1, // too small for any candidate
        timelineMonths: 12,
      },
      estimate: baseEstimate,
      simulate,
      dataSources: {},
      provenance: { engineType: "rules", version: "test-plan", sourceIds: [], limitations: [] },
      message: "test plan",
    });

    expect(plan.status).toBe("ready");
    expect(plan.items).toEqual([]);
    expect(plan.upliftConfidenceLow).toBeUndefined();
    expect(plan.upliftConfidenceHigh).toBeUndefined();

    // Buying at the point estimate and doing nothing must centre on zero upside, not skew positive.
    const robustness = computeDealRobustness({
      askingPrice: baseEstimate.baseValue,
      baseValue: baseEstimate.baseValue,
      confidenceLow: baseEstimate.confidenceLow,
      confidenceHigh: baseEstimate.confidenceHigh,
      afterPlanValue: plan.achievableValue ?? baseEstimate.baseValue,
      upliftConfidenceLow: plan.upliftConfidenceLow,
      upliftConfidenceHigh: plan.upliftConfidenceHigh,
      plannedSpend: plan.plannedSpend,
    });
    // Seeded draws give P50 ~ +700 here; the old stray 0-10k band pushed it to ~+4,000.
    expect(Math.abs(robustness.upsideP50)).toBeLessThan(2_000);
  });

  it("evaluates each round's candidates concurrently but picks deterministically", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const simulate = vi.fn(async (request) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      const flags: string[] = request.plannedFlags ?? [];
      return readySimulate(flags.length * 15_000);
    });
    const request = {
      postalCode: "V6B 1X9",
      propertyType: "Condo" as const,
      livingAreaSqft: 708,
      bedrooms: 1,
      bathrooms: 1,
      plannedFlags: [],
      targetPrice: 900_000,
      budget: 200_000,
      timelineMonths: 18,
    };
    const options = {
      estimate: baseEstimate,
      simulate,
      dataSources: {},
      provenance: { engineType: "rules" as const, version: "test-plan", sourceIds: [], limitations: [] },
      message: "test plan",
    };

    const first = await buildPlan({ request, ...options });
    const second = await buildPlan({ request, ...options });

    expect(maxInFlight).toBeGreaterThan(1);
    expect(first.items?.map((item) => item.flag)).toEqual(second.items?.map((item) => item.flag));
  });
});
