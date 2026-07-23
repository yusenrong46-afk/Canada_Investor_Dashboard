import { ZodError } from "zod/v4";

import {
  improvementCatalog,
  improvementFlagValues,
  resultProvenance,
  type EstimateResponse,
  type PlannedFlag,
  type PlanLineItem,
  type PlanPhase,
  type PlanRequest,
  type PlanResponse,
  type SimulateRequest,
  type SimulateResponse,
} from "@vvl/shared";

function percent(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

function byValueRecovery(items: PlanLineItem[]): PlanLineItem[] {
  return [...items].sort((left, right) => {
    if (right.valueRecoveryRate !== left.valueRecoveryRate) {
      return right.valueRecoveryRate - left.valueRecoveryRate;
    }
    return right.projectedUplift - left.projectedUplift;
  });
}

function phaseRows(items: PlanLineItem[]): PlanPhase[] {
  const phases = new Map<string, PlanLineItem[]>();

  for (const item of items) {
    phases.set(item.phase, [...(phases.get(item.phase) ?? []), item]);
  }

  return Array.from(phases.entries()).map(([phase, phaseItems]) => ({
    phase,
    durationMonths: phaseItems.reduce((sum, item) => sum + item.months, 0),
    plannedSpend: phaseItems.reduce((sum, item) => sum + item.cost, 0),
    plannedUplift: phaseItems.reduce((sum, item) => sum + item.projectedUplift, 0),
    items: phaseItems,
  }));
}

function targetAssessment(
  achievableValue: number,
  targetPrice: number,
  conservativeValue?: number,
): "Meets target" | "Near target" | "Below target" {
  if ((conservativeValue ?? achievableValue) >= targetPrice) {
    return "Meets target";
  }
  if (achievableValue >= targetPrice) {
    return "Near target";
  }
  if (percent(targetPrice - achievableValue, targetPrice) <= 0.05) {
    return "Near target";
  }
  return "Below target";
}

export type PlanSimulateFn = (request: SimulateRequest) => Promise<SimulateResponse> | SimulateResponse;

export interface PlanBuilderOptions {
  request: PlanRequest;
  estimate: EstimateResponse;
  simulate: PlanSimulateFn;
  dataSources: Record<string, string>;
  provenance: {
    engineType: "rules" | "composite" | "precomputed-demo";
    version: string;
    sourceIds: string[];
    limitations: string[];
  };
  message: string;
  /** Return true to skip a candidate flag after a non-fatal simulate failure. */
  shouldSkipCandidate?: (error: unknown, flag: PlannedFlag) => boolean;
}

function simulateCacheKey(request: SimulateRequest): string {
  const flags = [...(request.plannedFlags ?? [])].sort();
  return JSON.stringify({
    postalCode: request.postalCode,
    propertyType: request.propertyType,
    livingAreaSqft: request.livingAreaSqft,
    bedrooms: request.bedrooms,
    bathrooms: request.bathrooms,
    yearBuilt: request.yearBuilt,
    knownCurrentValue: request.knownCurrentValue,
    horizonMonths: request.horizonMonths ?? null,
    plannedFlags: flags,
  });
}

function withSimulateCache(simulate: PlanSimulateFn): PlanSimulateFn {
  const cache = new Map<string, SimulateResponse>();
  return async (request) => {
    const key = simulateCacheKey(request);
    const hit = cache.get(key);
    if (hit) {
      return hit;
    }
    const response = await simulate(request);
    cache.set(key, response);
    return response;
  };
}

function toSimulateRequest(request: PlanRequest, plannedFlags: PlannedFlag[]): SimulateRequest {
  return {
    ...request,
    plannedFlags,
    horizonMonths: request.timelineMonths,
  };
}

async function runSimulate(simulate: PlanSimulateFn, request: PlanRequest, plannedFlags: PlannedFlag[]): Promise<SimulateResponse> {
  return await simulate(toSimulateRequest(request, plannedFlags));
}

function buildLineItem(
  flag: PlannedFlag,
  previousScenario: SimulateResponse,
  nextScenario: SimulateResponse,
  estimate: EstimateResponse,
  origin: PlanLineItem["origin"],
): PlanLineItem {
  const catalogItem = improvementCatalog[flag];
  const previousUplift = previousScenario.upliftValue ?? 0;
  const nextUplift = nextScenario.upliftValue ?? previousUplift;
  const projectedUplift = nextUplift - previousUplift;

  return {
    flag,
    label: catalogItem.label,
    phase: catalogItem.phase,
    cost: catalogItem.defaultCost,
    months: catalogItem.months,
    projectedUplift,
    projectedUpliftPercent:
      nextScenario.upliftPercent != null && previousScenario.upliftPercent != null
        ? nextScenario.upliftPercent - previousScenario.upliftPercent
        : undefined,
    projectedFinalValue: nextScenario.finalValueGuardrailed ?? estimate.baseValue,
    valueRecoveryRate: catalogItem.defaultCost > 0 ? projectedUplift / catalogItem.defaultCost : 0,
    origin,
  };
}

export async function buildPlan(options: PlanBuilderOptions): Promise<PlanResponse> {
  const { request, estimate, dataSources, provenance, message } = options;
  const simulate = withSimulateCache(options.simulate);
  const shouldSkipCandidate =
    options.shouldSkipCandidate ??
    ((error: unknown) => {
      if (error instanceof ZodError) {
        return true;
      }
      return false;
    });

  const selectedFlags = [...new Set(request.plannedFlags ?? [])];
  const emptyBaseline = await runSimulate(simulate, request, []);
  if (emptyBaseline.status !== "ready") {
    return {
      provenance: emptyBaseline.provenance,
      status: "data-missing",
      message: emptyBaseline.message,
      dataSources: emptyBaseline.dataSources,
      methodNotes: emptyBaseline.methodNotes,
    };
  }

  let selectedScenario = emptyBaseline;
  const selectedItems: PlanLineItem[] = [];
  const selectedSoFar: PlannedFlag[] = [];

  for (const flag of selectedFlags) {
    const previousScenario = selectedScenario;
    selectedSoFar.push(flag);
    selectedScenario = await runSimulate(simulate, request, selectedSoFar);
    if (selectedScenario.status !== "ready") {
      return {
        provenance: selectedScenario.provenance,
        status: "data-missing",
        message: selectedScenario.message,
        dataSources: selectedScenario.dataSources,
        methodNotes: selectedScenario.methodNotes,
      };
    }
    selectedItems.push(buildLineItem(flag, previousScenario, selectedScenario, estimate, "committed"));
  }

  const chosen: PlanLineItem[] = [];
  const committedSpend = selectedItems.reduce((sum, item) => sum + item.cost, 0);
  const committedMonths = selectedItems.reduce((sum, item) => sum + item.months, 0);
  let remainingBudget = Math.max(0, request.budget - committedSpend);
  let remainingMonths = Math.max(0, request.timelineMonths - committedMonths);
  let currentFlags = [...selectedSoFar];
  let currentScenario = selectedScenario;
  const skippedCandidateNotes: string[] = [];
  const remainingCandidates = new Set(improvementFlagValues.filter((flag) => !selectedFlags.includes(flag)));

  while (remainingBudget > 0 && remainingMonths > 0 && remainingCandidates.size > 0) {
    const candidateItems: PlanLineItem[] = [];

    for (const flag of remainingCandidates) {
      try {
        const scenario = await runSimulate(simulate, request, [...currentFlags, flag]);
        if (scenario.status !== "ready") {
          continue;
        }
        const item = buildLineItem(flag, currentScenario, scenario, estimate, "recommended");
        if (item.projectedUplift > 0) {
          candidateItems.push(item);
        }
      } catch (error) {
        if (shouldSkipCandidate(error, flag)) {
          skippedCandidateNotes.push(
            `${improvementCatalog[flag].label} was not recommended because its observed evidence is not reportable for this market.`,
          );
          remainingCandidates.delete(flag);
          continue;
        }
        throw error;
      }
    }

    const nextItem = byValueRecovery(candidateItems).find((item) => item.cost <= remainingBudget && item.months <= remainingMonths);
    if (!nextItem) {
      break;
    }

    chosen.push(nextItem);
    currentFlags.push(nextItem.flag);
    remainingCandidates.delete(nextItem.flag);
    remainingBudget -= nextItem.cost;
    remainingMonths -= nextItem.months;
    currentScenario = await runSimulate(simulate, request, currentFlags);
    if (currentScenario.status !== "ready") {
      return {
        provenance: currentScenario.provenance,
        status: "data-missing",
        message: currentScenario.message,
        dataSources: currentScenario.dataSources,
        methodNotes: currentScenario.methodNotes,
      };
    }
  }

  const items = [...selectedItems, ...chosen];
  const plannedSpend = items.reduce((sum, item) => sum + item.cost, 0);
  const plannedMonths = items.reduce((sum, item) => sum + item.months, 0);
  const finalScenario = await runSimulate(simulate, request, items.map((item) => item.flag));
  if (finalScenario.status !== "ready") {
    return {
      provenance: finalScenario.provenance,
      status: "data-missing",
      message: finalScenario.message,
      dataSources: finalScenario.dataSources,
      methodNotes: finalScenario.methodNotes,
    };
  }

  const achievableValue = Math.min(
    finalScenario.finalValueGuardrailed ?? estimate.baseValue + (finalScenario.upliftValue ?? 0),
    estimate.marketContext.practicalCeiling,
  );
  const plannedUplift = Math.max(0, achievableValue - estimate.baseValue);

  let runningValue = estimate.baseValue;
  const reconciledItems = items.map((item) => {
    runningValue = Math.min(runningValue + item.projectedUplift, estimate.marketContext.practicalCeiling);
    return {
      ...item,
      projectedFinalValue: runningValue,
    };
  });

  const conservativeValue =
    finalScenario.baseValue != null && finalScenario.treatedQuantileRange != null
      ? Math.min(finalScenario.baseValue + finalScenario.treatedQuantileRange.lowValue, achievableValue)
      : achievableValue;

  const methodNotes = [
    ...(finalScenario.methodNotes ?? []),
    ...skippedCandidateNotes,
    ...(committedSpend > request.budget
      ? [`Committed scope costs ${committedSpend.toLocaleString("en-CA")} dollars, above the ${request.budget.toLocaleString("en-CA")} dollar budget.`]
      : []),
    ...(committedMonths > request.timelineMonths
      ? [`Committed scope needs ${committedMonths} months, above the ${request.timelineMonths}-month timeline.`]
      : []),
    ...(plannedSpend > request.budget
      ? [`Total planned spend is ${plannedSpend.toLocaleString("en-CA")} dollars, above the ${request.budget.toLocaleString("en-CA")} dollar budget.`]
      : []),
    ...(plannedMonths > request.timelineMonths
      ? [`Total planned duration is ${plannedMonths} months, above the ${request.timelineMonths}-month timeline.`]
      : []),
    `Combined plan uplift reconciles to ${plannedUplift.toLocaleString("en-CA")} dollars against the final simulated value.`,
    "The app still needs comparable-sale review, transaction costs, and financing assumptions before a real decision.",
  ];

  return {
    provenance: resultProvenance({
      engineType: provenance.engineType,
      evidenceLevel: finalScenario.provenance.evidenceLevel,
      validationStatus: finalScenario.provenance.validationStatus,
      version: provenance.version,
      dataAsOf: finalScenario.provenance.dataAsOf,
      sourceIds: [...new Set([...finalScenario.provenance.sourceIds, ...provenance.sourceIds])],
      limitations: [...finalScenario.provenance.limitations, ...provenance.limitations],
    }),
    status: "ready",
    message,
    evidenceLevel: finalScenario.provenance.evidenceLevel,
    dataSources,
    methodNotes,
    targetAssessment: targetAssessment(achievableValue, request.targetPrice, conservativeValue),
    baseValue: estimate.baseValue,
    achievableValue,
    targetPrice: request.targetPrice,
    gapToTarget: request.targetPrice - achievableValue,
    plannedSpend,
    plannedMonths,
    upliftConfidenceLow: finalScenario.treatedQuantileRange?.lowValue,
    upliftConfidenceHigh: finalScenario.treatedQuantileRange?.highValue,
    items: reconciledItems,
    phases: phaseRows(reconciledItems),
  };
}
