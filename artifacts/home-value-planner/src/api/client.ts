import { apiFetch } from "./http";
import type { AssistantQueryResponse, DealAnalyzeResponse, EstimateResponse, ImproveValueResponse, PlanResponse, PlannedFlag, PropertyInput } from "../types";

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");

export async function postEstimate(property: PropertyInput): Promise<EstimateResponse> {
  return apiFetch<EstimateResponse>(`${apiBase}/estimate`, {
    method: "POST",
    body: JSON.stringify(property),
  });
}

export async function postImproveValue(input: PropertyInput & { plannedFlags: PlannedFlag[]; horizonMonths?: number }): Promise<ImproveValueResponse> {
  return apiFetch<ImproveValueResponse>(`${apiBase}/simulate`, {
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

export async function postDealAnalyze(
  input: PropertyInput & { plannedFlags: PlannedFlag[]; askingPrice: number; budget: number; timelineMonths: number },
): Promise<DealAnalyzeResponse> {
  return apiFetch<DealAnalyzeResponse>(`${apiBase}/deal/analyze`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function postAssistantQuery(input: { question: string; topK?: number }): Promise<AssistantQueryResponse> {
  return apiFetch<AssistantQueryResponse>(`${apiBase}/assistant/query`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
