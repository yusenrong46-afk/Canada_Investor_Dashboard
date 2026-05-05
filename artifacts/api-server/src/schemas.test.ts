import { describe, expect, it } from "vitest";

import { assistantQuerySchema, dealAnalyzeRequestSchema } from "./schemas";

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

  it("rejects unsupported assistant questions", () => {
    expect(() => assistantQuerySchema.parse({ question: "ok" })).toThrow();
  });
});
