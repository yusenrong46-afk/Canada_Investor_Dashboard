import { detectMarket, improvementCatalog, type EstimateResponse, type PlannedFlag, type PlanLineItem, type PropertyInput } from "@vvl/shared";

import { buildHalifaxPublicEstimate } from "./halifaxEstimate";
import { buildVancouverPublicEstimate } from "./vancouverEstimate";
import { publicInputError, roundMoney } from "./utils";

export function buildPublicEstimate(property: PropertyInput) {
  const market = detectMarket(property.postalCode);

  if (market === "halifax_maritimes") {
    return buildHalifaxPublicEstimate(property);
  }
  if (market !== "vancouver") {
    throw publicInputError("Use a Vancouver postal code in the V5 or V6 area, or a Halifax / Maritimes postal code in the B area.", property.postalCode);
  }

  return buildVancouverPublicEstimate(property);
}

export function publicDataSources(estimate: EstimateResponse): Record<string, string> {
  if (estimate.market === "halifax_maritimes") {
    return {
      evidence: "data/exports/market_evidence.json",
      publicRules: "artifacts/api-server/src/public",
    };
  }
  return {
    modelSummary: "reports/model_metrics_report.md",
    publicRules: "artifacts/api-server/src/public",
  };
}

function improvementRate(flag: PlannedFlag, property: PropertyInput): number {
  const age = property.yearBuilt ? new Date().getFullYear() - property.yearBuilt : 35;

  if (flag === "renovatedKitchen") {
    return property.propertyType === "Condo" ? 0.06 : 0.045;
  }
  if (flag === "renovatedBathrooms") {
    return property.bathrooms <= 1 ? 0.04 : 0.032;
  }
  if (flag === "legalSuiteAdded") {
    return property.propertyType === "Detached" || property.propertyType === "Duplex" ? 0.08 : 0.025;
  }
  if (flag === "energyEfficient") {
    return age >= 40 ? 0.022 : 0.014;
  }
  if (flag === "deferredMaintenanceResolved") {
    return age >= 35 ? 0.045 : 0.025;
  }
  return age >= 35 ? 0.028 : 0.018;
}

export function buildLineItem(flag: PlannedFlag, property: PropertyInput, estimate: EstimateResponse, currentValue: number, orderIndex: number): PlanLineItem {
  const catalogItem = improvementCatalog[flag];
  const discount = Math.max(0.68, 1 - orderIndex * 0.1);
  const projectedUpliftPercent = improvementRate(flag, property) * discount;
  const projectedUplift = roundMoney(estimate.baseValue * projectedUpliftPercent);
  const projectedFinalValue = Math.min(currentValue + projectedUplift, estimate.marketContext.practicalCeiling);

  return {
    flag,
    label: catalogItem.label,
    phase: catalogItem.phase,
    cost: catalogItem.defaultCost,
    months: catalogItem.months,
    projectedUplift,
    projectedUpliftPercent,
    projectedFinalValue,
    valueRecoveryRate: catalogItem.defaultCost > 0 ? projectedUplift / catalogItem.defaultCost : 0,
  };
}

export function buildItemsForFlags(flags: PlannedFlag[], property: PropertyInput, estimate: EstimateResponse): PlanLineItem[] {
  let currentValue = estimate.baseValue;

  return flags.map((flag, index) => {
    const item = buildLineItem(flag, property, estimate, currentValue, index);
    currentValue = item.projectedFinalValue;
    return item;
  });
}
