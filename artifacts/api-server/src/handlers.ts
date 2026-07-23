import type { DealAnalyzeRequest, EstimateResponse, PlanRequest, PropertyInput, SimulateRequest } from "@vvl/shared";

import { analyzeDeal } from "./dealAnalysis";
import { isDemoModeEnabled, isPublicModeEnabled } from "./config";
import {
  buildDemoDealAnalyze,
  buildDemoEstimate,
  buildDemoPlan,
  buildDemoSimulate,
  getDemoMetrics,
} from "./demo";
import { buildSalePlan, estimateProperty, simulateScenario } from "./model";
import { buildPublicDealAnalyze, buildPublicEstimate, buildPublicPlan, buildPublicSimulate } from "./publicEngine";

export interface ApiHandlers {
  estimate: (request: PropertyInput) => Promise<EstimateResponse> | EstimateResponse;
  simulate: (request: SimulateRequest) => Promise<unknown> | unknown;
  plan: (request: PlanRequest) => Promise<unknown> | unknown;
  deal: (request: DealAnalyzeRequest) => Promise<unknown> | unknown;
  insights: () => unknown;
}

// Adding a new runtime mode requires updating this factory only.
export function resolveHandlers(): ApiHandlers {
  if (isDemoModeEnabled()) {
    return {
      estimate: buildDemoEstimate,
      simulate: buildDemoSimulate,
      plan: buildDemoPlan,
      deal: buildDemoDealAnalyze,
      insights: getDemoMetrics,
    };
  }

  if (isPublicModeEnabled()) {
    return {
      estimate: buildPublicEstimate,
      simulate: buildPublicSimulate,
      plan: buildPublicPlan,
      deal: buildPublicDealAnalyze,
      insights: () => {
        throw Object.assign(new Error("Public mode has no server-side portfolio."), { statusCode: 409 });
      },
    };
  }

  return {
    estimate: estimateProperty,
    simulate: simulateScenario,
    plan: buildSalePlan,
    deal: analyzeDeal,
    insights: () => {
      throw Object.assign(new Error("Live mode has no server-side sample portfolio."), { statusCode: 409 });
    },
  };
}
