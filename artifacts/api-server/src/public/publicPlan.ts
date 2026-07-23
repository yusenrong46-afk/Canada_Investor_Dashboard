import type { PlanRequest, PlanResponse } from "@vvl/shared";

import { buildPlan } from "../planBuilder";
import { buildPublicEstimate, publicDataSources } from "./improvements";
import { buildPublicSimulate } from "./publicSimulate";
import { PUBLIC_RULES_SOURCE } from "./utils";

export async function buildPublicPlan(request: PlanRequest): Promise<PlanResponse> {
  const estimate = buildPublicEstimate(request);

  return buildPlan({
    request,
    estimate,
    simulate: buildPublicSimulate,
    dataSources: publicDataSources(estimate),
    provenance: {
      engineType: "rules",
      version: "public-plan-screening-v1",
      sourceIds: [PUBLIC_RULES_SOURCE],
      limitations: ["Default renovation costs and sequential timing are screening assumptions, not current quotes or a construction schedule."],
    },
    message: "Public interactive mode: plan is calculated from the current property, budget, timeline, and improvement choices.",
  });
}
