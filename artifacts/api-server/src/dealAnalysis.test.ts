import { afterEach, describe, expect, it, vi } from "vitest";
import type { DealRiskFlag } from "@vvl/shared";

import { analyzeDeal, computeDealRobustness, labelDeal, ROBUSTNESS_DRAWS } from "./dealAnalysis";
import { buildDemoDealAnalyze } from "./demo";
import { buildPublicDealAnalyze } from "./publicEngine";

const noRisk: DealRiskFlag[] = [{ level: "info", label: "Rule-based", detail: "Planning note" }];
const dangerRisk: DealRiskFlag[] = [{ level: "danger", label: "No modeled upside", detail: "Asking price is too high" }];

describe("labelDeal", () => {
  it("marks a high-upside clean deal as a strong lead", () => {
    expect(labelDeal(0.1, 0.01, noRisk)).toBe("Strong lead");
  });

  it("keeps moderate upside in review instead of overselling it", () => {
    expect(labelDeal(0.045, -0.01, noRisk)).toBe("Worth review");
  });

  it("passes when the after-plan value is below asking price", () => {
    expect(labelDeal(-0.01, -0.08, dangerRisk)).toBe("Pass for now");
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
    expect(first.method).toBe("monte-carlo-triangular");
    expect(first.draws).toBe(ROBUSTNESS_DRAWS);
    expect(first.note).toBe("Triangular Monte Carlo over the calibrated estimate band and observed uplift range; 5,000 draws (seeded).");
  });

  it("returns a null probTargetAchievable when no target price was given", () => {
    expect(computeDealRobustness({ ...robustnessInputs, targetPrice: null }).probTargetAchievable).toBeNull();
    expect(computeDealRobustness({ ...robustnessInputs, targetPrice: undefined }).probTargetAchievable).toBeNull();
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
    expect(robustness.probPositiveUpside).toBe(1);
  });

  it("keeps probabilities in [0, 1] and percentiles ordered", () => {
    const robustness = computeDealRobustness(robustnessInputs);

    expect(robustness.probPositiveUpside).toBeGreaterThanOrEqual(0);
    expect(robustness.probPositiveUpside).toBeLessThanOrEqual(1);
    expect(robustness.probTargetAchievable).not.toBeNull();
    expect(robustness.probTargetAchievable ?? 0).toBeGreaterThanOrEqual(0);
    expect(robustness.probTargetAchievable ?? 0).toBeLessThanOrEqual(1);
    expect(robustness.upsideP10).toBeLessThanOrEqual(robustness.upsideP50);
    expect(robustness.upsideP50).toBeLessThanOrEqual(robustness.upsideP90);
  });

  it("reports certain outcomes exactly at the probability bounds", () => {
    const certainLoss = computeDealRobustness({ ...robustnessInputs, askingPrice: 2_000_000, targetPrice: 3_000_000 });
    expect(certainLoss.probPositiveUpside).toBe(0);
    expect(certainLoss.probTargetAchievable).toBe(0);

    const certainWin = computeDealRobustness({ ...robustnessInputs, askingPrice: 500_000, targetPrice: 900_000 });
    expect(certainWin.probPositiveUpside).toBe(1);
    expect(certainWin.probTargetAchievable).toBe(1);
  });

  it("widens the upside spread when an observed uplift band is provided, never inventing one otherwise", () => {
    const zeroWidth = computeDealRobustness(robustnessInputs);
    const withBand = computeDealRobustness({ ...robustnessInputs, upliftConfidenceLow: 20_000, upliftConfidenceHigh: 130_000 });

    expect(withBand.upsideP90 - withBand.upsideP10).toBeGreaterThan(zeroWidth.upsideP90 - zeroWidth.upsideP10);
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

  it("public mode: two identical requests return identical robustness", () => {
    const first = buildPublicDealAnalyze(dealRequest);
    const second = buildPublicDealAnalyze(dealRequest);

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
      }),
    );
  });

  it("demo mode: attaches robustness derived from the sample estimate band", () => {
    const deal = buildDemoDealAnalyze(dealRequest);

    expect(deal.robustness).toBeDefined();
    expect(deal.robustness?.draws).toBe(ROBUSTNESS_DRAWS);
    expect(deal.robustness?.probPositiveUpside).toBeGreaterThanOrEqual(0);
    expect(deal.robustness?.probPositiveUpside).toBeLessThanOrEqual(1);
  });

  describe("live mode wiring", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
      vi.restoreAllMocks();
    });

    it("attaches robustness computed from the model-service estimate and plan", async () => {
      const estimateFixture = {
        baseValue: 1_300_000,
        confidenceLow: 1_170_000,
        confidenceHigh: 1_430_000,
        confidenceRatio: 0.1,
        marketContext: { practicalCeiling: 1_700_000 },
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
        }),
      );
    });
  });
});
