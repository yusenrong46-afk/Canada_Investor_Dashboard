import { ZodError } from "zod/v4";

import type { EstimateResponse, PropertyInput, PropertyType } from "@vvl/shared";

import { loadMarketEvidence } from "../evidence";

export function publicEvidenceDataAsOf(): string | null {
  return loadMarketEvidence()?.generatedAt ?? null;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function roundMoney(value: number, nearest = 1_000): number {
  return Math.round(value / nearest) * nearest;
}

export function percent(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

export function cleanPostalCode(postalCode: string): string {
  return postalCode.toUpperCase().replace(/\s+/g, "");
}

export function getFsa(postalCode: string): string {
  return cleanPostalCode(postalCode).slice(0, 3);
}

// ZodError keeps app.ts mapping engine-level input problems to a 400.
export function publicInputError(message: string, postalCode: string): ZodError {
  return new ZodError([
    {
      code: "custom",
      path: ["postalCode"],
      message,
      input: postalCode,
    },
  ]);
}

export function expectedBedrooms(propertyType: PropertyType, sqft: number): number {
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

export function expectedBathrooms(propertyType: PropertyType, bedrooms: number): number {
  if (propertyType === "Condo") {
    return bedrooms <= 1 ? 1 : 2;
  }
  if (bedrooms <= 2) return 1.5;
  if (bedrooms <= 4) return 2.5;
  return 3.5;
}

export function ageAdjustment(property: PropertyInput): number {
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

export function unvalidatedScreeningQuality(missingnessNotes: string[]): EstimateResponse["modelQuality"] {
  return {
    trainingRows: 0,
    cvMae: null,
    cvMape: null,
    cvR2: null,
    holdoutMae: null,
    holdoutMape: null,
    holdoutR2: null,
    outlierRemovedRate: null,
    validationSummary: {
      trainHoldoutSplit: "Not applicable: this public rules estimator has no fitted train/holdout split.",
      crossValidation: "Not applicable: do not transfer live-model validation metrics to the public rules estimator.",
      bootstrap: "Not run for the public rules estimator.",
      bootstrapRanges: {
        mae: { mean: null, p05: null, p50: null, p95: null },
        mape: { mean: null, p05: null, p50: null, p95: null },
        r2: { mean: null, p05: null, p50: null, p95: null },
      },
      missingnessNotes,
      locationFeatures: "Transparent postal-area and property-input rules; not a fitted model.",
      clusterCount: 0,
    },
  };
}

export const PUBLIC_RULES_SOURCE = "artifacts/api-server/src/public";
