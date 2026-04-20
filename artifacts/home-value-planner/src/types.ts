export type PropertyType = "Detached" | "Townhouse" | "Condo" | "Duplex";
export type PlannedFlag =
  | "renovatedKitchen"
  | "renovatedBathrooms"
  | "legalSuiteAdded"
  | "energyEfficient"
  | "curbAppealImproved"
  | "permitIssuesResolved"
  | "deferredMaintenanceResolved"
  | "roofIssueResolved";

export interface PropertyInput {
  postalCode: string;
  propertyType: PropertyType;
  livingAreaSqft: number;
  bedrooms: number;
  bathrooms: number;
  propertyTax?: number;
  knownCurrentValue?: number;
}

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
}

export interface ComingSoonResponse {
  status: "ready" | "data-missing";
  message?: string;
}

export interface UpliftDriver {
  flag: PlannedFlag;
  label: string;
  value: number;
  confidence?: "high" | "medium" | "low";
  rationale?: string;
}

export interface SimulateResponse {
  status: "ready" | "data-missing";
  message?: string;
  modelVersion?: string;
  trainingMode?: string;
  modelFamily?: "xgboost" | "random-forest" | "rule-based";
  evidenceLevel?: "observed" | "hybrid" | "proxy-heavy" | "rule-based";
  evidenceSummary?: string;
  baseValue?: number;
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

export interface PlanResponse {
  status: "ready" | "data-missing";
  message?: string;
  evidenceLevel?: "observed" | "hybrid" | "proxy-heavy" | "rule-based";
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
