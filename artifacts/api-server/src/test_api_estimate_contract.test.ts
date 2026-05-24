import { describe, expect, it } from "vitest";

import { buildDemoEstimate } from "./demo";
import { buildPublicDealAnalyze } from "./publicEngine";

describe("estimate response contract", () => {
  it("includes model note, confidence range, and trust summary fields", () => {
    const response = buildDemoEstimate({
      postalCode: "V6B 1X9",
      propertyType: "Condo",
      livingAreaSqft: 708,
      bedrooms: 1,
      bathrooms: 1,
    });

    expect(response.baseValue).toBeGreaterThan(0);
    expect(response.confidenceLow).toBeLessThan(response.baseValue);
    expect(response.confidenceHigh).toBeGreaterThan(response.baseValue);
    expect(response.modelVersion).toBeTruthy();
    expect(response.modelQuality.validationSummary.missingnessNotes.length).toBeGreaterThan(0);
  });

  it("keeps the deal analyzer contract in demo mode", () => {
    const response = buildPublicDealAnalyze({
      postalCode: "V6B 1X9",
      propertyType: "Condo",
      livingAreaSqft: 708,
      bedrooms: 1,
      bathrooms: 1,
      askingPrice: 735000,
      budget: 85000,
      timelineMonths: 9,
      plannedFlags: ["renovatedKitchen"],
    });

    expect(response.estimate.baseValue).toBeGreaterThan(0);
    expect(response.plan.status).toBe("ready");
    expect(response.riskFlags.some((flag) => flag.label === "Interactive public estimate")).toBe(true);
  });
});
