import { buildSalePlan, estimateProperty, type EstimateResponse, type PlanResponse } from "./model";
import type { DealAnalyzeRequest } from "./schemas";

export type DealLabel = "Strong lead" | "Worth review" | "Needs caution" | "Pass for now";
export type RiskLevel = "info" | "warning" | "danger";

export interface DealRiskFlag {
  level: RiskLevel;
  label: string;
  detail: string;
}

export interface DealAnalyzeResponse {
  dealLabel: DealLabel;
  modeledValueGap: number;
  valueGapPercent: number;
  afterPlanValue: number;
  estimatedGrossUpside: number;
  grossUpsidePercent: number;
  riskFlags: DealRiskFlag[];
  estimate: EstimateResponse;
  plan: PlanResponse;
}

function percent(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
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
  };
}
