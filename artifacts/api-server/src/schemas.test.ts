import { detectMarket, marketEvidenceFileSchema } from "@vvl/shared";
import { describe, expect, it } from "vitest";

import { dealAnalyzeRequestSchema, estimateRequestSchema, planRequestSchema, propertyInputSchema, simulateRequestSchema } from "./schemas";

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

  it("accepts a Halifax / Maritimes postal code", () => {
    const parsed = propertyInputSchema.parse({
      postalCode: "B3H 1A1",
      propertyType: "Detached",
      livingAreaSqft: 1840,
      bedrooms: 3,
      bathrooms: 2,
    });

    expect(parsed.postalCode).toBe("B3H 1A1");
  });

  it("rejects postal codes outside the supported markets", () => {
    const result = propertyInputSchema.safeParse({
      postalCode: "K1A 0A1",
      propertyType: "Detached",
      livingAreaSqft: 1840,
      bedrooms: 3,
      bathrooms: 2,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a syntactically valid FSA that the models never observed", () => {
    const result = propertyInputSchema.safeParse({
      postalCode: "V5A 1A1",
      propertyType: "Condo",
      livingAreaSqft: 700,
      bedrooms: 1,
      bathrooms: 1,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain("outside the model's observed training geography");
    }
  });
});

describe("detectMarket", () => {
  it("maps V postal codes to vancouver", () => {
    expect(detectMarket("V6B 1X9")).toBe("vancouver");
  });

  it("maps B postal codes to halifax_maritimes", () => {
    expect(detectMarket("B3H 1A1")).toBe("halifax_maritimes");
  });

  it("returns null for unsupported markets", () => {
    expect(detectMarket("K1A 0A1")).toBeNull();
  });

  it("tolerates lowercase input and surrounding whitespace", () => {
    expect(detectMarket("  v6b 1x9 ")).toBe("vancouver");
    expect(detectMarket("  b3h 1a1 ")).toBe("halifax_maritimes");
  });
});

describe("marketEvidenceFileSchema", () => {
  const evidenceFixture = {
    generatedAt: "2026-06-09T00:00:00Z",
    provenance: {
      warehousePath: "analytics/warehouse/property_warehouse.duckdb",
      builtFrom: "scripts/build_property_warehouse.py",
      sourceDatasets: [{ id: "pvsc_parcels", market: "halifax_maritimes", name: "PVSC assessed parcels" }],
    },
    markets: [{ marketId: "halifax_maritimes", label: "Halifax / Maritimes", region: "NS" }],
    rows: [
      {
        marketId: "halifax_maritimes",
        cityName: "Halifax",
        provinceState: "NS",
        propertyType: "Detached",
        postalFsa: "B3H",
        trainingRows: 1250,
        modelReadyRows: 1198,
        medianValue: 520000,
        avgValue: 548211.5,
        medianPricePerSqft: null,
        avgLivingAreaSqft: 1840.2,
        avgBedrooms: 3.1,
        avgBathrooms: 1.8,
      },
    ],
  };

  it("round-trips a minimal valid evidence file", () => {
    expect(marketEvidenceFileSchema.parse(evidenceFixture)).toEqual(evidenceFixture);
  });

  it("rejects a row missing trainingRows", () => {
    const { trainingRows: _trainingRows, ...incompleteRow } = evidenceFixture.rows[0];
    const result = marketEvidenceFileSchema.safeParse({ ...evidenceFixture, rows: [incompleteRow] });

    expect(result.success).toBe(false);
  });
});
