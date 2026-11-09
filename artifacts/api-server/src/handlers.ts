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
  /** Only demo mode has a server-side sample portfolio; other modes answer /api/insights with 409. */
  insights?: () => unknown;
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
    };
  }

  return {
    estimate: estimateProperty,
    simulate: simulateScenario,
    plan: buildSalePlan,
    deal: analyzeDeal,
  };
}
