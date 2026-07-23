import path from "node:path";

import type { ModelExperimentsResponse } from "@vvl/shared";
import { z } from "zod/v4";

import { readRepoJson } from "./repoFiles";

export const experimentsRelativePath = path.join("data", "exports", "model_experiments.json");

const experimentRowSchema = z.object({
  experiment: z.enum(["local", "pooled", "hybrid"]),
  market: z.string(),
  propertyType: z.string(),
  family: z.string(),
  trainingRows: z.number().int(),
  holdoutRows: z.number().int(),
  holdoutMae: z.number(),
  holdoutMape: z.number(),
  spatialCvMae: z.number().nullable(),
  notes: z.string().optional(),
});

const experimentsFileSchema = z.object({
  status: z.literal("ready"),
  generatedAt: z.string(),
  source: z.string(),
  rows: z.array(experimentRowSchema),
  conclusions: z.array(z.string()),
});

// The export is generated separately and may not exist; a shape-valid file is served verbatim and cached,
// null means it is missing or breaks the ModelExperimentsResponse 'ready' contract.
let cachedExperiments: ModelExperimentsResponse | null | undefined;

export function loadModelExperiments(): ModelExperimentsResponse | null {
  if (cachedExperiments === undefined) {
    try {
      const raw = readRepoJson(experimentsRelativePath);
      cachedExperiments = experimentsFileSchema.parse(raw) as ModelExperimentsResponse;
    } catch (error) {
      console.warn(`[api] failed to load ${experimentsRelativePath}`, error);
      cachedExperiments = null;
    }
  }
  return cachedExperiments;
}

export function buildExperimentsResponse(): ModelExperimentsResponse {
  const file = loadModelExperiments();
  if (!file) {
    return {
      status: "unavailable",
      message: `Model experiments export is missing or does not match the experiments contract at ${experimentsRelativePath}.`,
    };
  }
  return file;
}
