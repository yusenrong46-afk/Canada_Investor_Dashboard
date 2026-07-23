import { WIDE_CONFIDENCE_RATIO, type DealAnalyzeRequest, type DealAnalyzeResponse, type DealLabel, type DealRiskFlag, type EstimateResponse, type PlanResponse } from "@vvl/shared";

import { buildDealAnalyze, computeDealTargetPrice } from "./dealBuilder";
export { computeDealRobustness, ROBUSTNESS_DRAWS } from "./dealRobustness";
export type { DealRobustnessInputs } from "./dealRobustness";
import { buildSalePlan, estimateProperty } from "./model";

function percent(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

function buildRiskFlags(
  request: DealAnalyzeRequest,
  estimate: EstimateResponse,
  plan: PlanResponse,
  afterPlanValue: number,
  netUpsidePercent: number,
): DealRiskFlag[] {
  const flags: DealRiskFlag[] = [];
  const askingPremium = percent(request.askingPrice - estimate.baseValue, estimate.baseValue);

  if (askingPremium > 0.05) {
    flags.push({
      level: "danger",
      label: "Asking price is above model value",
      detail: "The listing asks more than 5% above the as-is model estimate before renovation upside.",
    });
  } else if (askingPremium > 0) {
    flags.push({
      level: "warning",
      label: "Small premium to model value",
      detail: "The property is priced slightly above the as-is model estimate, so the thesis depends more on execution.",
    });
  } else {
    flags.push({
      level: "info",
      label: "Price is at or below model value",
      detail: "The as-is model estimate supports the asking price before considering any renovation plan.",
    });
  }

  if (netUpsidePercent < 0) {
    flags.push({
      level: "danger",
      label: "No modeled net upside after renovation cost",
      detail: "The guardrailed after-plan value does not cover the asking price plus planned renovation spend.",
    });
  } else if (netUpsidePercent < 0.04) {
    flags.push({
      level: "warning",
      label: "Thin net upside",
      detail: "The modeled margin after renovation spend is under 4%, before transaction costs, financing, taxes, or surprises.",
    });
  }

  if ((plan.plannedSpend ?? 0) > request.budget) {
    flags.push({
      level: "danger",
      label: "Committed scope exceeds the renovation budget",
      detail: `Selected work is costed at ${(plan.plannedSpend ?? 0).toLocaleString("en-CA")} dollars against an ${request.budget.toLocaleString("en-CA")} dollar budget.`,
    });
  }

  if (plan.targetAssessment === "Below target") {
    flags.push({
      level: "warning",
      label: "Target looks difficult",
      detail: "The observed-evidence uplift plan does not appear to reach the target price inside the current budget and timeline.",
    });
  }

  if (afterPlanValue >= estimate.marketContext.practicalCeiling * 0.98) {
    flags.push({
      level: "warning",
      label: "Close to local ceiling",
      detail: "The modeled resale value is near the local practical ceiling, so over-improvement risk is higher.",
    });
  }

  if (estimate.confidenceRatio >= WIDE_CONFIDENCE_RATIO) {
    flags.push({
      level: "warning",
      label: "Wide model confidence range",
      detail: "The base estimate has a wider confidence band, so this deal deserves stronger comparable-sale review.",
    });
  }

  if (plan.upliftConfidenceLow != null && plan.upliftConfidenceLow <= 0 && (plan.plannedSpend ?? 0) > 0) {
    flags.push({
      level: "warning",
      label: "Observed renovation range includes no uplift",
      detail: "The lower observed renovation outcome is zero or negative. Treat the point estimate as a screening median, not a guaranteed return.",
    });
  }

  flags.push(
    estimate.market === "halifax_maritimes"
      ? {
          level: "info",
          label: "Halifax uplift is one broad permit-renovation signal",
          detail: "Kitchen, bathroom, energy, maintenance, and roof selections share the same HRM permit-linked repeat-sale category and do not stack as separate measured effects.",
        }
      : {
          level: "info",
          label: "Renovation evidence transfers from Seattle to Vancouver",
          detail: "The uplift layer uses Seattle repeat-sale and permit records, then transfers the percentage to the Vancouver listing-value estimate. Review this cross-market assumption manually.",
        },
  );

  return flags;
}

export function labelDeal(netUpsidePercent: number, valueGapPercent: number, flags: DealRiskFlag[]): DealLabel {
  const hasDanger = flags.some((flag) => flag.level === "danger");
  const hasWarning = flags.some((flag) => flag.level === "warning");

  if (netUpsidePercent < 0 || (hasDanger && netUpsidePercent < 0.06)) {
    return "Pass for now";
  }
  if (hasDanger) {
    return "Needs caution";
  }
  if (netUpsidePercent >= 0.08 && valueGapPercent >= -0.02 && !hasDanger && !hasWarning) {
    return "Worth review";
  }
  if (netUpsidePercent >= 0.03 || valueGapPercent >= 0.02) {
    return "Worth review";
  }
  return "Needs caution";
}

export async function analyzeDeal(request: DealAnalyzeRequest): Promise<DealAnalyzeResponse> {
  const estimate = await estimateProperty(request);
  const targetPrice = computeDealTargetPrice(request.askingPrice, estimate.baseValue);
  const plan = await buildSalePlan({
    ...request,
    targetPrice,
  });

  const afterPlanValue = Math.round(plan.achievableValue ?? estimate.baseValue);
  const modeledValueGap = Math.round(estimate.baseValue - request.askingPrice);
  const valueGapPercent = Number(percent(modeledValueGap, request.askingPrice).toFixed(4));
  const netUpsidePercent = Number(percent(Math.round(afterPlanValue - request.askingPrice) - (plan.plannedSpend ?? 0), request.askingPrice).toFixed(4));

  return buildDealAnalyze({
    request,
    estimate,
    plan,
    provenance: {
      engineType: "composite",
      evidenceLevel: "mixed",
      validationStatus: "unvalidated",
      version: "live-deal-screening-v1",
      sourceIds: [],
      limitations: [
        "Deal screening excludes transaction, financing, tax, operating, vacancy, carrying, and sale costs.",
        "The seeded triangular stress test is illustrative and does not produce calibrated probabilities.",
      ],
    },
    buildRiskFlags: ({ plan: planResult, afterPlanValue: afterPlan, netUpsidePercent: netUpside }) =>
      buildRiskFlags(request, estimate, planResult, afterPlan, netUpside),
    chooseLabel: (netUpside, valueGap, flags) => labelDeal(netUpside, valueGap, flags),
  });
}
