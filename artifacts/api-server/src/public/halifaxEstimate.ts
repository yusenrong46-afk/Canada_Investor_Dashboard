import { marketCatalog, resultProvenance, type EstimateResponse, type PropertyInput } from "@vvl/shared";

import { getEvidenceAreaProfile, type EvidenceAreaProfile } from "../marketProfiles";
import { typeProfiles } from "./vancouverTables";
import {
  ageAdjustment,
  clamp,
  expectedBathrooms,
  expectedBedrooms,
  getFsa,
  publicEvidenceDataAsOf,
  publicInputError,
  PUBLIC_RULES_SOURCE,
  roundMoney,
  unvalidatedScreeningQuality,
} from "./utils";

function evidenceContextScope(profile: EvidenceAreaProfile): EstimateResponse["marketContext"]["localAreaScope"] {
  if (profile.scope === "fsa-property-type" || profile.scope === "fsa") {
    return "fsa";
  }
  return profile.scope === "market-property-type" ? "city-property-type" : "city";
}

// Halifax public estimates are anchored to PVSC sale-price medians from the committed evidence export,
// then reuse the Vancouver engine's bedroom/bathroom/age adjustment flavor and error-ratio band.
export function buildHalifaxPublicEstimate(property: PropertyInput): EstimateResponse {
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
  if (evidenceContextScope(area) !== "fsa") {
    throw publicInputError(
      `Public rules mode has no committed Halifax evidence for postal FSA ${fsa}. No market-wide fallback estimate was produced.`,
      property.postalCode,
    );
  }

  // typeProfiles contributes only a conservative screening-band width; all price levels come from evidence rows.
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
    "Live Halifax model validation metrics are intentionally not assigned to this separate public rules estimator.",
    "Halifax evidence medians are time-adjusted sale prices, not listing prices.",
    property.yearBuilt ? "Year built was provided by the user." : "Year built was missing, so a small uncertainty penalty was applied.",
    "This public estimator is for screening and portfolio review, not appraisal or lending decisions.",
  ];

  return {
    provenance: resultProvenance({
      engineType: "rules",
      evidenceLevel: "mixed",
      validationStatus: "descriptive",
      version: "public-halifax-evidence-screening-v1",
      dataAsOf: publicEvidenceDataAsOf(),
      sourceIds: ["data/exports/market_evidence.json", PUBLIC_RULES_SOURCE],
      limitations: ["Observed market medians combined with heuristic property adjustments; not a fitted sale-price model."],
    }),
    modelVersion: "public-halifax-evidence-screening-v1",
    trainingMode: "public-interactive-estimator",
    modelFamily: "rules",
    modelScope: property.propertyType,
    market,
    marketLabel: marketCatalog[market].label,
    baseValue,
    confidenceLow: roundMoney(baseValue * (1 - confidenceRatio)),
    confidenceHigh: roundMoney(baseValue * (1 + confidenceRatio)),
    anchorValue: property.knownCurrentValue ? roundMoney(baseValue * 0.75 + property.knownCurrentValue * 0.25) : baseValue,
    pricePerSqft: Math.round(baseValue / sqft),
    confidenceRatio,
    modelQuality: unvalidatedScreeningQuality(missingnessNotes),
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
      percentileRank: Number(clamp(50 + ((baseValue - localMedianValue) / Math.max(localMedianValue, 1)) * 50, 5, 95).toFixed(1)),
      practicalCeiling: roundMoney(Math.max(baseValue, localMedianValue) * (property.propertyType === "Detached" ? 1.28 : 1.2)),
      premiumGap: roundMoney(baseValue - localMedianValue),
      comparableCount: area.comparableCount,
    },
    uncertainty: {
      method: "error-ratio",
      calibrationNote: "Heuristic screening band from evidence medians; it has no calibrated coverage claim.",
    },
    explanationMethod: "heuristic",
    marketFreshness: {
      status: "not-applied",
      message: "Public interactive mode: Halifax / Maritimes values come from committed PVSC evidence medians plus transparent adjustments. It is not a live MLS feed or appraisal.",
    },
  };
}
