import { apiFetch } from "./http";
import type {
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

export async function postDealAnalyze(
  input: PropertyInput & { plannedFlags: PlannedFlag[]; askingPrice: number; budget: number; timelineMonths: number },
): Promise<DealAnalyzeResponse> {
  return apiFetch<DealAnalyzeResponse>(`${apiBase}/deal/analyze`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function postEstimate(input: PropertyInput): Promise<EstimateResponse> {
  return apiFetch<EstimateResponse>(`${apiBase}/estimate`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function postImproveValue(input: PropertyInput & { plannedFlags: PlannedFlag[]; horizonMonths?: number }): Promise<SimulateResponse> {
  return apiFetch<SimulateResponse>(`${apiBase}/simulate`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function postPlan(
  input: PropertyInput & { plannedFlags: PlannedFlag[]; targetPrice: number; budget: number; timelineMonths: number },
): Promise<PlanResponse> {
  return apiFetch<PlanResponse>(`${apiBase}/plan`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getInsights(): Promise<DemoMetricsResponse> {
  return apiFetch<DemoMetricsResponse>(`${apiBase}/insights`);
}

export async function getMarkets(): Promise<MarketsResponse> {
  return apiFetch<MarketsResponse>(`${apiBase}/markets`);
}

export async function getMarketEvidence(query: { market: string; fsa?: string; propertyType?: string }): Promise<MarketEvidenceResponse> {
  const params = new URLSearchParams({ market: query.market });
  if (query.fsa) {
    params.set("fsa", query.fsa);
  }
  if (query.propertyType) {
    params.set("propertyType", query.propertyType);
  }
  return apiFetch<MarketEvidenceResponse>(`${apiBase}/evidence?${params.toString()}`);
}

export async function getMarketTrend(market: string): Promise<MarketTrendResponse> {
  return apiFetch<MarketTrendResponse>(`${apiBase}/trend?market=${encodeURIComponent(market)}`);
}

export async function getMarketMap(market: string): Promise<MarketMapResponse> {
  return apiFetch<MarketMapResponse>(`${apiBase}/map?market=${encodeURIComponent(market)}`);
}

export async function getModelExperiments(): Promise<ModelExperimentsResponse> {
  return apiFetch<ModelExperimentsResponse>(`${apiBase}/experiments`);
}
