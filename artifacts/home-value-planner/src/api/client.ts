import { apiFetch } from "./http";
import type { AssistantQueryResponse, DealAnalyzeResponse, PlannedFlag, PropertyInput } from "@vvl/shared";

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");

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
