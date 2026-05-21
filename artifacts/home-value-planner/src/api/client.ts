import { apiFetch } from "./http";
import type { DealAnalyzeResponse, DemoMetricsResponse, EstimateResponse, PlannedFlag, PlanResponse, PropertyInput, SimulateResponse } from "@vvl/shared";

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");

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
