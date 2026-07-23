import path from "node:path";

import { z } from "zod/v4";

import { readRepoJson } from "./repoFiles";

export const halifaxUpliftRelativePath = path.join("data", "exports", "halifax_uplift.json");

const halifaxUpliftCategorySchema = z.object({
  status: z.enum(["ready", "insufficient-data"]),
  treatedPairs: z.number().int(),
  controlPairs: z.number().int(),
  medianExcessUpliftPercent: z.number().nullable(),
  p25ExcessUpliftPercent: z.number().nullable(),
  p75ExcessUpliftPercent: z.number().nullable(),
  medianPermitValue: z.number().nullable(),
  note: z.string(),
});

const halifaxUpliftFileSchema = z.object({
  generatedAt: z.string(),
  source: z.string(),
  method: z.string(),
  baselineMonth: z.string(),
  minTreatedPairs: z.number().int(),
  categories: z.record(z.string(), halifaxUpliftCategorySchema),
  flagCategoryMap: z.record(z.string(), z.string()),
});

export type HalifaxUpliftCategory = z.infer<typeof halifaxUpliftCategorySchema>;
export type HalifaxUpliftFile = z.infer<typeof halifaxUpliftFileSchema>;

// The local-uplift export is produced separately and may not exist yet; null keeps the generic public path active.
let cachedUplift: HalifaxUpliftFile | null | undefined;

export function loadHalifaxUplift(): HalifaxUpliftFile | null {
  if (cachedUplift === undefined) {
    try {
      cachedUplift = halifaxUpliftFileSchema.parse(readRepoJson(halifaxUpliftRelativePath));
    } catch {
      cachedUplift = null;
    }
  }
  return cachedUplift;
}

export function hasReadyUpliftCategory(file: HalifaxUpliftFile): boolean {
  return Object.values(file.categories).some((category) => category.status === "ready" && category.medianExcessUpliftPercent != null);
}
