import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { requestModelService, simulateScenario } from "./model";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("requestModelService", () => {
  it("throws ModelServiceError on non-OK HTTP status", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ message: "bad input" }), { status: 422 })) as typeof fetch;

    await expect(requestModelService("/estimate", { postalCode: "V6B 1X9" })).rejects.toMatchObject({
      status: 422,
      message: "bad input",
    });
  });

  it("throws ModelServiceError when the response body is not JSON", async () => {
    globalThis.fetch = vi.fn(async () => new Response("upstream exploded", { status: 502 })) as typeof fetch;

    await expect(requestModelService("/estimate")).rejects.toMatchObject({
      status: 502,
    });
  });

  it("throws ModelServiceError when the payload fails schema validation", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ status: "ready", baseValue: "not-a-number" }), { status: 200 }),
    ) as typeof fetch;

    await expect(requestModelService("/estimate", {}, z.object({ baseValue: z.number() }))).rejects.toMatchObject({
      status: 502,
      message: "The live model service returned an invalid response contract.",
    });
  });

  it("maps AbortError to a 504 timeout", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    }) as typeof fetch;

    await expect(requestModelService("/health")).rejects.toMatchObject({ status: 504 });
  });
});

describe("simulateScenario", () => {
  it("preserves Seattle uplift values while labelling their Vancouver use as proxy evidence", async () => {
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

    expect(result.evidenceLevel).toBe("proxy");
    expect(result.provenance.engineType).toBe("fitted-model");
    expect(result.provenance.validationStatus).toBe("descriptive");
    expect(result.upliftPercent).toBe(0.035);
    expect(result.upliftValue).toBe(35000);
  });

  it("maps model-service timeouts to ModelServiceError with status 504", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new DOMException("The operation was aborted.", "TimeoutError");
    }) as typeof fetch;

    await expect(
      simulateScenario({
        postalCode: "V6B 1X9",
        propertyType: "Condo",
        livingAreaSqft: 708,
        bedrooms: 1,
        bathrooms: 1,
        plannedFlags: ["renovatedKitchen"],
      }),
    ).rejects.toMatchObject({ status: 504, message: "Model service timed out" });
  });
});
