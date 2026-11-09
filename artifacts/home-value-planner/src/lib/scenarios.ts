import {
  API_CONTRACT_VERSION,
  improvementFlagValues,
  propertyTypeValues,
  WIDE_CONFIDENCE_RATIO,
  type DealAnalyzeResponse,
  type EstimateResponse,
  type PlannedFlag,
  type PlanResponse,
  type PropertyInput,
} from "@vvl/shared";

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
  /** Net of planned renovation spend: after-plan value minus entry price (asking for deals, as-is value for plans) minus spend. */
  estimatedUpside: number;
  /** estimatedUpside as a share of the entry price. */
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
    typeof record.property.livingAreaSqft === "number" &&
    Array.isArray(record.plannedFlags) &&
    record.plannedFlags.every((flag) => improvementFlagValues.includes(flag)) &&
    typeof record.estimatedValue === "number" &&
    typeof record.achievableValue === "number" &&
    typeof record.pricePerSqft === "number" &&
    typeof record.budget === "number" &&
    typeof record.timelineMonths === "number" &&
    typeof record.plannedSpend === "number" &&
    typeof record.estimatedUpside === "number" &&
    typeof record.upsidePercent === "number" &&
    typeof record.verdict === "string" &&
    (record.riskLevel === "Low" || record.riskLevel === "Medium" || record.riskLevel === "High") &&
    (record.tag === "Shortlist" || record.tag === "Watch" || record.tag === "Pass" || record.tag === "Needs review") &&
    typeof record.note === "string" &&
    Array.isArray(record.warnings)
  );
}

export interface ScenarioSummary {
  averageEstimatedValue: number;
  medianEstimatedValue: number;
  averagePricePerSqft: number;
  averageUpside: number;
  samplePropertyCount: number;
  warningCount: number;
}

function newScenarioId(): string {
  // crypto.randomUUID only exists in secure contexts (HTTPS or localhost), not on a plain-HTTP LAN preview.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Reads a stored scenario store (or the older bare-array format) record by record, so one bad record
 * does not discard the rest. Returns null only when the value is not a scenario store at all.
 * The storage hook backs up the original whenever this drops or changes anything.
 */
export function migrateScenarioStore(raw: unknown): ScenarioStore | null {
  let entries: unknown[];
  if (Array.isArray(raw)) {
    entries = raw;
  } else if (typeof raw === "object" && raw != null && (raw as ScenarioStore).version === SCENARIO_STORE_VERSION && Array.isArray((raw as ScenarioStore).data)) {
    entries = (raw as ScenarioStore).data;
  } else {
    return null;
  }

  const data = entries
    .map((entry) => (typeof entry === "object" && entry != null ? cleanScenario(entry as ScenarioRecord) : null))
    .filter((scenario): scenario is ScenarioRecord => scenario != null && isScenarioRecord(scenario));

  return { version: SCENARIO_STORE_VERSION, data };
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

function warningNotesFromPlan(plan: PlanResponse): string[] {
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

// Saved scenarios carry a simple risk label so the workspace can compare runs without re-calling the API.
// It uses only the plan response, which is always present when saving, so the label does not depend on
// whether the separate estimate request happened to be loaded on the page.
function riskFromPlan(plan: PlanResponse, planWarnings: string[]): ScenarioRiskLevel {
  if (plan.targetAssessment === "Below target" || planWarnings.length >= 2) {
    return "High";
  }
  if (plan.targetAssessment === "Near target" || planWarnings.length) {
    return "Medium";
  }
  return "Low";
}

/** Plan upside net of renovation spend, measured against the as-is value (a plan has no purchase price). */
function planNetUpside(estimatedValue: number, achievableValue: number, plannedSpend: number): Pick<ScenarioRecord, "estimatedUpside" | "upsidePercent"> {
  const estimatedUpside = Math.round(achievableValue - estimatedValue - plannedSpend);
  return { estimatedUpside, upsidePercent: estimatedValue > 0 ? estimatedUpside / estimatedValue : 0 };
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
  const planWarnings = warningNotesFromPlan(input.plan);
  // Plain-language note shown in the workspace; informational only, it does not change the risk label.
  const warnings =
    input.estimate && input.estimate.confidenceRatio >= WIDE_CONFIDENCE_RATIO ? ["Wide estimate confidence range", ...planWarnings] : planWarnings;
  const estimatedValue = Math.round(baseValue);
  const achievableValue = Math.round(input.plan.achievableValue ?? baseValue);
  const plannedSpend = input.plan.plannedSpend ?? 0;

  return {
    id: newScenarioId(),
    createdAt: new Date().toISOString(),
    source: "plan",
    title: `${propertyLabel(input.property)} plan`,
    property: input.property,
    plannedFlags: input.plannedFlags,
    estimatedValue,
    achievableValue,
    pricePerSqft: Math.round(input.estimate?.pricePerSqft ?? baseValue / Math.max(input.property.livingAreaSqft, 1)),
    targetPrice: input.targetPrice,
    budget: input.budget,
    timelineMonths: input.timelineMonths,
    plannedSpend,
    ...planNetUpside(estimatedValue, achievableValue, plannedSpend),
    verdict: input.plan.targetAssessment ?? "Needs review",
    riskLevel: riskFromPlan(input.plan, planWarnings),
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
    id: newScenarioId(),
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
  const cleaned: ScenarioRecord = {
    ...scenario,
    tag: scenario.tag ?? fallbackTag,
    note: scenario.note ?? defaultNote(scenario.warnings ?? []),
    warnings: scenario.warnings ?? [],
  };

  // Plan records saved before upside was made net of spend stored the gross figure. Recomputing from the
  // stored values is idempotent, so new records are unchanged and old ones line up with deal records.
  if (cleaned.source === "plan" && [cleaned.estimatedValue, cleaned.achievableValue, cleaned.plannedSpend].every(Number.isFinite)) {
    return { ...cleaned, ...planNetUpside(cleaned.estimatedValue, cleaned.achievableValue, cleaned.plannedSpend) };
  }
  return cleaned;
}

export function scenarioKeyDetails(scenario: ScenarioRecord): string {
  return `${scenario.property.propertyType} | ${scenario.property.livingAreaSqft.toLocaleString()} sqft | ${scenario.timelineMonths} months`;
}
