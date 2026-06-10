import { describe, expect, it } from "vitest";

import type { MarketEvidenceFile } from "@vvl/shared";

import { buildDemoEstimate } from "./demo";
import { evidenceRelativePath } from "./evidence";
import { buildPublicDealAnalyze, buildPublicEstimate, buildPublicPlan, buildPublicSimulate } from "./publicEngine";
import { readRepoJson } from "./repoFiles";

const evidence = readRepoJson<MarketEvidenceFile>(evidenceRelativePath);
const halifaxRows = evidence.rows.filter((row) => row.marketId === "halifax_maritimes");
const b3hDetached = halifaxRows.find((row) => row.postalFsa === "B3H" && row.propertyType === "Detached");

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function roundMoney(value: number): number {
  return Math.round(value / 1_000) * 1_000;
}

// Bedrooms, bathrooms, and age are chosen so every engine adjustment is exactly zero:
// 2,000 sqft Detached expects 4 bedrooms / 2.5 bathrooms, and a 40-year-old home gets a 0 age adjustment.
const neutralHalifaxProperty = {
  postalCode: "B3H 1A1",
  propertyType: "Detached" as const,
  livingAreaSqft: 2_000,
  bedrooms: 4,
  bathrooms: 2.5,
  yearBuilt: new Date().getFullYear() - 40,
};

describe("Halifax public estimate traceability", () => {
  it("anchors baseValue to the committed B3H Detached evidence median $/sqft", () => {
    expect(b3hDetached?.medianPricePerSqft).not.toBeNull();
    const response = buildPublicEstimate(neutralHalifaxProperty);
    const expectedBase = roundMoney((b3hDetached?.medianPricePerSqft ?? 0) * neutralHalifaxProperty.livingAreaSqft);

    expect(Math.abs(response.baseValue - expectedBase)).toBeLessThanOrEqual(1_000);
    expect(response.market).toBe("halifax_maritimes");
    expect(response.marketLabel).toBe("Halifax / Maritimes");
    expect(response.marketContext.localAreaScope).toBe("fsa");
    expect(response.marketContext.localAreaLabel).toContain("B3H");
    expect(response.marketContext.localMedianValue).toBe(roundMoney(b3hDetached?.medianValue ?? 0));
    expect(response.marketContext.comparableCount).toBe(b3hDetached?.trainingRows);
  });

  it("derives city medians from the market-wide Detached evidence rows and mirrors the deprecated aliases", () => {
    const response = buildPublicEstimate(neutralHalifaxProperty);
    const detachedRows = halifaxRows.filter((row) => row.propertyType === "Detached");
    const expectedCityMedianValue = roundMoney(median(detachedRows.map((row) => row.medianValue).filter((value): value is number => value != null)));
    const expectedCityMedianPricePerSqft = Math.round(median(detachedRows.map((row) => row.medianPricePerSqft).filter((value): value is number => value != null)));

    expect(response.marketContext.cityMedianValue).toBe(expectedCityMedianValue);
    expect(response.marketContext.cityMedianPricePerSqft).toBe(expectedCityMedianPricePerSqft);
    expect(response.marketContext.vancouverMedianValue).toBe(response.marketContext.cityMedianValue);
    expect(response.marketContext.vancouverMedianPricePerSqft).toBe(response.marketContext.cityMedianPricePerSqft);
  });

  it("reports an error-ratio band and heuristic drivers, never SHAP or conformal claims", () => {
    const response = buildPublicEstimate(neutralHalifaxProperty);

    expect(response.uncertainty).toEqual({
      method: "error-ratio",
      targetCoverage: 0.8,
      calibrationNote: "Public mode band from evidence medians, not the conformal live model.",
    });
    expect(response.explanationMethod).toBe("heuristic");
    expect(response.drivers.length).toBeGreaterThan(0);
    expect(response.drivers.every((driver) => driver.source === "heuristic")).toBe(true);
    expect(response.confidenceLow).toBe(roundMoney(response.baseValue * (1 - response.confidenceRatio)));
    expect(response.confidenceHigh).toBe(roundMoney(response.baseValue * (1 + response.confidenceRatio)));
  });

  it("applies the bedroom adjustment on top of the evidence anchor", () => {
    const neutral = buildPublicEstimate(neutralHalifaxProperty);
    const extraBedroom = buildPublicEstimate({ ...neutralHalifaxProperty, bedrooms: 5 });

    expect(extraBedroom.baseValue).toBeGreaterThan(neutral.baseValue);
  });

  it("falls back to FSA-wide evidence for a property type with no rows in that FSA", () => {
    // The committed Halifax evidence has Detached but no Townhouse rows in B0J.
    const response = buildPublicEstimate({ postalCode: "B0J 1A1", propertyType: "Townhouse", livingAreaSqft: 1_400, bedrooms: 3, bathrooms: 2 });
    const b0jRows = halifaxRows.filter((row) => row.postalFsa === "B0J");

    expect(b0jRows.some((row) => row.propertyType === "Townhouse")).toBe(false);
    expect(response.market).toBe("halifax_maritimes");
    expect(response.marketContext.localAreaScope).toBe("fsa");
    expect(response.marketContext.comparableCount).toBe(b0jRows.reduce((sum, row) => sum + row.trainingRows, 0));
  });

  it("rejects Condo requests like the live Halifax model does", () => {
    // PVSC open data has no condo unit characteristics; blending non-condo medians would be an invented number.
    expect(() =>
      buildPublicEstimate({ postalCode: "B3H 1A1", propertyType: "Condo", livingAreaSqft: 800, bedrooms: 2, bathrooms: 1 }),
    ).toThrowError(/Condo estimates are not available for Halifax \/ Maritimes/);
  });

  it("falls back to market-wide evidence for an FSA with no rows", () => {
    const response = buildPublicEstimate({ postalCode: "B9Z 1A1", propertyType: "Detached", livingAreaSqft: 1_500, bedrooms: 3, bathrooms: 2 });

    expect(response.market).toBe("halifax_maritimes");
    expect(response.marketContext.localAreaScope).toBe("city-property-type");
  });
});

describe("Halifax public simulate, plan, and deal paths", () => {
  it("simulates uplift against the Halifax evidence-backed estimate", () => {
    const response = buildPublicSimulate({ ...neutralHalifaxProperty, plannedFlags: ["renovatedKitchen"] });

    expect(response.status).toBe("ready");
    expect(response.upliftValue ?? 0).toBeGreaterThan(0);
    expect(response.dataSources?.evidence).toBe("data/exports/market_evidence.json");
    expect(response.rowCounts?.evidenceComparables).toBe(b3hDetached?.trainingRows);
  });

  it("builds a ready plan inside the budget and ceiling for a Halifax property", () => {
    const estimate = buildPublicEstimate(neutralHalifaxProperty);
    const response = buildPublicPlan({
      ...neutralHalifaxProperty,
      plannedFlags: ["renovatedKitchen"],
      targetPrice: 1_200_000,
      budget: 90_000,
      timelineMonths: 9,
    });

    expect(response.status).toBe("ready");
    expect(response.plannedSpend).toBeLessThanOrEqual(90_000);
    expect(response.achievableValue).toBeLessThanOrEqual(estimate.marketContext.practicalCeiling);
  });

  it("analyzes a Halifax deal end to end", () => {
    const response = buildPublicDealAnalyze({
      ...neutralHalifaxProperty,
      askingPrice: 1_000_000,
      budget: 90_000,
      timelineMonths: 9,
      plannedFlags: ["renovatedKitchen"],
    });

    expect(response.estimate.market).toBe("halifax_maritimes");
    expect(response.plan.status).toBe("ready");
    expect(response.estimate.trainingMode).toBe("public-interactive-estimator");
  });
});

describe("Vancouver public estimate regression", () => {
  it("returns the same numbers as before the multi-market refactor", () => {
    const response = buildPublicEstimate({
      postalCode: "V6B 1X9",
      propertyType: "Condo",
      livingAreaSqft: 708,
      bedrooms: 1,
      bathrooms: 1,
      yearBuilt: 2012,
    });

    expect(response.market).toBe("vancouver");
    expect(response.baseValue).toBe(766_000);
    expect(response.confidenceLow).toBe(682_000);
    expect(response.confidenceHigh).toBe(850_000);
    expect(response.pricePerSqft).toBe(1_082);
    expect(response.confidenceRatio).toBe(0.11);
    expect(response.marketContext.practicalCeiling).toBe(1_030_000);
  });

  it("rejects postal codes outside both markets", () => {
    expect(() =>
      buildPublicEstimate({ postalCode: "K1A 0A1", propertyType: "Detached", livingAreaSqft: 1_800, bedrooms: 3, bathrooms: 2 }),
    ).toThrowError(/Vancouver postal code.*Halifax \/ Maritimes/);
  });
});

describe("demo mode Halifax guard", () => {
  it("rejects B-prefix postal codes with a message pointing at live or public mode", () => {
    expect(() => buildDemoEstimate({ postalCode: "B3H 1A1", propertyType: "Detached", livingAreaSqft: 1_840, bedrooms: 3, bathrooms: 2 })).toThrowError(
      /Demo mode has precomputed Vancouver samples only.*live or public mode/,
    );
  });
});
