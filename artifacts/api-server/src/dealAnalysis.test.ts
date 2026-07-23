import { afterEach, describe, expect, it, vi } from "vitest";
import type { DealRiskFlag } from "@vvl/shared";

import { analyzeDeal, computeDealRobustness, labelDeal, ROBUSTNESS_DRAWS } from "./dealAnalysis";
import { buildDemoDealAnalyze, buildDemoEstimate } from "./demo";
import { buildPublicDealAnalyze } from "./publicEngine";

const noRisk: DealRiskFlag[] = [{ level: "info", label: "Rule-based", detail: "Planning note" }];
const dangerRisk: DealRiskFlag[] = [{ level: "danger", label: "No modeled upside", detail: "Asking price is too high" }];
const warningRisk: DealRiskFlag[] = [{ level: "warning", label: "Wide range", detail: "Review comparables" }];

describe("labelDeal", () => {
  it("keeps a high-upside clean deal at review until the cost-complete G3 gate", () => {
    expect(labelDeal(0.1, 0.01, noRisk)).toBe("Worth review");
  });

  it("keeps moderate upside in review instead of overselling it", () => {
    expect(labelDeal(0.045, -0.01, noRisk)).toBe("Worth review");
  });

  it("keeps a material warning in review", () => {
    expect(labelDeal(0.12, 0.05, warningRisk)).toBe("Worth review");
  });

  it("passes when the after-plan value is below asking price", () => {
    expect(labelDeal(-0.01, -0.08, dangerRisk)).toBe("Pass for now");
  });

  it("keeps a high-margin deal at needs caution when a danger flag remains", () => {
    expect(labelDeal(0.2, 0.1, dangerRisk)).toBe("Needs caution");
  });
});

const robustnessInputs = {
  askingPrice: 1_000_000,
  baseValue: 1_050_000,
  confidenceLow: 950_000,
  confidenceHigh: 1_150_000,
  afterPlanValue: 1_120_000,
  targetPrice: 1_134_000,
};

describe("computeDealRobustness", () => {
  it("is deterministic: identical inputs return identical robustness", () => {
    const first = computeDealRobustness(robustnessInputs);
    const second = computeDealRobustness(robustnessInputs);

    expect(first).toEqual(second);
    expect(first.method).toBe("seeded-triangular-stress-test");
    expect(first.draws).toBe(ROBUSTNESS_DRAWS);
    expect(first.note).toContain("net of planned renovation spend");
  });

  it("returns a null targetAchievableShare when no target price was given", () => {
    expect(computeDealRobustness({ ...robustnessInputs, targetPrice: null }).targetAchievableShare).toBeNull();
    expect(computeDealRobustness({ ...robustnessInputs, targetPrice: undefined }).targetAchievableShare).toBeNull();
  });

  it("collapses to the point upside when the estimate band is degenerate (low = base = high)", () => {
    const robustness = computeDealRobustness({
      ...robustnessInputs,
      confidenceLow: 1_050_000,
      confidenceHigh: 1_050_000,
    });
    // Every draw equals afterPlanValue - askingPrice = 120,000 exactly.
    expect(robustness.upsideP10).toBe(120_000);
    expect(robustness.upsideP50).toBe(120_000);
    expect(robustness.upsideP90).toBe(120_000);
    expect(robustness.positiveUpsideShare).toBe(1);
  });

  it("keeps scenario shares in [0, 1] and percentiles ordered", () => {
    const robustness = computeDealRobustness(robustnessInputs);

    expect(robustness.positiveUpsideShare).toBeGreaterThanOrEqual(0);
    expect(robustness.positiveUpsideShare).toBeLessThanOrEqual(1);
    expect(robustness.targetAchievableShare).not.toBeNull();
    expect(robustness.targetAchievableShare ?? 0).toBeGreaterThanOrEqual(0);
    expect(robustness.targetAchievableShare ?? 0).toBeLessThanOrEqual(1);
    expect(robustness.upsideP10).toBeLessThanOrEqual(robustness.upsideP50);
    expect(robustness.upsideP50).toBeLessThanOrEqual(robustness.upsideP90);
  });

  it("reports degenerate scenario shares exactly at the bounds", () => {
    const certainLoss = computeDealRobustness({ ...robustnessInputs, askingPrice: 2_000_000, targetPrice: 3_000_000 });
    expect(certainLoss.positiveUpsideShare).toBe(0);
    expect(certainLoss.targetAchievableShare).toBe(0);

    const certainWin = computeDealRobustness({ ...robustnessInputs, askingPrice: 500_000, targetPrice: 900_000 });
    expect(certainWin.positiveUpsideShare).toBe(1);
    expect(certainWin.targetAchievableShare).toBe(1);
  });

  it("widens the upside spread when an observed uplift band is provided, never inventing one otherwise", () => {
    const zeroWidth = computeDealRobustness(robustnessInputs);
    const withBand = computeDealRobustness({ ...robustnessInputs, upliftConfidenceLow: 20_000, upliftConfidenceHigh: 130_000 });

    expect(withBand.upsideP90 - withBand.upsideP10).toBeGreaterThan(zeroWidth.upsideP90 - zeroWidth.upsideP10);
  });

  it("deducts planned renovation spend from every upside draw", () => {
    const beforeCost = computeDealRobustness(robustnessInputs);
    const afterCost = computeDealRobustness({ ...robustnessInputs, plannedSpend: 65_000 });

    expect(afterCost.upsideP10).toBe(beforeCost.upsideP10 - 65_000);
    expect(afterCost.upsideP50).toBe(beforeCost.upsideP50 - 65_000);
    expect(afterCost.upsideP90).toBe(beforeCost.upsideP90 - 65_000);
    expect(afterCost.positiveUpsideShare).toBeLessThan(beforeCost.positiveUpsideShare);
  });
});

describe("robustness in the deal analyze modes", () => {
  const dealRequest = {
    postalCode: "V5T 3K4",
    propertyType: "Townhouse" as const,
    livingAreaSqft: 1_320,
    bedrooms: 3,
    bathrooms: 2,
    yearBuilt: 1998,
    askingPrice: 1_275_000,
    budget: 95_000,
    timelineMonths: 10,
    plannedFlags: ["renovatedKitchen" as const],
  };

  it("public mode: two identical requests return identical robustness", async () => {
    const first = await buildPublicDealAnalyze(dealRequest);
    const second = await buildPublicDealAnalyze(dealRequest);

    expect(first.robustness).toBeDefined();
    expect(first.robustness).toEqual(second.robustness);
    expect(first.robustness).toEqual(
      computeDealRobustness({
        askingPrice: dealRequest.askingPrice,
        baseValue: first.estimate.baseValue,
        confidenceLow: first.estimate.confidenceLow,
        confidenceHigh: first.estimate.confidenceHigh,
        afterPlanValue: first.afterPlanValue,
        targetPrice: first.plan.targetPrice ?? null,
        upliftConfidenceLow: first.plan.upliftConfidenceLow,
        upliftConfidenceHigh: first.plan.upliftConfidenceHigh,
        plannedSpend: first.plan.plannedSpend,
      }),
    );
  });

  it("demo mode: attaches robustness derived from the sample estimate band", () => {
    const deal = buildDemoDealAnalyze(dealRequest);

    expect(deal.robustness).toBeDefined();
    expect(deal.robustness?.draws).toBe(ROBUSTNESS_DRAWS);
    expect(deal.robustness?.positiveUpsideShare).toBeGreaterThanOrEqual(0);
    expect(deal.robustness?.positiveUpsideShare).toBeLessThanOrEqual(1);
  });

  describe("live mode wiring", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
      vi.restoreAllMocks();
    });

    it("attaches robustness computed from the model-service estimate and plan", async () => {
      const { provenance: _demoProvenance, ...demoEstimate } = buildDemoEstimate(dealRequest);
      const estimateFixture = {
        ...demoEstimate,
        baseValue: 1_300_000,
        confidenceLow: 1_170_000,
        confidenceHigh: 1_430_000,
        anchorValue: 1_300_000,
        confidenceRatio: 0.1,
        marketContext: { ...demoEstimate.marketContext, practicalCeiling: 1_700_000 },
      };
      const simulateFixture = {
        status: "ready",
        baseValue: 1_300_000,
        upliftPercent: 0.05,
        upliftValue: 65_000,
        finalValueRaw: 1_365_000,
        finalValueGuardrailed: 1_365_000,
        evidenceLevel: "observed",
      };
      globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
        const target = String(url);
        const payload = target.endsWith("/estimate") ? estimateFixture : simulateFixture;
        return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
      }) as typeof fetch;

      const deal = await analyzeDeal(dealRequest);

      expect(deal.robustness).toEqual(
        computeDealRobustness({
          askingPrice: dealRequest.askingPrice,
          baseValue: estimateFixture.baseValue,
          confidenceLow: estimateFixture.confidenceLow,
          confidenceHigh: estimateFixture.confidenceHigh,
          afterPlanValue: deal.afterPlanValue,
          targetPrice: deal.plan.targetPrice ?? null,
          upliftConfidenceLow: deal.plan.upliftConfidenceLow,
          upliftConfidenceHigh: deal.plan.upliftConfidenceHigh,
          plannedSpend: deal.plan.plannedSpend,
        }),
      );
    });
  });
});
