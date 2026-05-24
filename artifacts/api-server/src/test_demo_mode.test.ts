import { describe, expect, it } from "vitest";

import { buildDemoEstimate, buildDemoPlan } from "./demo";
import { buildPublicDealAnalyze, buildPublicEstimate, buildPublicPlan } from "./publicEngine";

const sampleProperty = {
  postalCode: "V6B 1X9",
  propertyType: "Condo" as const,
  livingAreaSqft: 708,
  bedrooms: 1,
  bathrooms: 1,
};

describe("demo mode helpers", () => {
  it("returns a stable sample estimate without the Python model service", () => {
    const response = buildDemoEstimate(sampleProperty);

    expect(response.baseValue).toBe(748000);
    expect(response.modelVersion).toBe("demo-sample-v1");
    expect(response.trainingMode).toBe("demo-safe-precomputed");
    expect(response.marketFreshness?.message).toContain("Demo Mode");
  });

  it("returns a stable sample plan", () => {
    const response = buildDemoPlan({
      ...sampleProperty,
      plannedFlags: ["renovatedKitchen"],
      targetPrice: 850000,
      budget: 85000,
      timelineMonths: 9,
    });

    expect(response.status).toBe("ready");
    expect(response.items?.length).toBeGreaterThan(0);
    expect(response.methodNotes?.[0]).toContain("Plan values");
  });
});

describe("public interactive mode helpers", () => {
  it("changes the estimate when the user changes the property inputs", () => {
    const smallCondo = buildPublicEstimate({
      postalCode: "V6B 1X9",
      propertyType: "Condo",
      livingAreaSqft: 650,
      bedrooms: 1,
      bathrooms: 1,
      yearBuilt: 2010,
    });
    const largerCondo = buildPublicEstimate({
      postalCode: "V6B 1X9",
      propertyType: "Condo",
      livingAreaSqft: 950,
      bedrooms: 2,
      bathrooms: 2,
      yearBuilt: 2010,
    });

    expect(largerCondo.baseValue).toBeGreaterThan(smallCondo.baseValue);
    expect(largerCondo.pricePerSqft).not.toBe(smallCondo.pricePerSqft);
    expect(largerCondo.trainingMode).toBe("public-interactive-estimator");
  });

  it("builds a public plan from budget and timeline inputs", () => {
    const response = buildPublicPlan({
      ...sampleProperty,
      plannedFlags: ["renovatedKitchen"],
      targetPrice: 850000,
      budget: 85000,
      timelineMonths: 9,
    });

    expect(response.status).toBe("ready");
    expect(response.message).toContain("Public interactive mode");
    expect(response.plannedSpend).toBeLessThanOrEqual(85000);
  });

  it("keeps the deal analyzer interactive and not demo-labeled", () => {
    const response = buildPublicDealAnalyze({
      ...sampleProperty,
      askingPrice: 735000,
      budget: 85000,
      timelineMonths: 9,
      plannedFlags: ["renovatedKitchen"],
    });

    expect(response.estimate.trainingMode).toBe("public-interactive-estimator");
    expect(response.riskFlags.some((flag) => flag.label === "Interactive public estimate")).toBe(true);
    expect(response.riskFlags.some((flag) => flag.label === "Demo-safe output")).toBe(false);
  });
});
