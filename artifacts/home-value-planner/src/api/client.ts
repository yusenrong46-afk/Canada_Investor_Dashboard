import {
  apiHealthResponseSchema,
  dealAnalyzeResponseSchema,
  estimateResponseSchema,
  insightsResponseSchema,
  marketEvidenceApiResponseSchema,
  marketMapResponseSchema,
  marketsResponseSchema,
  marketTrendResponseSchema,
  modelExperimentsResponseSchema,
  planResponseSchema,
  simulateResponseSchema,
} from "@vvl/shared";

import { apiFetch } from "./http";
import type {
  ApiHealthResponse,
  DealAnalyzeResponse,
  DemoMetricsResponse,
  EstimateResponse,
  MarketEvidenceFile,
  MarketEvidenceRow,
  MarketMapResponse,
  MarketsResponse,
  MarketTrendResponse,
  ModelExperimentsResponse,
  PlannedFlag,
  PlanResponse,
  PropertyInput,
  SimulateResponse,
} from "@vvl/shared";

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");

export type MarketEvidenceScope = "fsa-property-type" | "fsa" | "market-property-type" | "market";

export type MarketEvidenceResponse =
  | {
      status: "ready";
      scope: MarketEvidenceScope;
      generatedAt: string;
      provenance: MarketEvidenceFile["provenance"];
      rows: MarketEvidenceRow[];
    }
  | { status: "unavailable"; message: string };

async function parseApiResponse<T>(schema: { safeParse: (data: unknown) => { success: true; data: T } | { success: false } }, data: unknown): Promise<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.warn("[api] response contract failed", result);
    throw new Error("Response failed contract validation");
  }
  return result.data;
}

async function apiFetchValidated<T>(
  url: string,
  schema: { safeParse: (data: unknown) => { success: true; data: T } | { success: false } },
  init?: RequestInit,
): Promise<T> {
  const data = await apiFetch<unknown>(url, init);
  return parseApiResponse(schema, data);
}

export async function postDealAnalyze(
  input: PropertyInput & { plannedFlags: PlannedFlag[]; askingPrice: number; budget: number; timelineMonths: number },
  signal?: AbortSignal,
): Promise<DealAnalyzeResponse> {
  return apiFetchValidated(`${apiBase}/deal/analyze`, dealAnalyzeResponseSchema, {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
}

export async function postEstimate(input: PropertyInput, signal?: AbortSignal): Promise<EstimateResponse> {
  return apiFetchValidated(`${apiBase}/estimate`, estimateResponseSchema, {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
}

export async function postImproveValue(
  input: PropertyInput & { plannedFlags: PlannedFlag[]; horizonMonths?: number },
  signal?: AbortSignal,
): Promise<SimulateResponse> {
  return apiFetchValidated(`${apiBase}/simulate`, simulateResponseSchema, {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
}

export async function postPlan(
  input: PropertyInput & { plannedFlags: PlannedFlag[]; targetPrice: number; budget: number; timelineMonths: number },
  signal?: AbortSignal,
): Promise<PlanResponse> {
  return apiFetchValidated(`${apiBase}/plan`, planResponseSchema, {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
}

export async function getInsights(): Promise<DemoMetricsResponse> {
  return apiFetchValidated(`${apiBase}/insights`, insightsResponseSchema);
}

export async function getHealth(): Promise<ApiHealthResponse> {
  return apiFetchValidated(`${apiBase}/health`, apiHealthResponseSchema);
}

export async function getMarkets(): Promise<MarketsResponse> {
  return apiFetchValidated(`${apiBase}/markets`, marketsResponseSchema);
}

export async function getMarketEvidence(
  query: { market: string; fsa?: string; propertyType?: string },
  signal?: AbortSignal,
): Promise<MarketEvidenceResponse> {
  const params = new URLSearchParams({ market: query.market });
  if (query.fsa) {
    params.set("fsa", query.fsa);
  }
  if (query.propertyType) {
    params.set("propertyType", query.propertyType);
  }
  return apiFetchValidated(`${apiBase}/evidence?${params.toString()}`, marketEvidenceApiResponseSchema, { signal });
}

export async function getMarketTrend(market: string, signal?: AbortSignal): Promise<MarketTrendResponse> {
  return apiFetchValidated(`${apiBase}/trend?market=${encodeURIComponent(market)}`, marketTrendResponseSchema, { signal });
}

export async function getMarketMap(market: string): Promise<MarketMapResponse> {
  return apiFetchValidated(`${apiBase}/map?market=${encodeURIComponent(market)}`, marketMapResponseSchema);
}

export async function getModelExperiments(): Promise<ModelExperimentsResponse> {
  return apiFetchValidated(`${apiBase}/experiments`, modelExperimentsResponseSchema);
}
