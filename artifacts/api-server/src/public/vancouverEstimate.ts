import { marketCatalog, resultProvenance, type EstimateResponse, type PropertyInput } from "@vvl/shared";

import { fsaProfiles, typeProfiles, getAreaProfile } from "./vancouverTables";
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

export function buildVancouverPublicEstimate(property: PropertyInput): EstimateResponse {
  const market = "vancouver" as const;
  const profile = typeProfiles[property.propertyType];
  const area = getAreaProfile(property.postalCode);
  if (!area) {
    throw publicInputError(
      `Public rules mode has no committed postal-area profile for ${getFsa(property.postalCode)}. Use live-model mode instead of applying a made-up east/west fallback.`,
      property.postalCode,
    );
  }
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
    provenance: resultProvenance({
      engineType: "rules",
      evidenceLevel: "assumption",
      validationStatus: "unvalidated",
      version: "public-interactive-screening-v1",
      dataAsOf: publicEvidenceDataAsOf(),
      sourceIds: ["data/exports/market_evidence.json", PUBLIC_RULES_SOURCE],
      limitations: ["Transparent screening rules; not a fitted model, appraisal, or calibrated prediction interval."],
    }),
    modelVersion: "public-interactive-screening-v1",
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
      localAreaLabel: area.label,
      localAreaScope: fsaProfiles[getFsa(property.postalCode)] ? "fsa" : "city-property-type",
      localMedianValue,
      localMedianPricePerSqft,
      cityMedianValue: profile.cityMedianValue,
      cityMedianPricePerSqft: profile.cityMedianPricePerSqft,
      vancouverMedianValue: profile.cityMedianValue,
      vancouverMedianPricePerSqft: profile.cityMedianPricePerSqft,
      percentileRank: Number(clamp(50 + ((baseValue - localMedianValue) / Math.max(localMedianValue, 1)) * 50, 5, 95).toFixed(1)),
      practicalCeiling: roundMoney(Math.max(baseValue, localMedianValue) * (property.propertyType === "Detached" ? 1.28 : 1.2)),
      premiumGap: roundMoney(baseValue - localMedianValue),
      comparableCount: area.comparableCount,
    },
    uncertainty: {
      method: "error-ratio",
      calibrationNote: "Heuristic screening band only; it has no calibrated coverage claim.",
    },
    explanationMethod: "heuristic",
    marketFreshness: {
      status: "not-applied",
      message: "Public interactive mode: estimates update from your inputs using a transparent screening model. It is not a live MLS feed or appraisal.",
    },
  };
}
