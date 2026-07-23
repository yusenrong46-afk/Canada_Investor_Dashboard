import type { z } from "zod/v4";

import type {
  marketEvidenceFileSchema,
  marketEvidenceRowSchema,
  marketTrendPointSchema,
  marketTrendResponseSchema,
} from "./schemas";
import type { EvidenceLevel, ResultProvenance } from "./provenance";

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
  mean: number | null;
  p05: number | null;
  p50: number | null;
  p95: number | null;
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
  cvMae: number | null;
  cvMape: number | null;
  cvR2: number | null;
  holdoutMae: number | null;
  holdoutMape: number | null;
  holdoutR2: number | null;
  outlierRemovedRate: number | null;
  validationSummary: ValidationSummary;
}

export interface EstimateUncertainty {
  method: "conformal" | "error-ratio" | "sample-range";
  /** Only present for calibrated intervals with an explicit coverage target. */
  targetCoverage?: number;
  empiricalCoverage?: number | null;
  calibrationNote?: string;
}

export interface EstimateResponse {
  provenance: ResultProvenance;
  modelVersion: string;
  trainingMode: string;
  modelFamily: "xgboost" | "random-forest" | "rules" | "precomputed";
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
    status: "adjusted" | "not-applied" | "embedded-in-target";
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

export interface TreatedQuantileRange {
  /** P25 of observed treated outcomes minus control median — spread, not estimation error. */
  lowPercent: number;
  /** P75 of observed treated outcomes minus control median — spread, not estimation error. */
  highPercent: number;
  lowValue: number;
  highValue: number;
}

export interface SimulateResponse {
  provenance: ResultProvenance;
  status: "ready" | "data-missing";
  message?: string;
  modelVersion?: string;
  trainingMode?: string;
  modelFamily?: "xgboost" | "random-forest" | "rules" | "precomputed";
  evidenceLevel?: EvidenceLevel;
  evidenceSummary?: string;
  baseValue?: number;
  upliftPercent?: number;
  /** Spread of observed treated outcomes (p25–p75), not a calibrated confidence interval. */
  treatedQuantileRange?: TreatedQuantileRange;
  upliftValue?: number;
  finalValueRaw?: number;
  finalValueGuardrailed?: number;
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
  /** Whether the user already selected this work or the planner added it. */
  origin?: "committed" | "recommended";
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
  provenance: ResultProvenance;
  status: "ready" | "data-missing";
  message?: string;
  evidenceLevel?: EvidenceLevel;
  dataSources?: Record<string, string>;
  methodNotes?: string[];
  targetAssessment?: "Meets target" | "Near target" | "Below target";
  baseValue?: number;
  achievableValue?: number;
  targetPrice?: number;
  gapToTarget?: number;
  plannedSpend?: number;
  plannedMonths?: number;
  upliftConfidenceLow?: number;
  upliftConfidenceHigh?: number;
  items?: PlanLineItem[];
  phases?: PlanPhase[];
}

export type DealLabel = "Worth review" | "Needs caution" | "Pass for now";
export type RiskLevel = "info" | "warning" | "danger";

export interface DealRiskFlag {
  level: RiskLevel;
  label: string;
  detail: string;
}

/** Seeded triangular stress test over explicitly supplied ranges. Draw shares
 * are assumption-based diagnostics, not calibrated probabilities. */
export interface DealRobustness {
  method: "seeded-triangular-stress-test";
  draws: number;
  positiveUpsideShare: number;
  /** Share of seeded draws that reach the target; null when no target was given. */
  targetAchievableShare: number | null;
  upsideP10: number;
  upsideP50: number;
  upsideP90: number;
  note: string;
}

export interface DealAnalyzeResponse {
  provenance: ResultProvenance;
  dealLabel: DealLabel;
  modeledValueGap: number;
  valueGapPercent: number;
  afterPlanValue: number;
  estimatedGrossUpside: number;
  grossUpsidePercent: number;
  estimatedNetUpside: number;
  netUpsidePercent: number;
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
  provenance: ResultProvenance;
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

export type ApiRuntimeMode = "live-model" | "public-interactive" | "demo-samples";

export interface ApiHealthResponse {
  ok: true;
  service: "api-server";
  mode: ApiRuntimeMode;
  contractVersion: string;
  modelServiceReady?: boolean;
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
