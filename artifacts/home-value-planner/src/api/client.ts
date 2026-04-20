import { apiFetch } from "./http";
import type { EstimateResponse, PlanResponse, PlannedFlag, PropertyInput, SimulateResponse } from "../types";

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");

export async function postEstimate(property: PropertyInput): Promise<EstimateResponse> {
  return apiFetch<EstimateResponse>(`${apiBase}/estimate`, {
    method: "POST",
    body: JSON.stringify(property),
  });
}

export async function postSimulate(input: PropertyInput & { plannedFlags: PlannedFlag[]; horizonMonths?: number }): Promise<SimulateResponse> {
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
