import { describe, expect, it } from "vitest";

import { buildDemoEstimate, buildDemoPlan } from "./demo";

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
