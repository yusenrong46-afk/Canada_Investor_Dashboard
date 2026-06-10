import path from "node:path";

import { ZodError } from "zod/v4";

import {
  detectMarket,
  marketCatalog,
  type DealAnalyzeResponse,
  type DealLabel,
  type DealRiskFlag,
  type DemoMetricsResponse,
  type EstimateResponse,
  type PlannedFlag,
  type PlanLineItem,
  type PlanPhase,
  type PlanRequest,
  type PlanResponse,
  type PropertyInput,
  type SimulateRequest,
  type SimulateResponse,
} from "@vvl/shared";

import { computeDealRobustness } from "./dealAnalysis";
import { readRepoJson } from "./repoFiles";

export const demoModeEnabled = process.env.DEMO_MODE === "true" || process.env.DEMO_MODE === "1";

interface DemoProperty extends PropertyInput {
  id: string;
  askingPrice: number;
  budget: number;
  targetPrice: number;
  timelineMonths: number;
  plannedFlags: PlannedFlag[];
}

// Demo sample JSON predates the multi-market contract: it stores Vancouver medians only under the deprecated keys.
interface DemoMarketContextRow extends Omit<EstimateResponse["marketContext"], "cityMedianValue" | "cityMedianPricePerSqft"> {
  cityMedianValue?: number;
  cityMedianPricePerSqft?: number;
  vancouverMedianValue: number;
  vancouverMedianPricePerSqft: number;
}

interface DemoEstimateRow {
  propertyId: string;
  propertyType: PropertyInput["propertyType"];
  baseValue: number;
  confidenceLow: number;
  confidenceHigh: number;
  anchorValue: number;
  pricePerSqft: number;
  confidenceRatio: number;
  drivers: EstimateResponse["drivers"];
  marketContext: DemoMarketContextRow;
}

interface DemoPlanFileRow extends Omit<PlanResponse, "phases"> {
  propertyId: string;
  status: "ready";
  items: PlanLineItem[];
}

interface DemoPropertiesFile {
  properties: DemoProperty[];
}

interface DemoEstimatesFile {
  estimates: DemoEstimateRow[];
}

interface DemoPlansFile {
  plans: DemoPlanFileRow[];
}

function readDemoJson<T>(fileName: string): T {
  return readRepoJson<T>(path.join("demo", fileName));
}

// Demo samples are Vancouver-only; ZodError keeps app.ts mapping this guard to a 400.
function assertDemoMarketSupported(postalCode: string): void {
  if (detectMarket(postalCode) === "halifax_maritimes") {
    throw new ZodError([
      {
        code: "custom",
        path: ["postalCode"],
        message: "Demo mode has precomputed Vancouver samples only - use live or public mode for Halifax / Maritimes (B-prefix) postal codes.",
        input: postalCode,
      },
    ]);
  }
}

function demoProperties(): DemoProperty[] {
  return readDemoJson<DemoPropertiesFile>("sample_properties.json").properties;
}

function demoEstimates(): DemoEstimateRow[] {
  return readDemoJson<DemoEstimatesFile>("sample_estimates.json").estimates;
}

function demoPlans(): DemoPlanFileRow[] {
  return readDemoJson<DemoPlansFile>("sample_plans.json").plans;
}

function chooseDemoProperty(property: PropertyInput): DemoProperty {
  const samples = demoProperties();
  // Prefer postal-code matches, then property-type matches, so demo mode still reacts to user input.
  const postalMatch = samples.find((sample) => sample.postalCode.replace(" ", "") === property.postalCode.replace(" ", ""));
  const typeMatch = samples.find((sample) => sample.propertyType === property.propertyType);
  return postalMatch ?? typeMatch ?? samples[0];
}

function chooseDemoEstimate(property: PropertyInput): DemoEstimateRow {
  const sample = chooseDemoProperty(property);
  const estimates = demoEstimates();
  return estimates.find((estimate) => estimate.propertyId === sample.id) ?? estimates[0];
}

function chooseDemoPlan(property: PropertyInput): DemoPlanFileRow {
  const sample = chooseDemoProperty(property);
  const plans = demoPlans();
  return plans.find((plan) => plan.propertyId === sample.id) ?? plans[0];
}

const demoModelQuality: EstimateResponse["modelQuality"] = {
  trainingRows: 3518,
  cvMae: 349029,
  cvMape: 0.1389,
  cvR2: 0.807,
  holdoutMae: 331348,
  holdoutMape: 0.1264,
  holdoutR2: 0.821,
  outlierRemovedRate: 0.0225,
  validationSummary: {
    trainHoldoutSplit: "80/20 stratified holdout from the saved Vancouver listing model artifact",
    crossValidation: "Adaptive 3 or 5 fold cross-validation by property type",
    bootstrap: "400 bootstrap resamples on holdout predictions",
    bootstrapRanges: {
      mae: { mean: 331494, p05: 279671, p50: 329859, p95: 386064 },
      mape: { mean: 0.1262, p05: 0.1135, p50: 0.1261, p95: 0.1395 },
      r2: { mean: 0.8176, p05: 0.7564, p50: 0.8214, p95: 0.865 },
    },
    missingnessNotes: [
      "Demo mode uses precomputed public samples.",
      "The saved model predicts listing price, not final sale price.",
    ],
    locationFeatures: "Postal-code centroid, FSA, and submarket cluster features",
    clusterCount: 12,
  },
};

function demoMarketFreshness(): EstimateResponse["marketFreshness"] {
  return {
    status: "not-applied",
    message: "Demo Mode: using precomputed sample output without a live market-index adjustment.",
  };
}

export function buildDemoEstimate(property: PropertyInput): EstimateResponse {
  assertDemoMarketSupported(property.postalCode);
  const sample = chooseDemoEstimate(property);
  const market = detectMarket(property.postalCode) ?? "vancouver";

  return {
    modelVersion: "demo-sample-v1",
    trainingMode: "demo-safe-precomputed",
    modelFamily: "random-forest",
    modelScope: sample.propertyType,
    market,
    marketLabel: marketCatalog[market].label,
    baseValue: sample.baseValue,
    confidenceLow: sample.confidenceLow,
    confidenceHigh: sample.confidenceHigh,
    anchorValue: sample.anchorValue,
    pricePerSqft: sample.pricePerSqft,
    confidenceRatio: sample.confidenceRatio,
    modelQuality: demoModelQuality,
    drivers: sample.drivers,
    marketContext: {
      ...sample.marketContext,
      cityMedianValue: sample.marketContext.cityMedianValue ?? sample.marketContext.vancouverMedianValue,
      cityMedianPricePerSqft: sample.marketContext.cityMedianPricePerSqft ?? sample.marketContext.vancouverMedianPricePerSqft,
    },
    uncertainty: {
      method: "error-ratio",
      targetCoverage: 0.8,
      calibrationNote: "Demo intervals reuse the saved sample confidence ratio and are not recalibrated for this property.",
    },
    explanationMethod: "heuristic",
    marketFreshness: demoMarketFreshness(),
  };
}

function phaseRows(items: PlanLineItem[]): PlanPhase[] {
  const phases = new Map<string, PlanLineItem[]>();

  for (const item of items) {
    phases.set(item.phase, [...(phases.get(item.phase) ?? []), item]);
  }

  return Array.from(phases.entries()).map(([phase, phaseItems]) => ({
    phase,
    durationMonths: phaseItems.reduce((sum, item) => sum + item.months, 0),
    plannedSpend: phaseItems.reduce((sum, item) => sum + item.cost, 0),
    plannedUplift: phaseItems.reduce((sum, item) => sum + item.projectedUplift, 0),
    items: phaseItems,
  }));
}

function keepItemsInsideLimits(items: PlanLineItem[], budget: number, timelineMonths: number): PlanLineItem[] {
  const chosen: PlanLineItem[] = [];
  let remainingBudget = budget;
  let remainingMonths = timelineMonths;

  for (const item of items) {
    if (item.cost <= remainingBudget && item.months <= remainingMonths) {
      chosen.push(item);
      remainingBudget -= item.cost;
      remainingMonths -= item.months;
    }
  }

  return chosen;
}

export function buildDemoSimulate(request: SimulateRequest): SimulateResponse {
  const estimate = buildDemoEstimate(request);
  const plan = chooseDemoPlan(request);
  const selectedFlags = new Set(request.plannedFlags ?? []);
  const selectedItems = plan.items.filter((item) => selectedFlags.has(item.flag));
  const upliftValue = selectedItems.reduce((sum, item) => sum + item.projectedUplift, 0);
  const finalValueRaw = estimate.baseValue + upliftValue;
  const finalValueGuardrailed = Math.min(finalValueRaw, estimate.marketContext.practicalCeiling);
  const upliftPercent = estimate.baseValue > 0 ? upliftValue / estimate.baseValue : 0;

  return {
    status: "ready",
    message: "Demo Mode: using precomputed sample uplift output.",
    modelVersion: "demo-uplift-sample-v1",
    trainingMode: "demo-safe-precomputed",
    modelFamily: "random-forest",
    evidenceLevel: "observed",
    evidenceSummary: "Public demo sample based on the current app contract. Not a live uplift prediction.",
    baseValue: estimate.baseValue,
    upliftPercent,
    upliftPercentConfidenceLow: Math.max(0, upliftPercent - 0.025),
    upliftPercentConfidenceHigh: upliftPercent + 0.025,
    upliftValue,
    finalValueRaw,
    finalValueGuardrailed,
    upliftConfidenceLow: Math.max(0, upliftValue - 25000),
    upliftConfidenceHigh: upliftValue + 25000,
    ceilingFlag: finalValueRaw > finalValueGuardrailed,
    plannedFlags: request.plannedFlags ?? [],
    topUpliftDrivers: selectedItems.map((item) => ({
      flag: item.flag,
      label: item.label,
      value: item.projectedUplift,
      upliftPercent: item.projectedUpliftPercent,
      confidence: "medium",
      rationale: "Demo-safe sample uplift driver.",
    })),
    observedShare: 1,
    dataSources: {
      demo: "demo/sample_plans.json",
    },
    rowCounts: {
      samplePlans: demoPlans().length,
    },
    methodNotes: [
      "Demo mode does not require the Python model service.",
      "Uplift examples are stable public samples, not fresh model inference.",
    ],
  };
}

export function buildDemoPlan(request: PlanRequest): PlanResponse {
  const estimate = buildDemoEstimate(request);
  const samplePlan = chooseDemoPlan(request);
  const items = keepItemsInsideLimits(samplePlan.items, request.budget, request.timelineMonths);
  const plannedSpend = items.reduce((sum, item) => sum + item.cost, 0);
  const plannedMonths = items.reduce((sum, item) => sum + item.months, 0);
  const plannedUplift = items.reduce((sum, item) => sum + item.projectedUplift, 0);
  const achievableValue = Math.min(estimate.baseValue + plannedUplift, estimate.marketContext.practicalCeiling);
  const gapToTarget = request.targetPrice - achievableValue;

  let targetAssessment: PlanResponse["targetAssessment"] = "Unlikely";
  if (gapToTarget <= 0) {
    targetAssessment = "Likely";
  } else if (gapToTarget / request.targetPrice <= 0.05) {
    targetAssessment = "Stretch";
  }

  return {
    status: "ready",
    message: "Demo Mode: using precomputed sample plan output.",
    evidenceLevel: "observed",
    dataSources: {
      demo: "demo/sample_plans.json",
    },
    methodNotes: [
      "Plan values are stable demo examples.",
      "Live mode still calls the Python model service for estimate and uplift logic.",
    ],
    targetAssessment,
    baseValue: estimate.baseValue,
    achievableValue,
    targetPrice: request.targetPrice,
    gapToTarget,
    plannedSpend,
    plannedMonths,
    items,
    phases: phaseRows(items),
  };
}

function percent(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

function chooseDealLabel(grossUpsidePercent: number, flags: DealRiskFlag[]): DealLabel {
  const hasDanger = flags.some((flag) => flag.level === "danger");

  if (grossUpsidePercent < 0 || hasDanger) {
    return "Pass for now";
  }
  if (grossUpsidePercent >= 0.08) {
    return "Strong lead";
  }
  if (grossUpsidePercent >= 0.03) {
    return "Worth review";
  }
  return "Needs caution";
}

export function buildDemoDealAnalyze(
  request: PropertyInput & { askingPrice: number; budget: number; timelineMonths: number; plannedFlags?: PlannedFlag[] },
): DealAnalyzeResponse {
  const estimate = buildDemoEstimate(request);
  const targetPrice = Math.max(request.askingPrice, estimate.baseValue) * 1.08;
  const plan = buildDemoPlan({
    ...request,
    targetPrice,
    plannedFlags: request.plannedFlags ?? [],
  });
  const afterPlanValue = Math.round(plan.achievableValue ?? estimate.baseValue);
  const modeledValueGap = Math.round(estimate.baseValue - request.askingPrice);
  const estimatedGrossUpside = Math.round(afterPlanValue - request.askingPrice);
  const valueGapPercent = Number(percent(modeledValueGap, request.askingPrice).toFixed(4));
  const grossUpsidePercent = Number(percent(estimatedGrossUpside, request.askingPrice).toFixed(4));
  const riskFlags: DealRiskFlag[] = [
    {
      level: modeledValueGap >= 0 ? "info" : "warning",
      label: modeledValueGap >= 0 ? "Price is supported by sample estimate" : "Asking price is above sample estimate",
      detail: "Demo mode compares asking price with a stable sample estimate.",
    },
    {
      level: "info",
      label: "Demo-safe output",
      detail: "This response uses public sample JSON and does not require private data or model artifacts.",
    },
  ];

  if (estimate.confidenceRatio >= 0.16) {
    riskFlags.push({
      level: "warning",
      label: "Wide model confidence range",
      detail: "This sample segment has a wider confidence band and needs comparable-sale review.",
    });
  }

  return {
    dealLabel: chooseDealLabel(grossUpsidePercent, riskFlags),
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

export function getDemoMetrics(): DemoMetricsResponse {
  return readDemoJson<DemoMetricsResponse>("sample_metrics.json");
}
