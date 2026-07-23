import { WIDE_CONFIDENCE_RATIO, type DealLabel, type DealRiskFlag, type PlannedFlag, type PropertyInput } from "@vvl/shared";

import { buildDealAnalyze, computeDealTargetPrice } from "../dealBuilder";
import { buildPublicPlan } from "./publicPlan";
import { buildPublicEstimate } from "./improvements";

function percent(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

function chooseDealLabel(netUpsidePercent: number, flags: DealRiskFlag[]): DealLabel {
  if (netUpsidePercent < 0) {
    return "Pass for now";
  }
  if (flags.some((flag) => flag.level === "danger")) {
    return "Needs caution";
  }
  if (netUpsidePercent >= 0.08 && !flags.some((flag) => flag.level === "warning")) {
    return "Worth review";
  }
  if (netUpsidePercent >= 0.03) {
    return "Worth review";
  }
  return "Needs caution";
}

export async function buildPublicDealAnalyze(
  request: PropertyInput & { askingPrice: number; budget: number; timelineMonths: number; plannedFlags?: PlannedFlag[] },
) {
  const estimate = buildPublicEstimate(request);
  const targetPrice = computeDealTargetPrice(request.askingPrice, estimate.baseValue);
  const plan = await buildPublicPlan({
    ...request,
    targetPrice,
    plannedFlags: request.plannedFlags ?? [],
  });

  const modeledValueGap = Math.round(estimate.baseValue - request.askingPrice);
  const valueGapPercent = Number(percent(modeledValueGap, request.askingPrice).toFixed(4));

  return buildDealAnalyze({
    request: { ...request, plannedFlags: request.plannedFlags ?? [] },
    estimate,
    plan,
    provenance: {
      engineType: "rules",
      evidenceLevel: estimate.market === "halifax_maritimes" ? "mixed" : "assumption",
      validationStatus: estimate.market === "halifax_maritimes" ? "descriptive" : "unvalidated",
      version: "public-deal-screening-v1",
      sourceIds: [],
      limitations: [
        "Screening result excludes transaction, financing, tax, operating, vacancy, carrying, and sale costs.",
        "The seeded triangular stress test is illustrative and does not produce calibrated probabilities.",
      ],
    },
    buildRiskFlags: ({ plan: planResult, netUpsidePercent }) => {
      const riskFlags: DealRiskFlag[] = [
        {
          level: modeledValueGap >= 0 ? "info" : "warning",
          label: modeledValueGap >= 0 ? "Asking price is supported by the estimate" : "Asking price is above the estimate",
          detail: `The model estimate is ${Math.abs(valueGapPercent * 100).toFixed(1)}% ${modeledValueGap >= 0 ? "above" : "below"} the asking price.`,
        },
        {
          level: "info",
          label: "Interactive public estimate",
          detail: "This result is calculated from the current property, budget, timeline, and improvement choices.",
        },
      ];

      if (estimate.confidenceRatio >= WIDE_CONFIDENCE_RATIO) {
        riskFlags.push({
          level: "warning",
          label: "Wide confidence range",
          detail: "This property type or location has more uncertainty, so comparable listings should be reviewed manually.",
        });
      }

      if ((planResult.plannedSpend ?? 0) < request.budget * 0.4) {
        riskFlags.push({
          level: "warning",
          label: "Budget is not fully used",
          detail: "The current timeline or selected scope leaves part of the budget unused. Test a longer timeline or different improvements.",
        });
      }

      if ((planResult.plannedSpend ?? 0) > request.budget) {
        riskFlags.push({
          level: "danger",
          label: "Committed scope exceeds the renovation budget",
          detail: `Selected work is costed at ${(planResult.plannedSpend ?? 0).toLocaleString("en-CA")} dollars against an ${request.budget.toLocaleString("en-CA")} dollar budget.`,
        });
      }

      if (estimate.market === "halifax_maritimes") {
        riskFlags.push({
          level: "info",
          label: "Halifax uplift is one broad permit-renovation signal",
          detail: "Several improvement controls map to one observed HRM renovation category, so their measured effects do not stack.",
        });
      }

      if (netUpsidePercent < 0.03) {
        riskFlags.push({
          level: netUpsidePercent < 0 ? "danger" : "warning",
          label: "Thin net upside after renovation spend",
          detail: "Closing costs, carrying costs, and financing are still excluded and could erase this margin.",
        });
      }

      return riskFlags;
    },
    chooseLabel: (netUpsidePercent, _valueGapPercent, flags) => chooseDealLabel(netUpsidePercent, flags),
  });
}
