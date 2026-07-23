import { z } from "zod/v4";

export const API_CONTRACT_VERSION = "2026-07-18.v1" as const;

export const engineTypeValues = ["rules", "fitted-model", "composite", "precomputed-demo"] as const;
export const evidenceLevelValues = ["none", "assumption", "proxy", "observed", "mixed"] as const;
export const validationStatusValues = ["not-applicable", "unvalidated", "descriptive", "validated"] as const;

export const resultProvenanceSchema = z
  .object({
    contractVersion: z.literal(API_CONTRACT_VERSION),
    engineType: z.enum(engineTypeValues),
    evidenceLevel: z.enum(evidenceLevelValues),
    validationStatus: z.enum(validationStatusValues),
    version: z.string().trim().min(1),
    dataAsOf: z.string().trim().min(1).nullable(),
    sourceIds: z.array(z.string().trim().min(1)),
    limitations: z.array(z.string().trim().min(1)),
  })
  .superRefine((value, context) => {
    if (value.engineType === "rules" && value.validationStatus === "validated") {
      context.addIssue({
        code: "custom",
        path: ["validationStatus"],
        message: "A rules engine cannot claim fitted-model validation.",
      });
    }
    if (value.engineType === "precomputed-demo" && value.evidenceLevel !== "none") {
      context.addIssue({
        code: "custom",
        path: ["evidenceLevel"],
        message: "Precomputed demo output cannot claim live evidence.",
      });
    }
  });

export type EngineType = (typeof engineTypeValues)[number];
export type EvidenceLevel = (typeof evidenceLevelValues)[number];
export type ValidationStatus = (typeof validationStatusValues)[number];
export type ResultProvenance = z.infer<typeof resultProvenanceSchema>;

export function resultProvenance(
  value: Omit<ResultProvenance, "contractVersion">,
): ResultProvenance {
  return resultProvenanceSchema.parse({ contractVersion: API_CONTRACT_VERSION, ...value });
}
