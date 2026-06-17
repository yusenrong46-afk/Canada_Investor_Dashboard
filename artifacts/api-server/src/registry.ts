import path from "node:path";

import type { ModelRegistryResponse } from "@vvl/shared";
import { z } from "zod/v4";

import { readRepoJson } from "./repoFiles";

export const registryRelativePath = path.join("data", "exports", "model_registry.json");

const registryModelSchema = z.object({
  name: z.string(),
  market: z.string(),
  productionVersion: z.number().int(),
  modelVersionTag: z.string().nullable(),
  stage: z.string(),
  modelArchitecture: z.string().nullable(),
  spatialCvMae: z.number().nullable(),
  holdoutMae: z.number().nullable(),
  holdoutMape: z.number().nullable(),
  runId: z.string().nullable(),
});

const registryFileSchema = z.object({
  status: z.literal("ready"),
  generatedAt: z.string(),
  trackingStore: z.string(),
  policy: z.object({
    primaryMetric: z.string(),
    direction: z.string(),
    guardrail: z.string(),
    rationale: z.string().optional(),
  }),
  models: z.array(registryModelSchema),
});

// Generated separately by scripts/export_registry_snapshot.py; a shape-valid file is served verbatim and cached.
let cachedRegistry: ModelRegistryResponse | null | undefined;

export function loadModelRegistry(): ModelRegistryResponse | null {
  if (cachedRegistry === undefined) {
    try {
      const raw = readRepoJson<unknown>(registryRelativePath);
      registryFileSchema.parse(raw);
      cachedRegistry = raw as ModelRegistryResponse;
    } catch {
      cachedRegistry = null;
    }
  }
  return cachedRegistry;
}

export function buildRegistryResponse(): ModelRegistryResponse {
  const file = loadModelRegistry();
  if (!file) {
    return {
      status: "unavailable",
      message: `Model registry snapshot is missing or does not match the registry contract at ${registryRelativePath}.`,
    };
  }
  return file;
}
