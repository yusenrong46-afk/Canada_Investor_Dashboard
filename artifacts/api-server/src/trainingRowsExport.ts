import path from "node:path";

import { z } from "zod/v4";

import { readRepoJson } from "./repoFiles";

const trainingSummarySchema = z.object({
  dataset: z.object({
    usableRows: z.number().int(),
  }),
});

let cachedVancouverTrainingRows: number | undefined | null;

/** Vancouver base-model training row count from the committed processed summary export. */
export function getVancouverSavedTrainingRows(): number | undefined {
  if (cachedVancouverTrainingRows === null) {
    return undefined;
  }
  if (cachedVancouverTrainingRows !== undefined) {
    return cachedVancouverTrainingRows;
  }
  try {
    const raw = readRepoJson(path.join("data", "processed", "vancouver_base_model_summary.json"));
    cachedVancouverTrainingRows = trainingSummarySchema.parse(raw).dataset.usableRows;
  } catch {
    cachedVancouverTrainingRows = null;
    return undefined;
  }
  return cachedVancouverTrainingRows;
}
