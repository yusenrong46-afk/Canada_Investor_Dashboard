import {
  improvementCatalog,
  type EstimateResponse,
  type PlannedFlag,
  type PlanLineItem,
  type PlanRequest,
  type PlanResponse,
  type PropertyInput,
  type SimulateRequest,
  type SimulateResponse,
} from "@vvl/shared";

const modelServiceBaseUrl = (process.env.MODEL_SERVICE_URL ?? "http://127.0.0.1:5001").replace(/\/$/, "");

async function requestModelService<TResponse>(path: string, payload?: object): Promise<TResponse> {
  // Live local mode delegates model inference to Flask; demo/public modes bypass this boundary.
  const response = await fetch(`${modelServiceBaseUrl}${path}`, {
    method: payload ? "POST" : "GET",
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });

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
    throw new Error(message ?? `Model service request failed (${response.status})`);
  }

  return parsedBody as TResponse;
}

export async function estimateProperty(property: PropertyInput): Promise<EstimateResponse> {
  return requestModelService<EstimateResponse>("/estimate", property);
}

export async function simulateScenario(request: SimulateRequest): Promise<SimulateResponse> {
  return requestModelService<SimulateResponse>("/uplift", request);
}

function byValueDescending(items: PlanLineItem[]): PlanLineItem[] {
  return [...items].sort((left, right) => {
    if (right.projectedUplift !== left.projectedUplift) {
      return right.projectedUplift - left.projectedUplift;
    }
    return right.valueRecoveryRate - left.valueRecoveryRate;
  });
}

function buildPhases(items: PlanLineItem[]): PlanResponse["phases"] {
  const grouped = new Map<string, PlanLineItem[]>();
  for (const item of items) {
    const existing = grouped.get(item.phase) ?? [];
    existing.push(item);
    grouped.set(item.phase, existing);
  }

  return Array.from(grouped.entries()).map(([phase, phaseItems]) => ({
    phase,
    durationMonths: phaseItems.reduce((sum, item) => sum + item.months, 0),
    plannedSpend: phaseItems.reduce((sum, item) => sum + item.cost, 0),
    plannedUplift: phaseItems.reduce((sum, item) => sum + item.projectedUplift, 0),
    items: phaseItems,
  }));
}

function assessTarget(achievableValue: number, targetPrice: number): "Likely" | "Stretch" | "Unlikely" {
  if (achievableValue >= targetPrice) {
    return "Likely";
  }

  const shortfallRatio = targetPrice > 0 ? (targetPrice - achievableValue) / targetPrice : 1;
  if (shortfallRatio <= 0.05) {
    return "Stretch";
  }

  return "Unlikely";
}

export async function buildSalePlan(request: PlanRequest): Promise<PlanResponse> {
  const baseline = await simulateScenario({
    ...request,
    plannedFlags: request.plannedFlags ?? [],
    horizonMonths: request.timelineMonths,
  });

  if (baseline.status !== "ready") {
    return {
      status: "data-missing",
      message: baseline.message ?? "The Seattle observed uplift model did not return a ready result.",
      dataSources: baseline.dataSources,
      methodNotes: baseline.methodNotes,
    };
  }

  const selectedFlags = new Set<PlannedFlag>((request.plannedFlags ?? []) as PlannedFlag[]);
  const candidates = (Object.keys(improvementCatalog) as PlannedFlag[]).filter((flag) => !selectedFlags.has(flag));
  let candidateDataMissing: SimulateResponse | undefined;
  const candidateRows = (
    await Promise.all(
      candidates.map(async (flag): Promise<PlanLineItem | null> => {
        const catalogItem = improvementCatalog[flag];
        const scenario = await simulateScenario({
          ...request,
          plannedFlags: [...selectedFlags, flag],
          horizonMonths: request.timelineMonths,
        });

        if (scenario.status === "data-missing") {
          candidateDataMissing = candidateDataMissing ?? scenario;
          return null;
        }

        if (
          scenario.upliftValue == null ||
          scenario.finalValueGuardrailed == null ||
          baseline.upliftValue == null
        ) {
          return null;
        }

        const incrementalUplift = scenario.upliftValue - baseline.upliftValue;
        const incrementalUpliftPercent = scenario.upliftPercent != null && baseline.upliftPercent != null ? scenario.upliftPercent - baseline.upliftPercent : undefined;
        const valueRecoveryRate = catalogItem.defaultCost > 0 ? incrementalUplift / catalogItem.defaultCost : 0;

        return {
          flag,
          label: catalogItem.label,
          phase: catalogItem.phase,
          cost: catalogItem.defaultCost,
          months: catalogItem.months,
          projectedUplift: Math.round(incrementalUplift),
          projectedUpliftPercent: incrementalUpliftPercent,
          projectedFinalValue: scenario.finalValueGuardrailed,
          valueRecoveryRate,
        };
      }),
    )
  ).filter((item): item is PlanLineItem => item != null);

  if (!candidateRows.length && candidateDataMissing) {
    return {
      status: "data-missing",
      message: candidateDataMissing.message,
      dataSources: candidateDataMissing.dataSources,
      methodNotes: candidateDataMissing.methodNotes,
    };
  }

  const chosen: PlanLineItem[] = [];
  let remainingBudget = request.budget;
  let remainingMonths = request.timelineMonths;

  // Greedy selection keeps the planner easy to explain: pick the strongest positive-value actions that fit the limits.
  for (const item of byValueDescending(candidateRows)) {
    if (item.cost > remainingBudget || item.months > remainingMonths || item.projectedUplift <= 0) {
      continue;
    }
    chosen.push(item);
    remainingBudget -= item.cost;
    remainingMonths -= item.months;
  }

  const finalScenario = chosen.length
    ? await simulateScenario({
        ...request,
        plannedFlags: [...selectedFlags, ...chosen.map((item) => item.flag)],
        horizonMonths: request.timelineMonths,
      })
    : baseline;

  const achievableValue = finalScenario.finalValueGuardrailed ?? baseline.finalValueGuardrailed ?? request.targetPrice;
  return {
    status: "ready",
    evidenceLevel: finalScenario.evidenceLevel,
    targetAssessment: assessTarget(achievableValue, request.targetPrice),
    baseValue: baseline.baseValue,
    achievableValue,
    targetPrice: request.targetPrice,
    gapToTarget: request.targetPrice - achievableValue,
    plannedSpend: chosen.reduce((sum, item) => sum + item.cost, 0),
    plannedMonths: chosen.reduce((sum, item) => sum + item.months, 0),
    items: chosen,
    phases: buildPhases(chosen),
  };
}
