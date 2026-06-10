import type { DealAnalyzeRequest, DealAnalyzeResponse, DealLabel, DealRiskFlag, DealRobustness, EstimateResponse, PlanResponse } from "@vvl/shared";

import { buildSalePlan, estimateProperty } from "./model";

function percent(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

export const ROBUSTNESS_DRAWS = 5_000;
// Fixed seed keeps the simulation reproducible: identical requests must return identical robustness numbers.
const ROBUSTNESS_SEED = 0x5eed2026;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// Inverse-CDF triangular sample; a zero-width interval collapses to the mode instead of inventing a spread.
function sampleTriangular(low: number, mode: number, high: number, u: number): number {
  if (!(high > low)) {
    return mode;
  }
  const peak = Math.min(Math.max(mode, low), high);
  const cut = (peak - low) / (high - low);
  if (u < cut) {
    return low + Math.sqrt(u * (high - low) * (peak - low));
  }
  return high - Math.sqrt((1 - u) * (high - low) * (high - peak));
}

function percentile(sortedValues: number[], q: number): number {
  const position = (sortedValues.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) {
    return sortedValues[lower];
  }
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (position - lower);
}

function roundProbability(value: number): number {
  return Number(value.toFixed(3));
}

export interface DealRobustnessInputs {
  askingPrice: number;
  baseValue: number;
  confidenceLow: number;
  confidenceHigh: number;
  afterPlanValue: number;
  /** Null when the deal calculus had no target price (e.g. the plan came back data-missing). */
  targetPrice?: number | null;
  /** Observed uplift band in dollars when the scenario reported one; omitted bands stay zero-width. */
  upliftConfidenceLow?: number | null;
  upliftConfidenceHigh?: number | null;
}

// Propagates the calibrated estimate band and the uplift range through the same arithmetic the point
// estimate uses: per draw, upside mirrors estimatedGrossUpside = afterPlanValue - askingPrice.
export function computeDealRobustness(inputs: DealRobustnessInputs): DealRobustness {
  const upliftPoint = inputs.afterPlanValue - inputs.baseValue;
  const upliftLow = inputs.upliftConfidenceLow;
  const upliftHigh = inputs.upliftConfidenceHigh;
  const hasUpliftBand = upliftLow != null && upliftHigh != null;
  const random = mulberry32(ROBUSTNESS_SEED);
  const upsides: number[] = [];
  let positiveUpside = 0;
  let targetHits = 0;

  for (let draw = 0; draw < ROBUSTNESS_DRAWS; draw += 1) {
    const currentValueDraw = sampleTriangular(inputs.confidenceLow, inputs.baseValue, inputs.confidenceHigh, random());
    const upliftDraw = hasUpliftBand ? sampleTriangular(upliftLow, upliftPoint, upliftHigh, random()) : upliftPoint;
    const afterPlanDraw = currentValueDraw + upliftDraw;
    const upside = afterPlanDraw - inputs.askingPrice;
    upsides.push(upside);
    if (upside > 0) {
      positiveUpside += 1;
    }
    if (inputs.targetPrice != null && afterPlanDraw >= inputs.targetPrice) {
      targetHits += 1;
    }
  }

  upsides.sort((left, right) => left - right);

  return {
    method: "monte-carlo-triangular",
    draws: ROBUSTNESS_DRAWS,
    probPositiveUpside: roundProbability(positiveUpside / ROBUSTNESS_DRAWS),
    probTargetAchievable: inputs.targetPrice != null ? roundProbability(targetHits / ROBUSTNESS_DRAWS) : null,
    upsideP10: Math.round(percentile(upsides, 0.1)),
    upsideP50: Math.round(percentile(upsides, 0.5)),
    upsideP90: Math.round(percentile(upsides, 0.9)),
    note: "Triangular Monte Carlo over the calibrated estimate band and observed uplift range; 5,000 draws (seeded).",
  };
}

function roundPercent(value: number): number {
  return Number(value.toFixed(4));
}

function buildRiskFlags(
  request: DealAnalyzeRequest,
  estimate: EstimateResponse,
  plan: PlanResponse,
  afterPlanValue: number,
  grossUpsidePercent: number,
): DealRiskFlag[] {
  const flags: DealRiskFlag[] = [];
  const askingPremium = percent(request.askingPrice - estimate.baseValue, estimate.baseValue);

  // Deal flags keep the investor-facing verdict explainable instead of returning only a score.
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

  if (grossUpsidePercent < 0) {
    flags.push({
      level: "danger",
      label: "No modeled upside",
      detail: "The guardrailed after-plan value is below the asking price.",
    });
  } else if (grossUpsidePercent < 0.04) {
    flags.push({
      level: "warning",
      label: "Thin upside",
      detail: "The estimated gross upside is under 4%, before transaction costs, financing, taxes, or surprises.",
    });
  }

  if (plan.targetAssessment === "Unlikely") {
    flags.push({
      level: "warning",
      label: "Target looks difficult",
      detail: "The Seattle-observed uplift plan does not appear to reach the target price inside the current budget and timeline.",
    });
  }

  if (afterPlanValue >= estimate.marketContext.practicalCeiling * 0.98) {
    flags.push({
      level: "warning",
      label: "Close to local ceiling",
      detail: "The modeled resale value is near the local practical ceiling, so over-improvement risk is higher.",
    });
  }

  if (estimate.confidenceRatio >= 0.16) {
    flags.push({
      level: "warning",
      label: "Wide model confidence range",
      detail: "The base estimate has a wider confidence band, so this deal deserves stronger comparable-sale review.",
    });
  }

  flags.push({
    level: "info",
    label: "Renovation upside uses observed Seattle resale data",
    detail: "The uplift layer predicts a percentage from real Seattle repeat-sale and permit records, then applies it to the Vancouver base estimate.",
  });

  return flags;
}

export function labelDeal(grossUpsidePercent: number, valueGapPercent: number, flags: DealRiskFlag[]): DealLabel {
  const hasDanger = flags.some((flag) => flag.level === "danger");

  // Thresholds are conservative because transaction costs, financing, taxes, and surprises are not modeled yet.
  if (grossUpsidePercent < 0 || (hasDanger && grossUpsidePercent < 0.06)) {
    return "Pass for now";
  }
  if (grossUpsidePercent >= 0.08 && valueGapPercent >= -0.02 && !hasDanger) {
    return "Strong lead";
  }
  if (grossUpsidePercent >= 0.03 || valueGapPercent >= 0.02) {
    return "Worth review";
  }
  return "Needs caution";
}

export async function analyzeDeal(request: DealAnalyzeRequest): Promise<DealAnalyzeResponse> {
  const estimate = await estimateProperty(request);
  const targetPrice = Math.max(request.askingPrice, estimate.baseValue) * 1.08;
  const plan = await buildSalePlan({
    ...request,
    targetPrice,
  });

  const afterPlanValue = Math.round(plan.achievableValue ?? estimate.baseValue);
  const modeledValueGap = Math.round(estimate.baseValue - request.askingPrice);
  const estimatedGrossUpside = Math.round(afterPlanValue - request.askingPrice);
  const valueGapPercent = roundPercent(percent(modeledValueGap, request.askingPrice));
  const grossUpsidePercent = roundPercent(percent(estimatedGrossUpside, request.askingPrice));
  const riskFlags = buildRiskFlags(request, estimate, plan, afterPlanValue, grossUpsidePercent);

  return {
    dealLabel: labelDeal(grossUpsidePercent, valueGapPercent, riskFlags),
    modeledValueGap,
    valueGapPercent,
    afterPlanValue,
    estimatedGrossUpside,
    grossUpsidePercent,
    riskFlags,
    estimate,
    plan,
    // PlanResponse exposes only the point uplift, so the uplift distribution is zero-width here.
    robustness: computeDealRobustness({
      askingPrice: request.askingPrice,
      baseValue: estimate.baseValue,
      confidenceLow: estimate.confidenceLow,
      confidenceHigh: estimate.confidenceHigh,
      afterPlanValue,
      targetPrice: plan.targetPrice ?? null,
    }),
  };
}
