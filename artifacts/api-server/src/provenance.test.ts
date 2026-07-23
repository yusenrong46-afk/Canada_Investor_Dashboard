import {
  API_CONTRACT_VERSION,
  estimateResponseSchema,
  resultProvenance,
  resultProvenanceSchema,
  simulateResponseSchema,
} from "@vvl/shared";
import { describe, expect, it } from "vitest";

import { buildDemoEstimate } from "./demo";
import { buildPublicEstimate, buildPublicSimulate } from "./publicEngine";

const vancouverCondo = {
  postalCode: "V6B 1X9",
  propertyType: "Condo" as const,
  livingAreaSqft: 708,
  bedrooms: 1,
  bathrooms: 1,
  yearBuilt: 2010,
};

describe("result provenance contract", () => {
  it("brands every provenance payload with the current contract version", () => {
    const provenance = resultProvenance({
      engineType: "rules",
      evidenceLevel: "assumption",
      validationStatus: "unvalidated",
      version: "test-rules-v1",
      dataAsOf: null,
      sourceIds: ["test-source"],
      limitations: ["Test limitation."],
    });

    expect(provenance.contractVersion).toBe(API_CONTRACT_VERSION);
  });

  it("rejects fitted-model validation claims on a rules engine", () => {
    const result = resultProvenanceSchema.safeParse({
      contractVersion: API_CONTRACT_VERSION,
      engineType: "rules",
      evidenceLevel: "assumption",
      validationStatus: "validated",
      version: "contradictory-rules-v1",
      dataAsOf: null,
      sourceIds: ["rules.ts"],
      limitations: ["Not fitted."],
    });

    expect(result.success).toBe(false);
  });

  it("rejects live-evidence claims on precomputed demonstration output", () => {
    const result = resultProvenanceSchema.safeParse({
      contractVersion: API_CONTRACT_VERSION,
      engineType: "precomputed-demo",
      evidenceLevel: "observed",
      validationStatus: "not-applicable",
      version: "demo-v1",
      dataAsOf: null,
      sourceIds: ["demo.json"],
      limitations: ["Demonstration only."],
    });

    expect(result.success).toBe(false);
  });
});

describe("calculation response contracts", () => {
  it("accepts public rules and rejects a rules estimate relabelled as XGBoost", () => {
    const estimate = buildPublicEstimate(vancouverCondo);

    expect(estimateResponseSchema.safeParse(estimate).success).toBe(true);
    expect(estimate.provenance.engineType).toBe("rules");
    expect(estimate.modelFamily).toBe("rules");
    expect(estimateResponseSchema.safeParse({ ...estimate, modelFamily: "xgboost" }).success).toBe(false);
  });

  it("marks Vancouver public uplift as an unvalidated assumption", () => {
    const response = buildPublicSimulate({ ...vancouverCondo, plannedFlags: ["renovatedKitchen"] });

    expect(simulateResponseSchema.safeParse(response).success).toBe(true);
    expect(response.evidenceLevel).toBe("assumption");
    expect(response.provenance.validationStatus).toBe("unvalidated");
  });

  it("marks demo estimates as precomputed with no live evidence", () => {
    const estimate = buildDemoEstimate(vancouverCondo);

    expect(estimateResponseSchema.safeParse(estimate).success).toBe(true);
    expect(estimate.provenance.engineType).toBe("precomputed-demo");
    expect(estimate.provenance.evidenceLevel).toBe("none");
  });
});
