import { describe, expect, it } from "vitest";

import { dealAnalyzeRequestSchema, estimateRequestSchema, planRequestSchema, simulateRequestSchema } from "./schemas";

describe("api schemas", () => {
  it("accepts a valid investor deal request", () => {
    const parsed = dealAnalyzeRequestSchema.parse({
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

    expect(parsed.askingPrice).toBe(735000);
  });

  it("accepts the restored estimate request shape", () => {
    const parsed = estimateRequestSchema.parse({
      postalCode: "V6B 1X9",
      propertyType: "Condo",
      livingAreaSqft: 708,
      bedrooms: 1,
      bathrooms: 1,
    });

    expect(parsed.propertyType).toBe("Condo");
  });

  it("accepts simulate and plan request shapes", () => {
    const simulate = simulateRequestSchema.parse({
      postalCode: "V6B 1X9",
      propertyType: "Condo",
      livingAreaSqft: 708,
      bedrooms: 1,
      bathrooms: 1,
      plannedFlags: ["renovatedKitchen"],
    });

    const plan = planRequestSchema.parse({
      ...simulate,
      targetPrice: 850000,
      budget: 85000,
      timelineMonths: 9,
    });

    expect(simulate.plannedFlags).toEqual(["renovatedKitchen"]);
    expect(plan.targetPrice).toBe(850000);
  });
});
