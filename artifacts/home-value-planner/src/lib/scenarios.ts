import { API_CONTRACT_VERSION, improvementFlagValues, propertyTypeValues, type DealAnalyzeResponse, type EstimateResponse, type PlannedFlag, type PlanResponse, type PropertyInput } from "@vvl/shared";

export type ScenarioSource = "plan" | "deal-analyzer";
export type ScenarioRiskLevel = "Low" | "Medium" | "High";
export type ScenarioTag = "Shortlist" | "Watch" | "Pass" | "Needs review";

export interface PlanInputState {
  targetPrice: number;
  budget: number;
  timelineMonths: number;
}

export interface DealInputState {
  askingPrice: number;
  budget: number;
  timelineMonths: number;
}

export interface ScenarioRecord {
  id: string;
  createdAt: string;
  source: ScenarioSource;
  title: string;
  property: PropertyInput;
  plannedFlags: PlannedFlag[];
  estimatedValue: number;
  achievableValue: number;
  pricePerSqft: number;
  targetPrice?: number;
  askingPrice?: number;
  budget: number;
  timelineMonths: number;
  plannedSpend: number;
  estimatedUpside: number;
  upsidePercent: number;
  verdict: string;
  riskLevel: ScenarioRiskLevel;
  tag: ScenarioTag;
  note: string;
  warnings: string[];
  modelVersion?: string;
  contractVersion?: string;
}

export const SCENARIO_STORE_VERSION = 1 as const;

export type ScenarioStore = {
  version: typeof SCENARIO_STORE_VERSION;
  data: ScenarioRecord[];
};

function isScenarioRecord(value: unknown): value is ScenarioRecord {
  if (typeof value !== "object" || value == null) {
    return false;
  }

  const record = value as ScenarioRecord;
  return (
    typeof record.id === "string" &&
    typeof record.createdAt === "string" &&
    (record.source === "plan" || record.source === "deal-analyzer") &&
    typeof record.title === "string" &&
    typeof record.property === "object" &&
    record.property != null &&
    propertyTypeValues.includes(record.property.propertyType) &&
    Array.isArray(record.plannedFlags) &&
    record.plannedFlags.every((flag) => improvementFlagValues.includes(flag)) &&
    typeof record.estimatedValue === "number" &&
    typeof record.achievableValue === "number" &&
    typeof record.budget === "number" &&
    typeof record.timelineMonths === "number" &&
    typeof record.verdict === "string" &&
    (record.riskLevel === "Low" || record.riskLevel === "Medium" || record.riskLevel === "High") &&
    (record.tag === "Shortlist" || record.tag === "Watch" || record.tag === "Pass" || record.tag === "Needs review") &&
    typeof record.note === "string" &&
    Array.isArray(record.warnings)
  );
}

export function isScenarioStore(value: unknown): value is ScenarioStore {
  if (typeof value !== "object" || value == null) {
    return false;
  }

  const store = value as ScenarioStore;
  return store.version === SCENARIO_STORE_VERSION && Array.isArray(store.data) && store.data.every(isScenarioRecord);
}

export interface ScenarioSummary {
  averageEstimatedValue: number;
  medianEstimatedValue: number;
  averagePricePerSqft: number;
  averageUpside: number;
  samplePropertyCount: number;
  warningCount: number;
}

function nowId(): string {
  return crypto.randomUUID();
}

export function migrateScenarioStore(raw: unknown): ScenarioStore | null {
  if (isScenarioStore(raw)) {
    return {
      version: SCENARIO_STORE_VERSION,
      data: raw.data.map(cleanScenario).filter(isScenarioRecord),
    };
  }

  if (Array.isArray(raw)) {
    const data = raw
      .map((entry) => (typeof entry === "object" && entry != null ? cleanScenario(entry as ScenarioRecord) : null))
      .filter((scenario): scenario is ScenarioRecord => scenario != null && isScenarioRecord(scenario));

    return { version: SCENARIO_STORE_VERSION, data };
  }

  return null;
}

function median(values: number[]): number {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function propertyLabel(property: PropertyInput): string {
  return `${property.postalCode} ${property.propertyType}`;
}

function riskFromPlan(plan: PlanResponse, estimate: EstimateResponse, warnings: string[]): ScenarioRiskLevel {
  // Saved scenarios carry a simple risk label so the workspace can compare runs without re-calling the API.
  if (plan.targetAssessment === "Below target" || estimate.confidenceRatio >= 0.18 || warnings.length >= 3) {
    return "High";
  }
  if (plan.targetAssessment === "Near target" || estimate.confidenceRatio >= 0.14 || warnings.length > 0) {
    return "Medium";
  }
  return "Low";
}

function riskFromDeal(deal: DealAnalyzeResponse): ScenarioRiskLevel {
  if (deal.riskFlags.some((flag) => flag.level === "danger")) {
    return "High";
  }
  if (deal.riskFlags.some((flag) => flag.level === "warning")) {
    return "Medium";
  }
  return "Low";
}

function tagFromPlan(plan: PlanResponse): ScenarioTag {
  if (plan.targetAssessment === "Meets target") {
    return "Shortlist";
  }
  if (plan.targetAssessment === "Below target") {
    return "Pass";
  }
  return "Watch";
}

function tagFromDeal(deal: DealAnalyzeResponse): ScenarioTag {
  if (deal.dealLabel === "Worth review" && deal.netUpsidePercent >= 0.08 && !deal.riskFlags.some((flag) => flag.level !== "info")) {
    return "Shortlist";
  }
  if (deal.dealLabel === "Pass for now") {
    return "Pass";
  }
  return "Watch";
}

function defaultNote(warnings: string[]): string {
  if (warnings.length) {
    return warnings[0];
  }
  return "Saved for comparison.";
}

function warningNotesFromPlanWithoutEstimate(plan: PlanResponse): string[] {
  const warnings: string[] = [];
  if (plan.targetAssessment === "Near target") {
    warnings.push("Target price is near the modeled achievable value");
  }
  if (plan.targetAssessment === "Below target") {
    warnings.push("Target price is below the modeled achievable value");
  }
  if ((plan.plannedSpend ?? 0) <= 0) {
    warnings.push("No positive-value plan fit the current budget and timeline");
  }
  return warnings;
}

function warningNotesFromPlan(plan: PlanResponse, estimate: EstimateResponse): string[] {
  const warnings = warningNotesFromPlanWithoutEstimate(plan);

  // These warnings are intentionally plain-language because they surface directly in the investor workspace.
  if (estimate.confidenceRatio >= 0.16) {
    warnings.unshift("Wide estimate confidence range");
  }

  return warnings;
}

function riskFromPlanWarningsOnly(plan: PlanResponse, warnings: string[]): ScenarioRiskLevel {
  if (plan.targetAssessment === "Below target" || warnings.length >= 2) {
    return "High";
  }
  if (plan.targetAssessment === "Near target" || warnings.length) {
    return "Medium";
  }
  return "Low";
}

export function createPlanScenario(input: {
  property: PropertyInput;
  plannedFlags: PlannedFlag[];
  estimate?: EstimateResponse | null;
  plan: PlanResponse;
  targetPrice: number;
  budget: number;
  timelineMonths: number;
}): ScenarioRecord {
  const baseValue = input.plan.baseValue ?? input.estimate?.baseValue;
  if (baseValue == null) {
    throw new Error("Plan scenario requires a base value");
  }
  const warnings = input.estimate ? warningNotesFromPlan(input.plan, input.estimate) : warningNotesFromPlanWithoutEstimate(input.plan);
  const achievableValue = input.plan.achievableValue ?? baseValue;
  const plannedSpend = input.plan.plannedSpend ?? 0;
  const estimatedUpside = Math.round(achievableValue - baseValue);
  const upsidePercent = baseValue > 0 ? estimatedUpside / baseValue : 0;

  return {
    id: nowId(),
    createdAt: new Date().toISOString(),
    source: "plan",
    title: `${propertyLabel(input.property)} plan`,
    property: input.property,
    plannedFlags: input.plannedFlags,
    estimatedValue: Math.round(baseValue),
    achievableValue: Math.round(achievableValue),
    pricePerSqft: Math.round(input.estimate?.pricePerSqft ?? baseValue / Math.max(input.property.livingAreaSqft, 1)),
    targetPrice: input.targetPrice,
    budget: input.budget,
    timelineMonths: input.timelineMonths,
    plannedSpend,
    estimatedUpside,
    upsidePercent,
    verdict: input.plan.targetAssessment ?? "Needs review",
    riskLevel: input.estimate ? riskFromPlan(input.plan, input.estimate, warnings) : riskFromPlanWarningsOnly(input.plan, warnings),
    tag: tagFromPlan(input.plan),
    note: defaultNote(warnings),
    warnings,
    modelVersion: input.estimate?.modelVersion,
    contractVersion: API_CONTRACT_VERSION,
  };
}

export function createDealScenario(input: {
  property: PropertyInput;
  plannedFlags: PlannedFlag[];
  askingPrice: number;
  budget: number;
  timelineMonths: number;
  deal: DealAnalyzeResponse;
}): ScenarioRecord {
  const warnings = input.deal.riskFlags.filter((flag) => flag.level !== "info").map((flag) => flag.label);

  return {
    id: nowId(),
    createdAt: new Date().toISOString(),
    source: "deal-analyzer",
    title: `${propertyLabel(input.property)} deal`,
    property: input.property,
    plannedFlags: input.plannedFlags,
    estimatedValue: Math.round(input.deal.estimate.baseValue),
    achievableValue: Math.round(input.deal.afterPlanValue),
    pricePerSqft: Math.round(input.deal.estimate.pricePerSqft),
    askingPrice: input.askingPrice,
    budget: input.budget,
    timelineMonths: input.timelineMonths,
    plannedSpend: input.deal.plan.plannedSpend ?? 0,
    estimatedUpside: Math.round(input.deal.estimatedNetUpside),
    upsidePercent: input.deal.netUpsidePercent,
    verdict: input.deal.dealLabel,
    riskLevel: riskFromDeal(input.deal),
    tag: tagFromDeal(input.deal),
    note: defaultNote(warnings),
    warnings,
    modelVersion: input.deal.estimate.modelVersion,
    contractVersion: API_CONTRACT_VERSION,
  };
}

export function summarizeScenarios(scenarios: ScenarioRecord[]): ScenarioSummary {
  return {
    averageEstimatedValue: average(scenarios.map((scenario) => scenario.estimatedValue)),
    medianEstimatedValue: median(scenarios.map((scenario) => scenario.estimatedValue)),
    averagePricePerSqft: average(scenarios.map((scenario) => scenario.pricePerSqft)),
    averageUpside: average(scenarios.map((scenario) => scenario.estimatedUpside)),
    samplePropertyCount: scenarios.length,
    warningCount: scenarios.reduce((sum, scenario) => sum + scenario.warnings.length, 0),
  };
}

export function newestFirst(scenarios: ScenarioRecord[]): ScenarioRecord[] {
  return [...scenarios].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export function cleanScenario(scenario: ScenarioRecord): ScenarioRecord {
  const fallbackTag: ScenarioTag = scenario.verdict === "Pass for now" || scenario.verdict === "Unlikely" ? "Pass" : "Needs review";

  // Older localStorage records may be missing fields added after the workspace feature shipped.
  return {
    ...scenario,
    tag: scenario.tag ?? fallbackTag,
    note: scenario.note ?? defaultNote(scenario.warnings ?? []),
    warnings: scenario.warnings ?? [],
  };
}

export function scenarioKeyDetails(scenario: ScenarioRecord): string {
  return `${scenario.property.propertyType} | ${scenario.property.livingAreaSqft.toLocaleString()} sqft | ${scenario.timelineMonths} months`;
}
