import { improvementCatalog } from "./data";
import type { SimulateRequest } from "./schemas";

type PlannedFlag = keyof typeof improvementCatalog;
type PropertyType = SimulateRequest["propertyType"];
type RuleConfidence = "high" | "medium" | "low";

interface EstimateContext {
  baseValue: number;
  marketContext: {
    localMedianValue: number;
    practicalCeiling: number;
    percentileRank: number;
  };
}

interface RuleDefinition {
  costRecoveryRate: number;
  valueCapRate: number;
  confidence: RuleConfidence;
  allowedPropertyTypes: readonly PropertyType[];
  propertyTypeMultipliers: Partial<Record<PropertyType, number>>;
  minimumTimelineMonths: number;
  evidenceNote: string;
}

interface RuleContribution {
  flag: PlannedFlag;
  label: string;
  value: number;
  confidence: RuleConfidence;
  rationale: string;
}

export interface RuleBasedSimulateResponse {
  status: "ready";
  modelVersion: string;
  trainingMode: string;
  modelFamily: "rule-based";
  evidenceLevel: "rule-based";
  evidenceSummary: string;
  baseValue: number;
  upliftValue: number;
  finalValueRaw: number;
  finalValueGuardrailed: number;
  upliftConfidenceLow: number;
  upliftConfidenceHigh: number;
  ceilingFlag: boolean;
  plannedFlags: PlannedFlag[];
  topUpliftDrivers: RuleContribution[];
  observedShare: number;
  dataSources: Record<string, string>;
  rowCounts: Record<string, number>;
  methodNotes: string[];
}

const RULE_MODEL_VERSION = "vancouver-rule-based-uplift-v1";
const RULE_TRAINING_MODE = "research-cost-recovery-plus-vancouver-feasibility";
const POOR_PROPERTY_FIT_DISCOUNT = 0.18;

// These are planning assumptions, not learned coefficients.
// costRecoveryRate means estimated resale value added per $1 spent.
const ruleDefinitions: Record<PlannedFlag, RuleDefinition> = {
  renovatedKitchen: {
    costRecoveryRate: 0.95,
    valueCapRate: 0.028,
    confidence: "medium",
    allowedPropertyTypes: ["Detached", "Townhouse", "Condo", "Duplex"],
    propertyTypeMultipliers: { Condo: 1.08, Townhouse: 1.0, Detached: 0.92, Duplex: 0.92 },
    minimumTimelineMonths: 2,
    evidenceNote: "Minor, broad-appeal kitchen refreshes tend to outperform highly personalized luxury remodels.",
  },
  renovatedBathrooms: {
    costRecoveryRate: 0.78,
    valueCapRate: 0.018,
    confidence: "medium",
    allowedPropertyTypes: ["Detached", "Townhouse", "Condo", "Duplex"],
    propertyTypeMultipliers: { Condo: 1.0, Townhouse: 0.98, Detached: 0.92, Duplex: 0.92 },
    minimumTimelineMonths: 2,
    evidenceNote: "Bathroom updates usually recover solid value when they remove obvious buyer objections.",
  },
  legalSuiteAdded: {
    costRecoveryRate: 1.08,
    valueCapRate: 0.075,
    confidence: "low",
    allowedPropertyTypes: ["Detached", "Duplex"],
    propertyTypeMultipliers: { Detached: 1.0, Duplex: 0.9, Townhouse: 0.15, Condo: 0 },
    minimumTimelineMonths: 6,
    evidenceNote: "A legal suite can add income value, but it is permit-heavy and feasibility depends on zoning, layout, and inspection.",
  },
  energyEfficient: {
    costRecoveryRate: 0.62,
    valueCapRate: 0.014,
    confidence: "medium",
    allowedPropertyTypes: ["Detached", "Townhouse", "Duplex"],
    propertyTypeMultipliers: { Detached: 0.95, Duplex: 0.9, Townhouse: 0.58, Condo: 0.25 },
    minimumTimelineMonths: 2,
    evidenceNote: "Energy work can reduce buyer concerns and may qualify for rebates, but resale premium varies by home type.",
  },
  curbAppealImproved: {
    costRecoveryRate: 1.12,
    valueCapRate: 0.018,
    confidence: "high",
    allowedPropertyTypes: ["Detached", "Townhouse", "Duplex"],
    propertyTypeMultipliers: { Detached: 1.0, Duplex: 0.95, Townhouse: 0.58, Condo: 0.16 },
    minimumTimelineMonths: 1,
    evidenceNote: "Exterior presentation and first-impression work has strong resale evidence, especially for ground-oriented homes.",
  },
  permitIssuesResolved: {
    costRecoveryRate: 0.9,
    valueCapRate: 0.012,
    confidence: "medium",
    allowedPropertyTypes: ["Detached", "Townhouse", "Condo", "Duplex"],
    propertyTypeMultipliers: { Detached: 1.0, Duplex: 1.0, Townhouse: 0.7, Condo: 0.62 },
    minimumTimelineMonths: 1,
    evidenceNote: "Resolving compliance issues usually prevents buyer discounts more than it creates a visible premium.",
  },
  deferredMaintenanceResolved: {
    costRecoveryRate: 0.95,
    valueCapRate: 0.024,
    confidence: "high",
    allowedPropertyTypes: ["Detached", "Townhouse", "Condo", "Duplex"],
    propertyTypeMultipliers: { Detached: 1.0, Duplex: 1.0, Townhouse: 0.82, Condo: 0.72 },
    minimumTimelineMonths: 2,
    evidenceNote: "Fixing obvious maintenance issues protects value because buyers price in risk and negotiation leverage.",
  },
  roofIssueResolved: {
    costRecoveryRate: 0.86,
    valueCapRate: 0.02,
    confidence: "high",
    allowedPropertyTypes: ["Detached", "Duplex"],
    propertyTypeMultipliers: { Detached: 1.0, Duplex: 0.92, Townhouse: 0.35, Condo: 0.1 },
    minimumTimelineMonths: 1,
    evidenceNote: "Roof and major systems work reduces inspection risk and supports stronger offers on ground-oriented homes.",
  },
};

function uniqueFlags(flags: PlannedFlag[] | undefined): PlannedFlag[] {
  const seen = new Set<PlannedFlag>();
  const unique: PlannedFlag[] = [];
  for (const flag of flags ?? []) {
    if (flag in improvementCatalog && !seen.has(flag)) {
      seen.add(flag);
      unique.push(flag);
    }
  }
  return unique;
}

function marketHeadroomMultiplier(baseValue: number, localMedian: number, percentileRank: number): number {
  if (baseValue < localMedian * 0.92 || percentileRank < 45) {
    return 1.08;
  }
  if (percentileRank > 85) {
    return 0.82;
  }
  if (percentileRank > 72) {
    return 0.92;
  }
  return 1.0;
}

function timelineMultiplier(horizonMonths: number, minimumTimelineMonths: number): number {
  if (horizonMonths >= minimumTimelineMonths) {
    return 1.0;
  }
  if (horizonMonths <= 1) {
    return 0.25;
  }
  return Math.max(0.35, horizonMonths / minimumTimelineMonths);
}

function confidenceBand(totalUplift: number, confidenceMix: RuleConfidence[]): { low: number; high: number } {
  if (totalUplift <= 0) {
    return { low: 0, high: 0 };
  }

  const hasLow = confidenceMix.includes("low");
  const hasMedium = confidenceMix.includes("medium");
  const lowMultiplier = hasLow ? 0.45 : hasMedium ? 0.62 : 0.78;
  const highMultiplier = hasLow ? 1.5 : hasMedium ? 1.32 : 1.16;

  return {
    low: Math.round(totalUplift * lowMultiplier),
    high: Math.round(totalUplift * highMultiplier),
  };
}

function contributionForFlag(
  flag: PlannedFlag,
  request: SimulateRequest,
  estimate: EstimateContext,
  horizonMonths: number,
): RuleContribution {
  const rule = ruleDefinitions[flag];
  const catalogItem = improvementCatalog[flag];
  const propertyMultiplier = rule.propertyTypeMultipliers[request.propertyType] ?? 0;
  const allowed = rule.allowedPropertyTypes.includes(request.propertyType);
  const applicabilityMultiplier = allowed ? 1 : POOR_PROPERTY_FIT_DISCOUNT;
  const marketMultiplier = marketHeadroomMultiplier(
    estimate.baseValue,
    estimate.marketContext.localMedianValue,
    estimate.marketContext.percentileRank,
  );
  const timeline = timelineMultiplier(horizonMonths, rule.minimumTimelineMonths);
  const rawValue =
    catalogItem.defaultCost *
    rule.costRecoveryRate *
    propertyMultiplier *
    applicabilityMultiplier *
    marketMultiplier *
    timeline;
  const cappedValue = Math.min(rawValue, estimate.baseValue * rule.valueCapRate);

  const timelineNote =
    timeline < 1
      ? ` Timeline is shorter than the usual ${rule.minimumTimelineMonths}-month planning window, so the effect is discounted.`
      : "";
  const applicabilityNote = allowed ? "" : ` This action is not a natural fit for a ${request.propertyType.toLowerCase()}, so the effect is heavily discounted.`;

  return {
    flag,
    label: catalogItem.label,
    value: Math.max(0, Math.round(cappedValue)),
    confidence: allowed ? rule.confidence : "low",
    rationale: `${rule.evidenceNote}${timelineNote}${applicabilityNote}`,
  };
}

function applyDiminishingReturns(contributions: RuleContribution[]): RuleContribution[] {
  const sorted = [...contributions].sort((left, right) => right.value - left.value);
  return sorted.map((item, index) => {
    const factor = index === 0 ? 1 : index === 1 ? 0.9 : index === 2 ? 0.8 : 0.7;
    return {
      ...item,
      value: Math.round(item.value * factor),
      rationale:
        factor < 1
          ? `${item.rationale} A portfolio discount is applied because multiple projects rarely add perfectly independently.`
          : item.rationale,
    };
  });
}

export function simulateRuleBasedUplift(request: SimulateRequest, estimate: EstimateContext): RuleBasedSimulateResponse {
  const plannedFlags = uniqueFlags(request.plannedFlags);
  const horizonMonths = request.horizonMonths ?? 9;
  const rawContributions = plannedFlags.map((flag) => contributionForFlag(flag, request, estimate, horizonMonths));
  const contributions = applyDiminishingReturns(rawContributions);
  const upliftValue = Math.round(contributions.reduce((sum, item) => sum + item.value, 0));
  const finalValueRaw = Math.round(estimate.baseValue + upliftValue);
  const practicalCeiling = Math.max(estimate.marketContext.practicalCeiling, estimate.baseValue * 1.03);
  const finalValueGuardrailed = Math.round(Math.min(finalValueRaw, practicalCeiling));
  const band = confidenceBand(upliftValue, contributions.map((item) => item.confidence));

  return {
    status: "ready",
    modelVersion: RULE_MODEL_VERSION,
    trainingMode: RULE_TRAINING_MODE,
    modelFamily: "rule-based",
    evidenceLevel: "rule-based",
    evidenceSummary: "Rule-based estimate from renovation cost-recovery research, Vancouver permit feasibility, property type fit, timeline, and local market ceiling.",
    baseValue: Math.round(estimate.baseValue),
    upliftValue,
    finalValueRaw,
    finalValueGuardrailed,
    upliftConfidenceLow: band.low,
    upliftConfidenceHigh: band.high,
    ceilingFlag: finalValueRaw > finalValueGuardrailed,
    plannedFlags,
    topUpliftDrivers: contributions.filter((item) => item.value > 0).slice(0, 5),
    observedShare: 0,
    dataSources: {
      costRecovery: "NerdWallet Canada renovation value guidance and Canadian contractor cost-recovery ranges",
      localFeasibility: "City of Vancouver renovation, building-permit, and secondary-suite guidance",
      vancouverMarket: "Vancouver contractor-published cost-recovery ranges for legal suites and targeted renovations",
      valuationAnchor: "Live Vancouver base-value model plus local practical ceiling",
    },
    rowCounts: {
      rules: Object.keys(ruleDefinitions).length,
      selectedRules: plannedFlags.length,
    },
    methodNotes: [
      "This is not a trained causal ML uplift model.",
      "The engine estimates resale uplift from cost-recovery rules, property-type fit, timeline feasibility, and local market headroom.",
      "Final values are capped by a practical local ceiling to reduce over-improvement fantasies.",
    ],
  };
}
