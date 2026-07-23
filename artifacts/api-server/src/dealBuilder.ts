import { TARGET_MARKUP, resultProvenance, type DealAnalyzeRequest, type DealAnalyzeResponse, type DealLabel, type DealRiskFlag, type EstimateResponse, type PlanResponse } from "@vvl/shared";

import { computeDealRobustness } from "./dealRobustness";

function percent(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

function roundPercent(value: number): number {
  return Number(value.toFixed(4));
}

export function computeDealTargetPrice(askingPrice: number, baseValue: number): number {
  return Math.max(askingPrice, baseValue) * TARGET_MARKUP;
}

export interface DealBuilderOptions {
  request: DealAnalyzeRequest;
  estimate: EstimateResponse;
  plan: PlanResponse;
  provenance: {
    engineType: "rules" | "composite" | "precomputed-demo";
    evidenceLevel: "assumption" | "mixed" | "none" | "observed" | "proxy";
    validationStatus: "descriptive" | "not-applicable" | "unvalidated";
    version: string;
    sourceIds: string[];
    limitations: string[];
  };
  buildRiskFlags: (context: {
    request: DealAnalyzeRequest;
    estimate: EstimateResponse;
    plan: PlanResponse;
    afterPlanValue: number;
    netUpsidePercent: number;
    valueGapPercent: number;
  }) => DealRiskFlag[];
  chooseLabel: (netUpsidePercent: number, valueGapPercent: number, flags: DealRiskFlag[]) => DealLabel;
}

export function buildDealAnalyze(options: DealBuilderOptions): DealAnalyzeResponse {
  const { request, estimate, plan, provenance, buildRiskFlags, chooseLabel } = options;
  const afterPlanValue = Math.round(plan.achievableValue ?? estimate.baseValue);
  const modeledValueGap = Math.round(estimate.baseValue - request.askingPrice);
  const estimatedGrossUpside = Math.round(afterPlanValue - request.askingPrice);
  const estimatedNetUpside = Math.round(estimatedGrossUpside - (plan.plannedSpend ?? 0));
  const valueGapPercent = roundPercent(percent(modeledValueGap, request.askingPrice));
  const grossUpsidePercent = roundPercent(percent(estimatedGrossUpside, request.askingPrice));
  const netUpsidePercent = roundPercent(percent(estimatedNetUpside, request.askingPrice));
  const riskFlags = buildRiskFlags({ request, estimate, plan, afterPlanValue, netUpsidePercent, valueGapPercent });

  return {
    provenance: resultProvenance({
      engineType: provenance.engineType,
      evidenceLevel: provenance.evidenceLevel,
      validationStatus: provenance.validationStatus,
      version: provenance.version,
      dataAsOf: plan.provenance.dataAsOf,
      sourceIds: [...new Set([...estimate.provenance.sourceIds, ...plan.provenance.sourceIds, ...provenance.sourceIds])],
      limitations: provenance.limitations,
    }),
    dealLabel: chooseLabel(netUpsidePercent, valueGapPercent, riskFlags),
    modeledValueGap,
    valueGapPercent,
    afterPlanValue,
    estimatedGrossUpside,
    grossUpsidePercent,
    estimatedNetUpside,
    netUpsidePercent,
    riskFlags,
    estimate,
    plan,
    robustness: computeDealRobustness({
      askingPrice: request.askingPrice,
      baseValue: estimate.baseValue,
      confidenceLow: estimate.confidenceLow,
      confidenceHigh: estimate.confidenceHigh,
      afterPlanValue,
      targetPrice: plan.targetPrice ?? null,
      upliftConfidenceLow: plan.upliftConfidenceLow,
      upliftConfidenceHigh: plan.upliftConfidenceHigh,
      plannedSpend: plan.plannedSpend,
    }),
  };
}
