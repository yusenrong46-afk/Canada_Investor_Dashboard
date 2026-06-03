import type { DealAnalyzeResponse, EstimateResponse, PlannedFlag, PlanResponse, PropertyInput } from "@vvl/shared";

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
  return `scenario-${Date.now()}-${Math.round(Math.random() * 100000)}`;
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
  if (plan.targetAssessment === "Unlikely" || estimate.confidenceRatio >= 0.18 || warnings.length >= 3) {
    return "High";
  }
  if (plan.targetAssessment === "Stretch" || estimate.confidenceRatio >= 0.14 || warnings.length > 0) {
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
  if (plan.targetAssessment === "Likely") {
    return "Shortlist";
  }
  if (plan.targetAssessment === "Unlikely") {
    return "Pass";
  }
  return "Watch";
}

function tagFromDeal(deal: DealAnalyzeResponse): ScenarioTag {
  if (deal.dealLabel === "Strong lead") {
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

function warningNotesFromPlan(plan: PlanResponse, estimate: EstimateResponse): string[] {
  const warnings: string[] = [];

  // These warnings are intentionally plain-language because they surface directly in the investor workspace.
  if (estimate.confidenceRatio >= 0.16) {
    warnings.push("Wide estimate confidence range");
  }
  if (plan.targetAssessment === "Stretch") {
    warnings.push("Target price is a stretch");
  }
  if (plan.targetAssessment === "Unlikely") {
    warnings.push("Target price looks unlikely");
  }
  if ((plan.plannedSpend ?? 0) <= 0) {
    warnings.push("No positive-value plan fit the current budget and timeline");
  }

  return warnings;
}

export function createPlanScenario(input: {
  property: PropertyInput;
  plannedFlags: PlannedFlag[];
  estimate: EstimateResponse;
  plan: PlanResponse;
  targetPrice: number;
  budget: number;
  timelineMonths: number;
}): ScenarioRecord {
  const warnings = warningNotesFromPlan(input.plan, input.estimate);
  const achievableValue = input.plan.achievableValue ?? input.estimate.baseValue;
  const plannedSpend = input.plan.plannedSpend ?? 0;
  const estimatedUpside = Math.round(achievableValue - input.estimate.baseValue);
  const upsidePercent = input.estimate.baseValue > 0 ? estimatedUpside / input.estimate.baseValue : 0;

  return {
    id: nowId(),
    createdAt: new Date().toISOString(),
    source: "plan",
    title: `${propertyLabel(input.property)} plan`,
    property: input.property,
    plannedFlags: input.plannedFlags,
    estimatedValue: Math.round(input.estimate.baseValue),
    achievableValue: Math.round(achievableValue),
    pricePerSqft: Math.round(input.estimate.pricePerSqft),
    targetPrice: input.targetPrice,
    budget: input.budget,
    timelineMonths: input.timelineMonths,
    plannedSpend,
    estimatedUpside,
    upsidePercent,
    verdict: input.plan.targetAssessment ?? "Needs review",
    riskLevel: riskFromPlan(input.plan, input.estimate, warnings),
    tag: tagFromPlan(input.plan),
    note: defaultNote(warnings),
    warnings,
    modelVersion: input.estimate.modelVersion,
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
    estimatedUpside: Math.round(input.deal.estimatedGrossUpside),
    upsidePercent: input.deal.grossUpsidePercent,
    verdict: input.deal.dealLabel,
    riskLevel: riskFromDeal(input.deal),
    tag: tagFromDeal(input.deal),
    note: defaultNote(warnings),
    warnings,
    modelVersion: input.deal.estimate.modelVersion,
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
