import type { z } from "zod/v4";

import type {
  marketEvidenceFileSchema,
  marketEvidenceRowSchema,
  marketTrendPointSchema,
  marketTrendResponseSchema,
} from "./schemas";

export type PropertyType = "Detached" | "Townhouse" | "Condo" | "Duplex";
export type PlannedFlag =
  | "renovatedKitchen"
  | "renovatedBathrooms"
  | "legalSuiteAdded"
  | "energyEfficient"
  | "deferredMaintenanceResolved"
  | "roofIssueResolved";

export interface PropertyInput {
  postalCode: string;
  propertyType: PropertyType;
  livingAreaSqft: number;
  bedrooms: number;
  bathrooms: number;
  yearBuilt?: number;
  knownCurrentValue?: number;
}

export type EstimateRequest = PropertyInput;

export interface Driver {
  label: string;
  value: number;
  source?: "shap" | "heuristic";
}

export interface MarketContextResponse {
  localAreaLabel: string;
  localAreaScope: "postal-code" | "fsa" | "city-property-type" | "city";
  localMedianValue: number;
  localMedianPricePerSqft: number;
  cityMedianValue: number;
  cityMedianPricePerSqft: number;
  /** @deprecated use cityMedianValue */
  vancouverMedianValue?: number;
  /** @deprecated use cityMedianPricePerSqft */
  vancouverMedianPricePerSqft?: number;
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

export interface EstimateUncertainty {
  method: "conformal" | "error-ratio";
  targetCoverage: number;
  empiricalCoverage?: number | null;
  calibrationNote?: string;
}

export interface EstimateResponse {
  modelVersion: string;
  trainingMode: string;
  modelFamily: "xgboost" | "random-forest";
  modelScope: PropertyType;
  market: string;
  marketLabel: string;
  baseValue: number;
  confidenceLow: number;
  confidenceHigh: number;
  anchorValue: number;
  pricePerSqft: number;
  confidenceRatio: number;
  modelQuality: ModelQuality;
  drivers: Driver[];
  marketContext: MarketContextResponse;
  uncertainty?: EstimateUncertainty;
  explanationMethod?: "shap" | "heuristic";
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

export type ImproveValueResponse = SimulateResponse;

export interface SimulateRequest extends PropertyInput {
  plannedFlags?: PlannedFlag[];
  horizonMonths?: number;
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

export interface PlanPhase {
  phase: string;
  durationMonths: number;
  plannedSpend: number;
  plannedUplift: number;
  items: PlanLineItem[];
}

export interface PlanRequest extends SimulateRequest {
  targetPrice: number;
  budget: number;
  timelineMonths: number;
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
  phases?: PlanPhase[];
}

export type DealLabel = "Strong lead" | "Worth review" | "Needs caution" | "Pass for now";
export type RiskLevel = "info" | "warning" | "danger";

export interface DealRiskFlag {
  level: RiskLevel;
  label: string;
  detail: string;
}

/** Monte Carlo deal robustness, propagating the estimate confidence band and
 * uplift range through the deal calculus. Additive and optional. */
export interface DealRobustness {
  method: "monte-carlo-triangular";
  draws: number;
  probPositiveUpside: number;
  /** Probability the after-plan value reaches the target price; null when no target was given. */
  probTargetAchievable: number | null;
  upsideP10: number;
  upsideP50: number;
  upsideP90: number;
  note: string;
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
  robustness?: DealRobustness;
}

export interface MarketMapCell {
  h3: string;
  /** Six [lat, lng] vertices of the H3 cell. */
  boundary: [number, number][];
  rows: number;
  medianValue: number;
  medianPricePerSqft: number;
}

export interface MarketMapMarket {
  market: string;
  label: string;
  zoom: number;
  center: [number, number];
  pricePerSqftDomain: [number, number];
  cells: MarketMapCell[];
}

export type MarketMapResponse =
  | ({ status: "ready"; generatedAt: string; source: string } & MarketMapMarket)
  | { status: "unavailable"; message: string };

export interface ModelExperimentRow {
  experiment: "local" | "pooled" | "hybrid";
  market: string;
  propertyType: string;
  family: string;
  trainingRows: number;
  holdoutRows: number;
  holdoutMae: number;
  holdoutMape: number;
  spatialCvMae: number | null;
  notes?: string;
}

export type ModelExperimentsResponse =
  | { status: "ready"; generatedAt: string; source: string; rows: ModelExperimentRow[]; conclusions: string[] }
  | { status: "unavailable"; message: string };

export interface DemoInsightRow {
  id: string;
  propertyType: PropertyType;
  livingAreaSqft: number;
  bedrooms: number;
  bathrooms: number;
  estimatedValue: number;
  pricePerSqft: number;
  budget: number;
  targetPrice: number;
  estimatedUpside: number;
  riskLevel: "Low" | "Medium" | "High";
  verdict: string;
  warnings: string[];
}

export interface DemoMetricsResponse {
  mode: "demo-safe" | "public-interactive";
  note: string;
  summary: {
    averageEstimatedValue: number;
    medianEstimatedValue: number;
    averagePricePerSqft: number;
    samplePropertyCount: number;
    warningCount: number;
  };
  rows: DemoInsightRow[];
  dataQualityNotes: string[];
}

export type MarketEvidenceRow = z.infer<typeof marketEvidenceRowSchema>;
export type MarketEvidenceFile = z.infer<typeof marketEvidenceFileSchema>;
export type MarketTrendPoint = z.infer<typeof marketTrendPointSchema>;
export type MarketTrendResponse = z.infer<typeof marketTrendResponseSchema>;

export interface MarketsResponse {
  markets: Array<{
    id: string;
    label: string;
    region: string;
    status: "available" | "live-only";
    postalPlaceholder: string;
    valuationBasis: string;
    note?: string;
  }>;
}
