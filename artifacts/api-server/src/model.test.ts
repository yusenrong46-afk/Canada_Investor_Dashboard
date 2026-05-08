import { afterEach, describe, expect, it, vi } from "vitest";

import { simulateScenario } from "./model";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("simulateScenario", () => {
  it("passes through Seattle observed uplift percent fields from the model service", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          status: "ready",
          modelVersion: "seattle-observed-percent-uplift-v1",
          trainingMode: "seattle-repeat-sale-observed-only",
          modelFamily: "random-forest",
          evidenceLevel: "observed",
          baseValue: 1000000,
          upliftPercent: 0.035,
          upliftValue: 35000,
          finalValueRaw: 1035000,
          finalValueGuardrailed: 1035000,
          plannedFlags: ["renovatedKitchen"],
          topUpliftDrivers: [{ flag: "renovatedKitchen", label: "Renovated kitchen", value: 35000, upliftPercent: 0.035 }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as typeof fetch;

    const result = await simulateScenario({
      postalCode: "V6B 1X9",
      propertyType: "Condo",
      livingAreaSqft: 708,
      bedrooms: 1,
      bathrooms: 1,
      plannedFlags: ["renovatedKitchen"],
    });

    expect(result.evidenceLevel).toBe("observed");
    expect(result.upliftPercent).toBe(0.035);
    expect(result.upliftValue).toBe(35000);
  });
});
