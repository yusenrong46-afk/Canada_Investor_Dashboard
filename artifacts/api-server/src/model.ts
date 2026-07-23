import {
  rawEstimateResponseSchema,
  rawSimulateResponseSchema,
  resultProvenance,
  type EstimateResponse,
  type PlanRequest,
  type PlanResponse,
  type PropertyInput,
  type SimulateRequest,
  type SimulateResponse,
} from "@vvl/shared";
import type { ZodType } from "zod/v4";

import { getConfig } from "./config";
import { ModelServiceError } from "./modelErrors";
import { buildPlan } from "./planBuilder";

type RawEstimateResponse = Omit<EstimateResponse, "provenance">;
type RawSimulateResponse = Omit<SimulateResponse, "provenance">;

export { ModelServiceError } from "./modelErrors";

export async function modelServiceIsReady(): Promise<boolean> {
  try {
    const { modelServiceBaseUrl } = getConfig();
    const response = await fetch(`${modelServiceBaseUrl}/health`, { signal: AbortSignal.timeout(3_000) });
    return response.ok;
  } catch {
    return false;
  }
}

function safeModelMessage(message: string | undefined, status: number): string {
  if (status >= 500 || !message) {
    return "The live model service could not complete this request.";
  }
  return message.replace(/\/(?:Users|home)\/[^\s,;]+/g, "the configured local data file");
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

export async function requestModelService<TResponse>(path: string, payload?: object, responseSchema?: ZodType<TResponse>): Promise<TResponse> {
  const { modelServiceBaseUrl, modelServiceTimeoutMs } = getConfig();

  let response: Response;
  try {
    response = await fetch(`${modelServiceBaseUrl}${path}`, {
      method: payload ? "POST" : "GET",
      headers: payload ? { "Content-Type": "application/json" } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(modelServiceTimeoutMs),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new ModelServiceError("Model service timed out", 504);
    }
    throw error;
  }

  const bodyText = await response.text();
  let parsedBody: TResponse | { message?: string } | null = null;
  if (bodyText) {
    try {
      parsedBody = JSON.parse(bodyText) as TResponse | { message?: string };
    } catch {
      parsedBody = { message: bodyText };
    }
  }

  if (!response.ok) {
    const message =
      parsedBody && typeof parsedBody === "object" && "message" in parsedBody
        ? parsedBody.message
        : `Model service request failed (${response.status})`;
    throw new ModelServiceError(safeModelMessage(message, response.status), response.status);
  }

  if (responseSchema) {
    const validated = responseSchema.safeParse(parsedBody);
    if (!validated.success) {
      throw new ModelServiceError("The live model service returned an invalid response contract.", 502);
    }
    return validated.data;
  }

  if (parsedBody === null) {
    throw new ModelServiceError("The live model service returned an empty response.", 502);
  }

  return parsedBody as TResponse;
}

export async function estimateProperty(property: PropertyInput): Promise<EstimateResponse> {
  const response = await requestModelService<RawEstimateResponse>("/estimate", property, rawEstimateResponseSchema);
  const halifax = property.postalCode.trim().toUpperCase().startsWith("B");
  return {
    ...response,
    provenance: resultProvenance({
      engineType: "fitted-model",
      evidenceLevel: "observed",
      validationStatus: "validated",
      version: response.modelVersion,
      dataAsOf: response.marketFreshness?.latestPeriod ?? response.marketFreshness?.baselinePeriod ?? null,
      sourceIds: halifax
        ? ["data/processed/halifax_base_model_training.csv", "artifacts/model-service/models/halifax_base_price_bundle_v1.pkl"]
        : ["data/processed/vancouver_base_model_training.csv", "artifacts/model-service/models/vancouver_base_price_bundle_v5.pkl"],
      limitations: halifax
        ? ["Time-adjusted Halifax sale-price model; property condition and parcel-level postal assignment remain imperfect."]
        : ["Vancouver model predicts listing price rather than final sale price and has material unseen-FSA generalization gaps."],
    }),
  };
}

export async function simulateScenario(request: SimulateRequest): Promise<SimulateResponse> {
  const response = await requestModelService<RawSimulateResponse>("/uplift", request, rawSimulateResponseSchema);
  const halifax = request.postalCode.trim().toUpperCase().startsWith("B");
  const version = response.modelVersion ?? (halifax ? "halifax-uplift-unavailable" : "seattle-uplift-unavailable");
  const evidenceLevel = response.status === "data-missing" ? "none" : halifax ? "observed" : "proxy";
  return {
    ...response,
    evidenceLevel,
    provenance: resultProvenance({
      engineType: halifax ? "rules" : "fitted-model",
      evidenceLevel,
      validationStatus: response.status === "data-missing" ? "not-applicable" : "descriptive",
      version,
      dataAsOf: null,
      sourceIds: halifax
        ? ["data/exports/halifax_uplift.json"]
        : ["Seattle building permits", "King County repeat sales", "King County residential buildings"],
      limitations: halifax
        ? ["Observational permit-linked repeat-sale summary with broad categories; not a causal treatment effect."]
        : ["Transferred from Seattle/King County observations; no Vancouver transportability validation."],
    }),
  };
}

export async function buildSalePlan(request: PlanRequest): Promise<PlanResponse> {
  const estimate = await estimateProperty(request);

  return buildPlan({
    request: { ...request, horizonMonths: request.timelineMonths },
    estimate,
    simulate: (simulateRequest) =>
      simulateScenario({
        ...simulateRequest,
        horizonMonths: request.timelineMonths,
      }),
    dataSources: {},
    provenance: {
      engineType: "composite",
      version: "live-plan-screening-v1",
      sourceIds: [],
      limitations: ["Default renovation costs and sequential timing are screening assumptions, not current quotes or a construction schedule."],
    },
    message: "Live mode plan calculated from the fitted model estimate and observed uplift evidence.",
    shouldSkipCandidate: (error) => error instanceof ModelServiceError && error.status >= 400 && error.status < 500,
  });
}
