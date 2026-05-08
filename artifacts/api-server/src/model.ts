import { improvementCatalog } from "./data";
import type { PlanRequest, PropertyInput, SimulateRequest } from "./schemas";

const modelServiceBaseUrl = (process.env.MODEL_SERVICE_URL ?? "http://127.0.0.1:5001").replace(/\/$/, "");
type PropertyType = "Detached" | "Townhouse" | "Condo" | "Duplex";
type PlannedFlag = keyof typeof improvementCatalog;

export interface Driver {
  label: string;
  value: number;
}

export interface MarketContextResponse {
  localAreaLabel: string;
  localAreaScope: "postal-code" | "fsa" | "city-property-type" | "city";
  localMedianValue: number;
  localMedianPricePerSqft: number;
  vancouverMedianValue: number;
  vancouverMedianPricePerSqft: number;
  percentileRank: number;
  practicalCeiling: number;
  premiumGap: number;
  comparableCount: number;
}

export interface MetricRangeSummary {
  mean: number;
  p05: number;
  p50: number;
  p95: number;
}

export interface ValidationSummary {
  trainHoldoutSplit: string;
  crossValidation: string;
  bootstrap: string;
  bootstrapRanges: {
    mae: MetricRangeSummary;
    mape: MetricRangeSummary;
    r2: MetricRangeSummary;
  };
  missingnessNotes: string[];
  locationFeatures: string;
  clusterCount: number;
}

export interface ModelQuality {
  trainingRows: number;
  cvMae: number;
  cvMape: number;
  cvR2: number;
  holdoutMae: number;
  holdoutMape: number;
  holdoutR2: number;
  outlierRemovedRate: number;
  validationSummary: ValidationSummary;
}

export interface EstimateResponse {
  modelVersion: string;
  trainingMode: string;
  modelFamily: "xgboost" | "random-forest";
  modelScope: PropertyType;
  baseValue: number;
  confidenceLow: number;
  confidenceHigh: number;
  anchorValue: number;
  pricePerSqft: number;
  confidenceRatio: number;
  modelQuality: ModelQuality;
  drivers: Driver[];
  marketContext: MarketContextResponse;
  marketFreshness?: {
    status: "adjusted" | "not-applied";
    message: string;
    multiplier?: number;
    baselinePeriod?: string;
    latestPeriod?: string;
    dataSource?: string;
  };
}

export interface UpliftDriver {
  flag: PlannedFlag;
  label: string;
  value: number;
  upliftPercent?: number;
  confidence?: "high" | "medium" | "low";
  rationale?: string;
}

export interface SimulateResponse {
  status: "ready" | "data-missing";
  message?: string;
  modelVersion?: string;
  trainingMode?: string;
  modelFamily?: "xgboost" | "random-forest";
  evidenceLevel?: "observed";
  evidenceSummary?: string;
  baseValue?: number;
  upliftPercent?: number;
  upliftPercentConfidenceLow?: number;
  upliftPercentConfidenceHigh?: number;
  upliftValue?: number;
  finalValueRaw?: number;
  finalValueGuardrailed?: number;
  upliftConfidenceLow?: number;
  upliftConfidenceHigh?: number;
  ceilingFlag?: boolean;
  plannedFlags?: PlannedFlag[];
  topUpliftDrivers?: UpliftDriver[];
  observedShare?: number;
  dataSources?: Record<string, string>;
  rowCounts?: Record<string, number>;
  methodNotes?: string[];
}

export interface PlanLineItem {
  flag: PlannedFlag;
  label: string;
  phase: string;
  cost: number;
  months: number;
  projectedUplift: number;
  projectedUpliftPercent?: number;
  projectedFinalValue: number;
  valueRecoveryRate: number;
}

export interface PlanResponse {
  status: "ready" | "data-missing";
  message?: string;
  evidenceLevel?: "observed";
  dataSources?: Record<string, string>;
  methodNotes?: string[];
  targetAssessment?: "Likely" | "Stretch" | "Unlikely";
  baseValue?: number;
  achievableValue?: number;
  targetPrice?: number;
  gapToTarget?: number;
  plannedSpend?: number;
  plannedMonths?: number;
  items?: PlanLineItem[];
  phases?: Array<{
    phase: string;
    durationMonths: number;
    plannedSpend: number;
    plannedUplift: number;
    items: PlanLineItem[];
  }>;
}

async function requestModelService<TResponse>(path: string, payload?: object): Promise<TResponse> {
  const response = await fetch(`${modelServiceBaseUrl}${path}`, {
    method: payload ? "POST" : "GET",
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });

  const bodyText = await response.text();
  let parsedBody: TResponse | { message?: string } | null = null;
  if (bodyText) {
    try {
      parsedBody = JSON.parse(bodyText) as TResponse | { message?: string };
    } catch {
      parsedBody = { message: bodyText };
    }
  }

  if (!response.ok) {
    const message =
      parsedBody && typeof parsedBody === "object" && "message" in parsedBody
        ? parsedBody.message
        : `Model service request failed (${response.status})`;
    throw new Error(message ?? `Model service request failed (${response.status})`);
  }

  return parsedBody as TResponse;
}

export async function estimateProperty(property: PropertyInput): Promise<EstimateResponse> {
  return requestModelService<EstimateResponse>("/estimate", property);
}

export async function simulateScenario(request: SimulateRequest): Promise<SimulateResponse> {
  return requestModelService<SimulateResponse>("/uplift", request);
}

function byValueDescending(items: PlanLineItem[]): PlanLineItem[] {
  return [...items].sort((left, right) => {
    if (right.projectedUplift !== left.projectedUplift) {
      return right.projectedUplift - left.projectedUplift;
    }
    return right.valueRecoveryRate - left.valueRecoveryRate;
  });
}

function buildPhases(items: PlanLineItem[]): PlanResponse["phases"] {
  const grouped = new Map<string, PlanLineItem[]>();
  for (const item of items) {
    const existing = grouped.get(item.phase) ?? [];
    existing.push(item);
    grouped.set(item.phase, existing);
  }

  return Array.from(grouped.entries()).map(([phase, phaseItems]) => ({
    phase,
    durationMonths: phaseItems.reduce((sum, item) => sum + item.months, 0),
    plannedSpend: phaseItems.reduce((sum, item) => sum + item.cost, 0),
    plannedUplift: phaseItems.reduce((sum, item) => sum + item.projectedUplift, 0),
    items: phaseItems,
  }));
}

function assessTarget(achievableValue: number, targetPrice: number): "Likely" | "Stretch" | "Unlikely" {
  if (achievableValue >= targetPrice) {
    return "Likely";
  }

  const shortfallRatio = targetPrice > 0 ? (targetPrice - achievableValue) / targetPrice : 1;
  if (shortfallRatio <= 0.05) {
    return "Stretch";
  }

  return "Unlikely";
}

export async function buildSalePlan(request: PlanRequest): Promise<PlanResponse> {
  const baseline = await simulateScenario({
    ...request,
    plannedFlags: request.plannedFlags ?? [],
    horizonMonths: request.timelineMonths,
  });

  if (baseline.status !== "ready") {
    return {
      status: "data-missing",
      message: baseline.message ?? "The Seattle observed uplift model did not return a ready result.",
      dataSources: baseline.dataSources,
      methodNotes: baseline.methodNotes,
    };
  }

  const selectedFlags = new Set<PlannedFlag>((request.plannedFlags ?? []) as PlannedFlag[]);
  const candidates = (Object.keys(improvementCatalog) as PlannedFlag[]).filter((flag) => !selectedFlags.has(flag));
  let candidateDataMissing: SimulateResponse | undefined;
  const candidateRows = (
    await Promise.all(
      candidates.map(async (flag): Promise<PlanLineItem | null> => {
        const catalogItem = improvementCatalog[flag];
        const scenario = await simulateScenario({
          ...request,
          plannedFlags: [...selectedFlags, flag],
          horizonMonths: request.timelineMonths,
        });

        if (scenario.status === "data-missing") {
          candidateDataMissing = candidateDataMissing ?? scenario;
          return null;
        }

        if (
          scenario.upliftValue == null ||
          scenario.finalValueGuardrailed == null ||
          baseline.upliftValue == null
        ) {
          return null;
        }

        const incrementalUplift = scenario.upliftValue - baseline.upliftValue;
        const incrementalUpliftPercent = scenario.upliftPercent != null && baseline.upliftPercent != null ? scenario.upliftPercent - baseline.upliftPercent : undefined;
        const valueRecoveryRate = catalogItem.defaultCost > 0 ? incrementalUplift / catalogItem.defaultCost : 0;

        return {
          flag,
          label: catalogItem.label,
          phase: catalogItem.phase,
          cost: catalogItem.defaultCost,
          months: catalogItem.months,
          projectedUplift: Math.round(incrementalUplift),
          projectedUpliftPercent: incrementalUpliftPercent,
          projectedFinalValue: scenario.finalValueGuardrailed,
          valueRecoveryRate,
        };
      }),
    )
  ).filter((item): item is PlanLineItem => item != null);

  if (!candidateRows.length && candidateDataMissing) {
    return {
      status: "data-missing",
      message: candidateDataMissing.message,
      dataSources: candidateDataMissing.dataSources,
      methodNotes: candidateDataMissing.methodNotes,
    };
  }

  const chosen: PlanLineItem[] = [];
  let remainingBudget = request.budget;
  let remainingMonths = request.timelineMonths;

  for (const item of byValueDescending(candidateRows)) {
    if (item.cost > remainingBudget || item.months > remainingMonths || item.projectedUplift <= 0) {
      continue;
    }
    chosen.push(item);
    remainingBudget -= item.cost;
    remainingMonths -= item.months;
  }

  const finalScenario = chosen.length
    ? await simulateScenario({
        ...request,
        plannedFlags: [...selectedFlags, ...chosen.map((item) => item.flag)],
        horizonMonths: request.timelineMonths,
      })
    : baseline;

  const achievableValue = finalScenario.finalValueGuardrailed ?? baseline.finalValueGuardrailed ?? request.targetPrice;
  return {
    status: "ready",
    evidenceLevel: finalScenario.evidenceLevel,
    targetAssessment: assessTarget(achievableValue, request.targetPrice),
    baseValue: baseline.baseValue,
    achievableValue,
    targetPrice: request.targetPrice,
    gapToTarget: request.targetPrice - achievableValue,
    plannedSpend: chosen.reduce((sum, item) => sum + item.cost, 0),
    plannedMonths: chosen.reduce((sum, item) => sum + item.months, 0),
    items: chosen,
    phases: buildPhases(chosen),
  };
}
