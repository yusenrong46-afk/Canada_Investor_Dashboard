import path from "node:path";

import type { MarketMapResponse } from "@vvl/shared";
import { z } from "zod/v4";

import { readRepoJson } from "./repoFiles";

export const mapRelativePath = path.join("data", "exports", "market_map.json");

// Boundary vertices are [lat, lng] pairs, matching the shared MarketMapCell contract.
const mapCellSchema = z.object({
  h3: z.string(),
  boundary: z.array(z.tuple([z.number(), z.number()])),
  rows: z.number().int(),
  medianValue: z.number(),
  medianPricePerSqft: z.number(),
});

const mapMarketSchema = z.object({
  market: z.string(),
  label: z.string(),
  zoom: z.number(),
  center: z.tuple([z.number(), z.number()]),
  pricePerSqftDomain: z.tuple([z.number(), z.number()]),
  cells: z.array(mapCellSchema),
});

const mapFileSchema = z.object({
  generatedAt: z.string(),
  source: z.string(),
  markets: z.record(z.string(), mapMarketSchema),
});

export type MarketMapFile = z.infer<typeof mapFileSchema>;

// The committed export is validated once and cached; null means the file is missing or fails the contract.
let cachedMap: MarketMapFile | null | undefined;

export function loadMarketMap(): MarketMapFile | null {
  if (cachedMap === undefined) {
    try {
      cachedMap = mapFileSchema.parse(readRepoJson(mapRelativePath));
    } catch (error) {
      console.warn(`[api] failed to load ${mapRelativePath}`, error);
      cachedMap = null;
    }
  }
  return cachedMap;
}

export function buildMapResponse(market: string): MarketMapResponse {
  const file = loadMarketMap();
  if (!file) {
    return {
      status: "unavailable",
      message: `Market map export is missing or invalid at ${mapRelativePath}. Run scripts/export_market_map.py to regenerate it.`,
    };
  }

  const entry = file.markets[market];
  if (!entry) {
    const available = Object.keys(file.markets).sort().join(", ") || "none";
    return {
      status: "unavailable",
      message: `Unknown market '${market}'. Available markets: ${available}.`,
    };
  }

  return {
    status: "ready",
    generatedAt: file.generatedAt,
    source: file.source,
    ...entry,
  };
}
