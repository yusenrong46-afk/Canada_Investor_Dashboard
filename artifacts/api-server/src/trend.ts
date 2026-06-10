import path from "node:path";

import { marketTrendResponseSchema, type MarketTrendResponse } from "@vvl/shared";

import { demoModeEnabled } from "./demo";
import { requestModelService } from "./model";
import { publicModeEnabled } from "./publicEngine";
import { readRepoJson } from "./repoFiles";

export const trendRelativePath = path.join("data", "exports", "market_trend.json");

interface MarketTrendExportFile {
  generatedAt?: string;
  source?: string;
  license?: string;
  markets?: Record<string, Record<string, unknown>>;
}

function unavailable(message: string): MarketTrendResponse {
  return { status: "unavailable", message };
}

// Every trend payload leaves this module schema-valid, whether it came from the export file or the Flask proxy.
function validated(payload: unknown, origin: string): MarketTrendResponse {
  const parsed = marketTrendResponseSchema.safeParse(payload);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    return unavailable(`${origin} returned a trend payload that does not match the market trend contract (${issues}).`);
  }
  return parsed.data;
}

export function trendFromExportFile(market: string): MarketTrendResponse {
  let file: MarketTrendExportFile;
  try {
    file = readRepoJson<MarketTrendExportFile>(trendRelativePath);
  } catch {
    return unavailable(`Market trend export not found at ${trendRelativePath}. Run scripts/build_market_trend.py to generate it.`);
  }

  const entry = file.markets?.[market];
  if (!entry) {
    const available = Object.keys(file.markets ?? {}).sort().join(", ") || "none";
    return unavailable(`Unknown market '${market}'. Available markets: ${available}.`);
  }

  // The export stores license/generatedAt once at the top level; merge them so each market entry satisfies the shared contract.
  return validated({ license: file.license, generatedAt: file.generatedAt, ...entry }, trendRelativePath);
}

export async function trendFromModelService(market: string): Promise<MarketTrendResponse> {
  try {
    const payload = await requestModelService<unknown>(`/trend?market=${encodeURIComponent(market)}`);
    return validated(payload, "Model service GET /trend");
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : ".";
    return unavailable(`Model service GET /trend request failed${detail}`);
  }
}

export async function getMarketTrend(market: string): Promise<MarketTrendResponse> {
  if (demoModeEnabled || publicModeEnabled) {
    return trendFromExportFile(market);
  }
  return trendFromModelService(market);
}
