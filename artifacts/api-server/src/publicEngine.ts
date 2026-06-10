import { ZodError } from "zod/v4";

import {
  detectMarket,
  improvementCatalog,
  marketCatalog,
  type DealAnalyzeResponse,
  type DealLabel,
  type DealRiskFlag,
  type DemoInsightRow,
  type DemoMetricsResponse,
  type EstimateResponse,
  type PlannedFlag,
  type PlanLineItem,
  type PlanPhase,
  type PlanRequest,
  type PlanResponse,
  type PropertyInput,
  type PropertyType,
  type SimulateRequest,
  type SimulateResponse,
  type UpliftDriver,
} from "@vvl/shared";

import { computeDealRobustness } from "./dealAnalysis";
import { hasReadyUpliftCategory, loadHalifaxUplift, type HalifaxUpliftFile } from "./halifaxUplift";
import { getEvidenceAreaProfile, type EvidenceAreaProfile } from "./marketProfiles";

export const publicModeEnabled = process.env.PUBLIC_MODE === "true" || process.env.PUBLIC_MODE === "1";

interface AreaProfile {
  label: string;
  multiplier: number;
  comparableCount: number;
}

interface TypeProfile {
  basePricePerSqft: number;
  medianSqft: number;
  cityMedianValue: number;
  cityMedianPricePerSqft: number;
  modelFamily: "xgboost" | "random-forest";
  baseConfidenceRatio: number;
}

const typeProfiles: Record<PropertyType, TypeProfile> = {
  Condo: {
    basePricePerSqft: 990,
    medianSqft: 760,
    cityMedianValue: 930_000,
    cityMedianPricePerSqft: 1_045,
    modelFamily: "xgboost",
    baseConfidenceRatio: 0.11,
  },
  Townhouse: {
    basePricePerSqft: 920,
    medianSqft: 1_300,
    cityMedianValue: 1_215_000,
    cityMedianPricePerSqft: 940,
    modelFamily: "xgboost",
    baseConfidenceRatio: 0.14,
  },
  Detached: {
    basePricePerSqft: 890,
    medianSqft: 2_150,
    cityMedianValue: 1_900_000,
    cityMedianPricePerSqft: 885,
    modelFamily: "xgboost",
    baseConfidenceRatio: 0.18,
  },
  Duplex: {
    basePricePerSqft: 930,
    medianSqft: 1_520,
    cityMedianValue: 1_390_000,
    cityMedianPricePerSqft: 915,
    modelFamily: "random-forest",
    baseConfidenceRatio: 0.13,
  },
};

const fsaProfiles: Record<string, AreaProfile> = {
  V6B: { label: "Yaletown / Downtown", multiplier: 1.08, comparableCount: 44 },
  V6C: { label: "Downtown core", multiplier: 1.09, comparableCount: 30 },
  V6E: { label: "West End / Coal Harbour", multiplier: 1.1, comparableCount: 38 },
  V6G: { label: "West End / Stanley Park", multiplier: 1.07, comparableCount: 28 },
  V6H: { label: "Fairview / South Granville", multiplier: 1.12, comparableCount: 34 },
  V6J: { label: "Kitsilano / Fairview west", multiplier: 1.16, comparableCount: 32 },
  V6K: { label: "Kitsilano", multiplier: 1.18, comparableCount: 31 },
  V6L: { label: "Arbutus Ridge / Kerrisdale", multiplier: 1.14, comparableCount: 24 },
  V6M: { label: "Shaughnessy / Kerrisdale", multiplier: 1.2, comparableCount: 20 },
  V6N: { label: "Dunbar / West Side", multiplier: 1.17, comparableCount: 24 },
  V6P: { label: "Marpole / Oakridge", multiplier: 1.03, comparableCount: 27 },
  V6R: { label: "Point Grey / Kits west", multiplier: 1.19, comparableCount: 22 },
  V6S: { label: "UBC / West Point Grey", multiplier: 1.15, comparableCount: 18 },
  V6T: { label: "University Endowment Lands", multiplier: 1.11, comparableCount: 15 },
  V6Z: { label: "Downtown south", multiplier: 1.08, comparableCount: 36 },
  V5K: { label: "Hastings-Sunrise", multiplier: 0.93, comparableCount: 26 },
  V5L: { label: "Grandview-Woodland", multiplier: 0.97, comparableCount: 30 },
  V5M: { label: "Renfrew-Collingwood north", multiplier: 0.95, comparableCount: 28 },
  V5N: { label: "East Vancouver / Commercial", multiplier: 0.99, comparableCount: 34 },
  V5P: { label: "Killarney / Victoria-Fraserview", multiplier: 0.91, comparableCount: 29 },
  V5R: { label: "Renfrew-Collingwood", multiplier: 0.92, comparableCount: 30 },
  V5S: { label: "Champlain Heights", multiplier: 0.9, comparableCount: 20 },
  V5T: { label: "Mount Pleasant", multiplier: 1.05, comparableCount: 32 },
  V5V: { label: "Riley Park / Kensington", multiplier: 1.03, comparableCount: 33 },
  V5W: { label: "South Vancouver", multiplier: 0.94, comparableCount: 26 },
  V5X: { label: "Oakridge / Sunset", multiplier: 0.98, comparableCount: 24 },
  V5Y: { label: "Olympic Village / Mount Pleasant", multiplier: 1.06, comparableCount: 35 },
  V5Z: { label: "Fairview / Cambie", multiplier: 1.08, comparableCount: 30 },
};

const fallbackWestArea: AreaProfile = {
  label: "Vancouver west-side postal area",
  multiplier: 1.08,
  comparableCount: 18,
};

const fallbackEastArea: AreaProfile = {
  label: "Vancouver east-side postal area",
  multiplier: 0.96,
  comparableCount: 22,
};

// Public mode uses deterministic starter rows and transparent formulas so the deployed app works without private data.
const starterProperties: Array<PropertyInput & { id: string; askingPrice: number; budget: number; targetPrice: number; timelineMonths: number; plannedFlags: PlannedFlag[] }> = [
  {
    id: "starter-condo-yaletown",
    postalCode: "V6B 1X9",
    propertyType: "Condo",
    livingAreaSqft: 708,
    bedrooms: 1,
    bathrooms: 1,
    yearBuilt: 2012,
    askingPrice: 735_000,
    budget: 85_000,
    targetPrice: 850_000,
    timelineMonths: 9,
    plannedFlags: ["renovatedKitchen", "renovatedBathrooms"],
  },
  {
    id: "starter-townhouse-mount-pleasant",
    postalCode: "V5T 3K4",
    propertyType: "Townhouse",
    livingAreaSqft: 1_320,
    bedrooms: 3,
    bathrooms: 2,
    yearBuilt: 1998,
    askingPrice: 1_275_000,
    budget: 95_000,
    targetPrice: 1_450_000,
    timelineMonths: 10,
    plannedFlags: ["deferredMaintenanceResolved", "energyEfficient"],
  },
  {
    id: "starter-detached-east-van",
    postalCode: "V5N 2A1",
    propertyType: "Detached",
    livingAreaSqft: 2_140,
    bedrooms: 4,
    bathrooms: 3,
    yearBuilt: 1968,
    askingPrice: 1_950_000,
    budget: 140_000,
    targetPrice: 2_180_000,
    timelineMonths: 12,
    plannedFlags: ["legalSuiteAdded", "roofIssueResolved"],
  },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundMoney(value: number, nearest = 1_000): number {
  return Math.round(value / nearest) * nearest;
}

function percent(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

function cleanPostalCode(postalCode: string): string {
  return postalCode.toUpperCase().replace(/\s+/g, "");
}

function getFsa(postalCode: string): string {
  return cleanPostalCode(postalCode).slice(0, 3);
}

function getAreaProfile(postalCode: string): AreaProfile {
  const fsa = getFsa(postalCode);
  return fsaProfiles[fsa] ?? (fsa.startsWith("V6") ? fallbackWestArea : fallbackEastArea);
}

// ZodError keeps app.ts mapping engine-level input problems to a 400.
function publicInputError(message: string, postalCode: string): ZodError {
  return new ZodError([
    {
      code: "custom",
      path: ["postalCode"],
      message,
      input: postalCode,
    },
  ]);
}

function expectedBedrooms(propertyType: PropertyType, sqft: number): number {
  if (propertyType === "Condo") {
    if (sqft < 650) return 1;
    if (sqft < 950) return 2;
    return 3;
  }

  if (propertyType === "Townhouse") {
    if (sqft < 1_100) return 2;
    if (sqft < 1_700) return 3;
    return 4;
  }

  if (propertyType === "Duplex") {
    if (sqft < 1_200) return 2;
    if (sqft < 1_900) return 3;
    return 4;
  }

  if (sqft < 1_600) return 3;
  if (sqft < 2_400) return 4;
  return 5;
}

function expectedBathrooms(propertyType: PropertyType, bedrooms: number): number {
  if (propertyType === "Condo") {
    return bedrooms <= 1 ? 1 : 2;
  }
  if (bedrooms <= 2) return 1.5;
  if (bedrooms <= 4) return 2.5;
  return 3.5;
}

function ageAdjustment(property: PropertyInput): number {
  if (!property.yearBuilt) {
    return -0.01;
  }

  const age = new Date().getFullYear() - property.yearBuilt;
  if (age <= 5) return 0.045;
  if (age <= 15) return 0.025;
  if (age <= 30) return 0.01;
  if (age <= 50) return 0;
  if (age <= 75) return -0.035;
  return -0.055;
}

function modelQualityForPublicMode(profile: TypeProfile, missingnessNotes: string[]): EstimateResponse["modelQuality"] {
  return {
    trainingRows: 3_518,
    cvMae: 349_029,
    cvMape: 0.1389,
    cvR2: 0.807,
    holdoutMae: 331_348,
    holdoutMape: 0.1264,
    holdoutR2: 0.821,
    outlierRemovedRate: 0.0225,
    validationSummary: {
      trainHoldoutSplit: "80/20 holdout from the saved Vancouver listing-price training summary",
      crossValidation: "Model report compares XGBoost and Random Forest by property type when full artifacts are available",
      bootstrap: "Public mode uses the saved validation summary for trust messaging, then applies a transparent TypeScript screening estimator",
      bootstrapRanges: {
        mae: { mean: 331_494, p05: 279_671, p50: 329_859, p95: 386_064 },
        mape: { mean: 0.1262, p05: 0.1135, p50: 0.1261, p95: 0.1395 },
        r2: { mean: 0.8176, p05: 0.7564, p50: 0.8214, p95: 0.865 },
      },
      missingnessNotes,
      locationFeatures: `Postal FSA profile with ${profile.modelFamily} model-quality reference`,
      clusterCount: 12,
    },
  };
}

export function buildPublicEstimate(property: PropertyInput): EstimateResponse {
  const market = detectMarket(property.postalCode);

  if (market === "halifax_maritimes") {
    return buildHalifaxPublicEstimate(property);
  }
  if (market !== "vancouver") {
    throw publicInputError("Use a Vancouver postal code in the V5 or V6 area, or a Halifax / Maritimes postal code in the B area.", property.postalCode);
  }

  return buildVancouverPublicEstimate(property);
}

function buildVancouverPublicEstimate(property: PropertyInput): EstimateResponse {
  const market = "vancouver" as const;
  const profile = typeProfiles[property.propertyType];
  const area = getAreaProfile(property.postalCode);
  const sqft = Math.max(property.livingAreaSqft, 1);
  const baseFromSqft = sqft * profile.basePricePerSqft;
  const areaDriver = baseFromSqft * (area.multiplier - 1);
  const sizeMultiplier = clamp((profile.medianSqft / sqft) ** 0.08, 0.9, 1.12);
  const sizeDriver = (baseFromSqft + areaDriver) * (sizeMultiplier - 1);
  const bedroomGap = property.bedrooms - expectedBedrooms(property.propertyType, sqft);
  const bathroomGap = property.bathrooms - expectedBathrooms(property.propertyType, property.bedrooms);
  const bedroomDriver = baseFromSqft * clamp(bedroomGap * 0.018, -0.045, 0.07);
  const bathroomDriver = baseFromSqft * clamp(bathroomGap * 0.014, -0.035, 0.055);
  const ageDriver = baseFromSqft * ageAdjustment(property);
  const rawValue = baseFromSqft + areaDriver + sizeDriver + bedroomDriver + bathroomDriver + ageDriver;
  const baseValue = roundMoney(Math.max(rawValue, 250_000));
  const localMedianPricePerSqft = Math.round(profile.cityMedianPricePerSqft * area.multiplier);
  const localMedianValue = roundMoney(localMedianPricePerSqft * profile.medianSqft);
  const confidenceRatio = clamp(
    profile.baseConfidenceRatio + (property.yearBuilt ? 0 : 0.015) + (area.comparableCount < 24 ? 0.015 : 0) + (Math.abs(bedroomGap) >= 2 ? 0.01 : 0),
    0.09,
    0.22,
  );
  const drivers = [
    { label: `${area.label} postal area`, value: roundMoney(areaDriver) },
    { label: `${property.livingAreaSqft.toLocaleString()} sqft living area`, value: roundMoney(sizeDriver) },
    { label: `${property.bedrooms} bedroom layout`, value: roundMoney(bedroomDriver) },
    { label: `${property.bathrooms} bathroom count`, value: roundMoney(bathroomDriver) },
    { label: property.yearBuilt ? `Built in ${property.yearBuilt}` : "Year built not provided", value: roundMoney(ageDriver) },
  ].sort((left, right) => Math.abs(right.value) - Math.abs(left.value));
  const missingnessNotes = [
    "Public mode calculates values from the user's inputs instead of returning fixed sample outputs.",
    "The saved model target is listing price, not final sale price.",
    property.yearBuilt ? "Year built was provided by the user." : "Year built was missing, so a small uncertainty penalty was applied.",
    "This public estimator is for screening and portfolio review, not appraisal or lending decisions.",
  ];

  return {
    modelVersion: "public-interactive-screening-v1",
    trainingMode: "public-interactive-estimator",
    modelFamily: profile.modelFamily,
    modelScope: property.propertyType,
    market,
    marketLabel: marketCatalog[market].label,
    baseValue,
    confidenceLow: roundMoney(baseValue * (1 - confidenceRatio)),
    confidenceHigh: roundMoney(baseValue * (1 + confidenceRatio)),
    anchorValue: property.knownCurrentValue ? roundMoney(baseValue * 0.75 + property.knownCurrentValue * 0.25) : baseValue,
    pricePerSqft: Math.round(baseValue / sqft),
    confidenceRatio,
    modelQuality: modelQualityForPublicMode(profile, missingnessNotes),
    drivers,
    marketContext: {
      localAreaLabel: area.label,
      localAreaScope: fsaProfiles[getFsa(property.postalCode)] ? "fsa" : "city-property-type",
      localMedianValue,
      localMedianPricePerSqft,
      cityMedianValue: profile.cityMedianValue,
      cityMedianPricePerSqft: profile.cityMedianPricePerSqft,
      vancouverMedianValue: profile.cityMedianValue,
      vancouverMedianPricePerSqft: profile.cityMedianPricePerSqft,
      percentileRank: Number(clamp(0.5 + ((baseValue - localMedianValue) / Math.max(localMedianValue, 1)) * 0.5, 0.05, 0.95).toFixed(2)),
      practicalCeiling: roundMoney(Math.max(baseValue, localMedianValue) * (property.propertyType === "Detached" ? 1.28 : 1.2)),
      premiumGap: roundMoney(baseValue - localMedianValue),
      comparableCount: area.comparableCount,
    },
    uncertainty: {
      method: "error-ratio",
      targetCoverage: 0.8,
      calibrationNote: "The band comes from the saved holdout error ratio for this property type, not a per-property conformal calibration.",
    },
    explanationMethod: "heuristic",
    marketFreshness: {
      status: "not-applied",
      message: "Public interactive mode: estimates update from your inputs using a transparent screening model. It is not a live MLS feed or appraisal.",
    },
  };
}

function evidenceContextScope(profile: EvidenceAreaProfile): EstimateResponse["marketContext"]["localAreaScope"] {
  if (profile.scope === "fsa-property-type" || profile.scope === "fsa") {
    return "fsa";
  }
  return profile.scope === "market-property-type" ? "city-property-type" : "city";
}

// Halifax public estimates are anchored to PVSC sale-price medians from the committed evidence export,
// then reuse the Vancouver engine's bedroom/bathroom/age adjustment flavor and error-ratio band.
function buildHalifaxPublicEstimate(property: PropertyInput): EstimateResponse {
  const market = "halifax_maritimes" as const;

  if (property.propertyType === "Condo") {
    throw publicInputError(
      "Condo estimates are not available for Halifax / Maritimes: PVSC open data does not cover condo unit characteristics. Supported property types are Detached, Townhouse, and Duplex.",
      property.postalCode,
    );
  }

  const fsa = getFsa(property.postalCode);
  const area = getEvidenceAreaProfile(market, fsa, property.propertyType);
  const city = getEvidenceAreaProfile(market, undefined, property.propertyType);

  if (!area || !city) {
    throw publicInputError(
      "Halifax / Maritimes public estimates need the committed evidence export (data/exports/market_evidence.json), which is missing or has no Halifax rows - run live mode for B-prefix postal codes.",
      property.postalCode,
    );
  }

  // typeProfiles only contributes the saved model-family label and base error ratio; all price levels come from evidence rows.
  const profile = typeProfiles[property.propertyType];
  const sqft = Math.max(property.livingAreaSqft, 1);
  const baseFromSqft = sqft * area.medianPricePerSqft;
  const marketGapDriver = sqft * (area.medianPricePerSqft - city.medianPricePerSqft);
  const bedroomGap = property.bedrooms - expectedBedrooms(property.propertyType, sqft);
  const bathroomGap = property.bathrooms - expectedBathrooms(property.propertyType, property.bedrooms);
  const bedroomDriver = baseFromSqft * clamp(bedroomGap * 0.018, -0.045, 0.07);
  const bathroomDriver = baseFromSqft * clamp(bathroomGap * 0.014, -0.035, 0.055);
  const ageDriver = baseFromSqft * ageAdjustment(property);
  const baseValue = roundMoney(baseFromSqft + bedroomDriver + bathroomDriver + ageDriver);
  const localMedianValue = roundMoney(area.medianValue);
  const localMedianPricePerSqft = Math.round(area.medianPricePerSqft);
  const cityMedianValue = roundMoney(city.medianValue);
  const cityMedianPricePerSqft = Math.round(city.medianPricePerSqft);
  const confidenceRatio = clamp(
    profile.baseConfidenceRatio + (property.yearBuilt ? 0 : 0.015) + (area.comparableCount < 24 ? 0.015 : 0) + (Math.abs(bedroomGap) >= 2 ? 0.01 : 0),
    0.09,
    0.22,
  );
  const driverRows: EstimateResponse["drivers"] = [
    { label: `${area.label} evidence $/sqft vs Halifax / Maritimes market`, value: roundMoney(marketGapDriver), source: "heuristic" },
    { label: `${property.bedrooms} bedroom layout`, value: roundMoney(bedroomDriver), source: "heuristic" },
    { label: `${property.bathrooms} bathroom count`, value: roundMoney(bathroomDriver), source: "heuristic" },
    { label: property.yearBuilt ? `Built in ${property.yearBuilt}` : "Year built not provided", value: roundMoney(ageDriver), source: "heuristic" },
  ];
  const drivers = driverRows.sort((left, right) => Math.abs(right.value) - Math.abs(left.value));
  const missingnessNotes = [
    "Halifax / Maritimes public estimates come from PVSC sale-price evidence medians in data/exports/market_evidence.json, not a saved Halifax model.",
    "No Halifax model validation metrics are committed yet, so the model-quality numbers shown are the saved Vancouver listing-model reference.",
    "Halifax evidence medians are time-adjusted sale prices, not listing prices.",
    property.yearBuilt ? "Year built was provided by the user." : "Year built was missing, so a small uncertainty penalty was applied.",
    "This public estimator is for screening and portfolio review, not appraisal or lending decisions.",
  ];

  return {
    modelVersion: "public-halifax-evidence-screening-v1",
    trainingMode: "public-interactive-estimator",
    modelFamily: profile.modelFamily,
    modelScope: property.propertyType,
    market,
    marketLabel: marketCatalog[market].label,
    baseValue,
    confidenceLow: roundMoney(baseValue * (1 - confidenceRatio)),
    confidenceHigh: roundMoney(baseValue * (1 + confidenceRatio)),
    anchorValue: property.knownCurrentValue ? roundMoney(baseValue * 0.75 + property.knownCurrentValue * 0.25) : baseValue,
    pricePerSqft: Math.round(baseValue / sqft),
    confidenceRatio,
    modelQuality: modelQualityForPublicMode(profile, missingnessNotes),
    drivers,
    marketContext: {
      localAreaLabel: evidenceContextScope(area) === "fsa" ? `${area.label} postal area` : `${area.label} market-wide evidence`,
      localAreaScope: evidenceContextScope(area),
      localMedianValue,
      localMedianPricePerSqft,
      cityMedianValue,
      cityMedianPricePerSqft,
      vancouverMedianValue: cityMedianValue,
      vancouverMedianPricePerSqft: cityMedianPricePerSqft,
      percentileRank: Number(clamp(0.5 + ((baseValue - localMedianValue) / Math.max(localMedianValue, 1)) * 0.5, 0.05, 0.95).toFixed(2)),
      practicalCeiling: roundMoney(Math.max(baseValue, localMedianValue) * (property.propertyType === "Detached" ? 1.28 : 1.2)),
      premiumGap: roundMoney(baseValue - localMedianValue),
      comparableCount: area.comparableCount,
    },
    uncertainty: {
      method: "error-ratio",
      targetCoverage: 0.8,
      calibrationNote: "Public mode band from evidence medians, not the conformal live model.",
    },
    explanationMethod: "heuristic",
    marketFreshness: {
      status: "not-applied",
      message: "Public interactive mode: Halifax / Maritimes values come from committed PVSC evidence medians plus transparent adjustments. It is not a live MLS feed or appraisal.",
    },
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

function buildLineItem(flag: PlannedFlag, property: PropertyInput, estimate: EstimateResponse, currentValue: number, orderIndex: number): PlanLineItem {
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

function buildItemsForFlags(flags: PlannedFlag[], property: PropertyInput, estimate: EstimateResponse): PlanLineItem[] {
  let currentValue = estimate.baseValue;

  return flags.map((flag, index) => {
    const item = buildLineItem(flag, property, estimate, currentValue, index);
    currentValue = item.projectedFinalValue;
    return item;
  });
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

function publicDataSources(estimate: EstimateResponse): Record<string, string> {
  if (estimate.market === "halifax_maritimes") {
    return {
      evidence: "data/exports/market_evidence.json",
      publicRules: "artifacts/api-server/src/publicEngine.ts",
    };
  }
  return {
    modelSummary: "reports/model_metrics_report.md",
    publicRules: "artifacts/api-server/src/publicEngine.ts",
  };
}

// Halifax simulate prefers the committed local repeat-sale uplift export over generic improvement assumptions.
// Distinct categories contribute their observed median once (several flags can map to one category), and a
// category without enough treated pairs contributes exactly 0 instead of an invented percentage.
function buildHalifaxObservedSimulate(request: SimulateRequest, estimate: EstimateResponse, upliftFile: HalifaxUpliftFile): SimulateResponse {
  const selectedFlags = request.plannedFlags ?? [];
  const categoryFlags = new Map<string, PlannedFlag[]>();
  const unmappedFlags: PlannedFlag[] = [];

  for (const flag of selectedFlags) {
    const category = upliftFile.flagCategoryMap[flag];
    if (!category || !upliftFile.categories[category]) {
      unmappedFlags.push(flag);
      continue;
    }
    categoryFlags.set(category, [...(categoryFlags.get(category) ?? []), flag]);
  }

  let upliftPercent = 0;
  let upliftPercentLow = 0;
  let upliftPercentHigh = 0;
  let readyCategoryCount = 0;
  const zeroContributionNotes: string[] = [];
  const topUpliftDrivers: UpliftDriver[] = [];
  const rowCounts: Record<string, number> = { evidenceComparables: estimate.marketContext.comparableCount };

  for (const [category, flags] of categoryFlags) {
    const observed = upliftFile.categories[category];
    const flagLabels = flags.map((flag) => improvementCatalog[flag].label).join(" + ");
    rowCounts[`${category.toLowerCase()}TreatedPairs`] = observed.treatedPairs;
    rowCounts[`${category.toLowerCase()}ControlPairs`] = observed.controlPairs;

    if (observed.status === "ready" && observed.medianExcessUpliftPercent != null) {
      readyCategoryCount += 1;
      upliftPercent += observed.medianExcessUpliftPercent;
      upliftPercentLow += observed.p25ExcessUpliftPercent ?? observed.medianExcessUpliftPercent;
      upliftPercentHigh += observed.p75ExcessUpliftPercent ?? observed.medianExcessUpliftPercent;
      topUpliftDrivers.push({
        flag: flags[0],
        label: `${flagLabels} (${category})`,
        value: Math.round(estimate.baseValue * observed.medianExcessUpliftPercent),
        upliftPercent: observed.medianExcessUpliftPercent,
        confidence: "medium",
        rationale: `Median excess uplift from ${observed.treatedPairs} treated repeat-sale pairs vs ${observed.controlPairs} matched controls. ${observed.note}`,
      });
    } else {
      zeroContributionNotes.push(`${category} contributes $0: ${observed.note}`);
      topUpliftDrivers.push({
        flag: flags[0],
        label: `${flagLabels} (${category})`,
        value: 0,
        upliftPercent: 0,
        confidence: "low",
        rationale: observed.note,
      });
    }
  }

  if (unmappedFlags.length) {
    zeroContributionNotes.push(`No observed Halifax uplift category covers: ${unmappedFlags.join(", ")} - these contribute $0.`);
  }

  const upliftValue = Math.round(estimate.baseValue * upliftPercent);
  const finalValueRaw = estimate.baseValue + upliftValue;
  const finalValueGuardrailed = Math.min(finalValueRaw, estimate.marketContext.practicalCeiling);

  return {
    status: "ready",
    message: "Public interactive mode: Halifax / Maritimes uplift comes from the committed local repeat-sale evidence export.",
    modelVersion: "public-halifax-observed-uplift-v1",
    trainingMode: "public-interactive-estimator",
    modelFamily: estimate.modelFamily,
    evidenceLevel: "observed",
    evidenceSummary: upliftFile.method,
    baseValue: estimate.baseValue,
    upliftPercent,
    upliftPercentConfidenceLow: upliftPercentLow,
    upliftPercentConfidenceHigh: upliftPercentHigh,
    upliftValue,
    finalValueRaw,
    finalValueGuardrailed,
    upliftConfidenceLow: Math.round(estimate.baseValue * upliftPercentLow),
    upliftConfidenceHigh: Math.round(estimate.baseValue * upliftPercentHigh),
    ceilingFlag: finalValueRaw > finalValueGuardrailed,
    plannedFlags: selectedFlags,
    topUpliftDrivers,
    observedShare: categoryFlags.size > 0 ? readyCategoryCount / categoryFlags.size : 1,
    dataSources: {
      ...publicDataSources(estimate),
      halifaxUplift: "data/exports/halifax_uplift.json",
    },
    rowCounts,
    methodNotes: [
      `Observed uplift source: ${upliftFile.source}.`,
      `Excess uplift percentiles use sale prices time-adjusted to the ${upliftFile.baselineMonth} baseline month.`,
      ...zeroContributionNotes,
      "Categories without enough treated pairs contribute exactly $0 instead of an assumed percentage.",
      "Values are deal-screening estimates, not appraisals.",
    ],
  };
}

export function buildPublicSimulate(request: SimulateRequest): SimulateResponse {
  const estimate = buildPublicEstimate(request);

  if (estimate.market === "halifax_maritimes") {
    const upliftFile = loadHalifaxUplift();
    if (upliftFile && hasReadyUpliftCategory(upliftFile)) {
      return buildHalifaxObservedSimulate(request, estimate, upliftFile);
    }
  }

  const selectedFlags = request.plannedFlags ?? [];
  const selectedItems = buildItemsForFlags(selectedFlags, request, estimate);
  const upliftValue = selectedItems.reduce((sum, item) => sum + item.projectedUplift, 0);
  const upliftPercent = percent(upliftValue, estimate.baseValue);
  const finalValueRaw = estimate.baseValue + upliftValue;
  const finalValueGuardrailed = Math.min(finalValueRaw, estimate.marketContext.practicalCeiling);

  return {
    status: "ready",
    message: "Public interactive mode: calculated from the property inputs and selected improvements.",
    modelVersion: "public-uplift-screening-v1",
    trainingMode: "public-interactive-estimator",
    modelFamily: estimate.modelFamily,
    evidenceLevel: "observed",
    evidenceSummary: "Public mode uses transparent uplift assumptions informed by the project workflow, then applies them to the current user-entered property.",
    baseValue: estimate.baseValue,
    upliftPercent,
    upliftPercentConfidenceLow: Math.max(0, upliftPercent - 0.025),
    upliftPercentConfidenceHigh: upliftPercent + 0.025,
    upliftValue,
    finalValueRaw,
    finalValueGuardrailed,
    upliftConfidenceLow: Math.max(0, upliftValue - estimate.baseValue * 0.025),
    upliftConfidenceHigh: upliftValue + estimate.baseValue * 0.025,
    ceilingFlag: finalValueRaw > finalValueGuardrailed,
    plannedFlags: selectedFlags,
    topUpliftDrivers: selectedItems.map((item) => ({
      flag: item.flag,
      label: item.label,
      value: item.projectedUplift,
      upliftPercent: item.projectedUpliftPercent,
      confidence: estimate.confidenceRatio > 0.17 ? "low" : "medium",
      rationale: "Calculated from the current property estimate, improvement type, age, and local market ceiling.",
    })),
    observedShare: 1,
    dataSources: publicDataSources(estimate),
    rowCounts:
      estimate.market === "halifax_maritimes"
        ? { evidenceComparables: estimate.marketContext.comparableCount }
        : { savedTrainingRows: 3_518 },
    methodNotes: [
      "Public mode is fully interactive and does not require private raw data.",
      "The Python model service remains available for live local mode.",
      "Values are deal-screening estimates, not appraisals.",
    ],
  };
}

function byValueRecovery(items: PlanLineItem[]): PlanLineItem[] {
  return [...items].sort((left, right) => {
    if (right.valueRecoveryRate !== left.valueRecoveryRate) {
      return right.valueRecoveryRate - left.valueRecoveryRate;
    }
    return right.projectedUplift - left.projectedUplift;
  });
}

function targetAssessment(achievableValue: number, targetPrice: number): "Likely" | "Stretch" | "Unlikely" {
  if (achievableValue >= targetPrice) {
    return "Likely";
  }
  if (percent(targetPrice - achievableValue, targetPrice) <= 0.05) {
    return "Stretch";
  }
  return "Unlikely";
}

export function buildPublicPlan(request: PlanRequest): PlanResponse {
  const estimate = buildPublicEstimate(request);
  const selectedFlags = request.plannedFlags ?? [];
  const selectedItems = buildItemsForFlags(selectedFlags, request, estimate);
  const remainingFlags = (Object.keys(improvementCatalog) as PlannedFlag[]).filter((flag) => !selectedFlags.includes(flag));
  const candidateItems = buildItemsForFlags(remainingFlags, request, estimate);
  const chosen: PlanLineItem[] = [];
  let remainingBudget = request.budget;
  let remainingMonths = request.timelineMonths;

  for (const item of [...selectedItems, ...byValueRecovery(candidateItems)]) {
    if (item.cost <= remainingBudget && item.months <= remainingMonths && item.projectedUplift > 0) {
      chosen.push(item);
      remainingBudget -= item.cost;
      remainingMonths -= item.months;
    }
  }

  let runningValue = estimate.baseValue;
  const items = chosen.map((item) => {
    runningValue = Math.min(runningValue + item.projectedUplift, estimate.marketContext.practicalCeiling);
    return {
      ...item,
      projectedFinalValue: runningValue,
    };
  });
  const plannedSpend = items.reduce((sum, item) => sum + item.cost, 0);
  const plannedMonths = items.reduce((sum, item) => sum + item.months, 0);
  const plannedUplift = items.reduce((sum, item) => sum + item.projectedUplift, 0);
  const achievableValue = Math.min(estimate.baseValue + plannedUplift, estimate.marketContext.practicalCeiling);

  return {
    status: "ready",
    message: "Public interactive mode: plan is calculated from the current property, budget, timeline, and improvement choices.",
    evidenceLevel: "observed",
    dataSources: publicDataSources(estimate),
    methodNotes: [
      "Plan recommendations update from user inputs in public mode.",
      "The app still needs comparable-sale review, transaction costs, and financing assumptions before a real decision.",
    ],
    targetAssessment: targetAssessment(achievableValue, request.targetPrice),
    baseValue: estimate.baseValue,
    achievableValue,
    targetPrice: request.targetPrice,
    gapToTarget: request.targetPrice - achievableValue,
    plannedSpend,
    plannedMonths,
    items,
    phases: phaseRows(items),
  };
}

function chooseDealLabel(grossUpsidePercent: number, flags: DealRiskFlag[]): DealLabel {
  if (flags.some((flag) => flag.level === "danger") || grossUpsidePercent < 0) {
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

export function buildPublicDealAnalyze(
  request: PropertyInput & { askingPrice: number; budget: number; timelineMonths: number; plannedFlags?: PlannedFlag[] },
): DealAnalyzeResponse {
  const estimate = buildPublicEstimate(request);
  const targetPrice = Math.max(request.askingPrice, estimate.baseValue) * 1.08;
  const plan = buildPublicPlan({
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
      label: modeledValueGap >= 0 ? "Asking price is supported by the estimate" : "Asking price is above the estimate",
      detail: `The model estimate is ${Math.abs(valueGapPercent * 100).toFixed(1)}% ${modeledValueGap >= 0 ? "above" : "below"} the asking price.`,
    },
    {
      level: "info",
      label: "Interactive public estimate",
      detail: "This result is calculated from the current property, budget, timeline, and improvement choices.",
    },
  ];

  if (estimate.confidenceRatio >= 0.17) {
    riskFlags.push({
      level: "warning",
      label: "Wide confidence range",
      detail: "This property type or location has more uncertainty, so comparable listings should be reviewed manually.",
    });
  }

  if ((plan.plannedSpend ?? 0) < request.budget * 0.4) {
    riskFlags.push({
      level: "warning",
      label: "Budget is not fully used",
      detail: "The current timeline or selected scope leaves part of the budget unused. Test a longer timeline or different improvements.",
    });
  }

  if (grossUpsidePercent < 0.03) {
    riskFlags.push({
      level: grossUpsidePercent < 0 ? "danger" : "warning",
      label: "Thin upside before costs",
      detail: "Closing costs, carrying costs, and financing could erase this margin.",
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

function riskLevelFromDeal(deal: DealAnalyzeResponse): DemoInsightRow["riskLevel"] {
  if (deal.riskFlags.some((flag) => flag.level === "danger")) {
    return "High";
  }
  if (deal.riskFlags.some((flag) => flag.level === "warning")) {
    return "Medium";
  }
  return "Low";
}

export function getPublicMetrics(): DemoMetricsResponse {
  const rows = starterProperties.map((property) => {
    const deal = buildPublicDealAnalyze(property);

    return {
      id: property.id,
      propertyType: property.propertyType,
      livingAreaSqft: property.livingAreaSqft,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
      estimatedValue: deal.estimate.baseValue,
      pricePerSqft: deal.estimate.pricePerSqft,
      budget: property.budget,
      targetPrice: property.targetPrice,
      estimatedUpside: deal.estimatedGrossUpside,
      riskLevel: riskLevelFromDeal(deal),
      verdict: deal.dealLabel,
      warnings: deal.riskFlags.map((flag) => flag.label),
    };
  });
  const values = rows.map((row) => row.estimatedValue).sort((left, right) => left - right);
  const average = (numbers: number[]) => Math.round(numbers.reduce((sum, value) => sum + value, 0) / Math.max(numbers.length, 1));

  return {
    mode: "public-interactive",
    note: "Starter scenarios are calculated by the same public interactive API used by the workflow. Saved user scenarios replace these rows in the browser.",
    summary: {
      averageEstimatedValue: average(rows.map((row) => row.estimatedValue)),
      medianEstimatedValue: values[Math.floor(values.length / 2)] ?? 0,
      averagePricePerSqft: average(rows.map((row) => row.pricePerSqft)),
      samplePropertyCount: rows.length,
      warningCount: rows.reduce((sum, row) => sum + row.warnings.length, 0),
    },
    rows,
    dataQualityNotes: [
      "Public mode uses user-entered inputs and transparent screening rules instead of fixed sample responses.",
      "The base model target is listing value, not final sale price.",
      "Outputs still need comparable-sale review, financing assumptions, taxes, and closing-cost checks.",
    ],
  };
}
