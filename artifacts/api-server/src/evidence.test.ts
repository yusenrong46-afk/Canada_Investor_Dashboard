import { marketEvidenceFileSchema } from "@vvl/shared";
import { describe, expect, it } from "vitest";

import { buildEvidenceResponse, evidenceQuerySchema, evidenceRelativePath, hasEvidenceRows, loadMarketEvidence, selectEvidenceRows } from "./evidence";
import { readRepoJson } from "./repoFiles";

describe("committed market evidence export", () => {
  it("parses against the shared marketEvidenceFileSchema", () => {
    const raw = readRepoJson(evidenceRelativePath);
    const parsed = marketEvidenceFileSchema.parse(raw);

    expect(parsed.rows.length).toBeGreaterThan(0);
    expect(parsed.markets.map((market) => market.marketId).sort()).toEqual(["halifax_maritimes", "vancouver"]);
  });

  it("loads once through the cached loader with rows for both markets", () => {
    expect(loadMarketEvidence()).not.toBeNull();
    expect(hasEvidenceRows("vancouver")).toBe(true);
    expect(hasEvidenceRows("halifax_maritimes")).toBe(true);
  });
});

describe("evidence query schema", () => {
  it("requires a known market id", () => {
    expect(evidenceQuerySchema.safeParse({ market: "toronto" }).success).toBe(false);
    expect(evidenceQuerySchema.safeParse({}).success).toBe(false);
    expect(evidenceQuerySchema.safeParse({ market: "halifax_maritimes" }).success).toBe(true);
  });
});

describe("evidence scope fallback", () => {
  it("returns exact fsa + property-type rows when they exist", () => {
    const selection = selectEvidenceRows("halifax_maritimes", "B3H", "Detached");

    expect(selection?.scope).toBe("fsa-property-type");
    expect(selection?.rows).toHaveLength(1);
    expect(selection?.rows[0].postalFsa).toBe("B3H");
    expect(selection?.rows[0].propertyType).toBe("Detached");
  });

  it("falls back to all property types in the fsa, tolerating lowercase input", () => {
    // Halifax evidence has no Condo rows, so a B3H Condo request widens to the whole FSA.
    const selection = selectEvidenceRows("halifax_maritimes", "b3h", "Condo");

    expect(selection?.scope).toBe("fsa");
    expect(selection?.rows.length).toBeGreaterThan(1);
    expect(selection?.rows.every((row) => row.postalFsa === "B3H")).toBe(true);
  });

  it("falls back to market-wide rows for the property type when the fsa is unknown", () => {
    const selection = selectEvidenceRows("halifax_maritimes", "B9Z", "Detached");

    expect(selection?.scope).toBe("market-property-type");
    expect(selection?.rows.length).toBeGreaterThan(1);
    expect(selection?.rows.every((row) => row.propertyType === "Detached" && row.marketId === "halifax_maritimes")).toBe(true);
  });

  it("falls back to all market rows when neither the fsa nor the property type matches", () => {
    const selection = selectEvidenceRows("halifax_maritimes", "B9Z", "Condo");

    expect(selection?.scope).toBe("market");
    expect(selection?.rows.every((row) => row.marketId === "halifax_maritimes")).toBe(true);
  });

  it("uses market-property-type scope when only a property type is given", () => {
    const selection = selectEvidenceRows("vancouver", undefined, "Condo");

    expect(selection?.scope).toBe("market-property-type");
    expect(selection?.rows.every((row) => row.marketId === "vancouver" && row.propertyType === "Condo")).toBe(true);
  });

  it("uses market scope when no filters are given", () => {
    const selection = selectEvidenceRows("vancouver");

    expect(selection?.scope).toBe("market");
    expect(selection?.rows.every((row) => row.marketId === "vancouver")).toBe(true);
  });
});

describe("buildEvidenceResponse", () => {
  it("returns a ready payload with provenance from the committed file", () => {
    const response = buildEvidenceResponse("halifax_maritimes", "B3H", "Detached");
    const file = loadMarketEvidence();

    expect(response.status).toBe("ready");
    if (response.status === "ready") {
      expect(response.scope).toBe("fsa-property-type");
      expect(response.generatedAt).toBe(file?.generatedAt);
      expect(response.provenance).toEqual(file?.provenance);
      expect(response.rows).toHaveLength(1);
    }
  });
});
