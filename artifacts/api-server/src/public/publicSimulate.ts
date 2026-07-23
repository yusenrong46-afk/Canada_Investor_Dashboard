import { WIDE_CONFIDENCE_RATIO, improvementCatalog, resultProvenance, type EstimateResponse, type PlannedFlag, type SimulateRequest, type SimulateResponse, type UpliftDriver } from "@vvl/shared";

import { hasReadyUpliftCategory, loadHalifaxUplift, type HalifaxUpliftFile } from "../halifaxUplift";
import { getVancouverSavedTrainingRows } from "../trainingRowsExport";
import { buildPublicEstimate, buildItemsForFlags, publicDataSources } from "./improvements";
import { percent, publicEvidenceDataAsOf, PUBLIC_RULES_SOURCE } from "./utils";

// Halifax simulate prefers the committed local repeat-sale uplift export over generic improvement assumptions.
function buildHalifaxObservedSimulate(request: SimulateRequest, estimate: EstimateResponse, upliftFile: HalifaxUpliftFile): SimulateResponse {
  const selectedFlags = request.plannedFlags ?? [];
  const categoryFlags = new Map<string, PlannedFlag[]>();
  const unmappedFlags: PlannedFlag[] = [];

  for (const flag of selectedFlags) {
    const category = upliftFile.flagCategoryMap[flag];
    if (!category || !upliftFile.categories[category]) {
      unmappedFlags.push(flag);
      continue;
    }
    categoryFlags.set(category, [...(categoryFlags.get(category) ?? []), flag]);
  }

  let upliftPercent = 0;
  let upliftPercentLow = 0;
  let upliftPercentHigh = 0;
  let readyCategoryCount = 0;
  const zeroContributionNotes: string[] = [];
  const topUpliftDrivers: UpliftDriver[] = [];
  const rowCounts: Record<string, number> = { evidenceComparables: estimate.marketContext.comparableCount };

  for (const [category, flags] of categoryFlags) {
    const observed = upliftFile.categories[category];
    const flagLabels = flags.map((flag) => improvementCatalog[flag].label).join(" + ");
    rowCounts[`${category.toLowerCase()}TreatedPairs`] = observed.treatedPairs;
    rowCounts[`${category.toLowerCase()}ControlPairs`] = observed.controlPairs;

    if (observed.status === "ready" && observed.medianExcessUpliftPercent != null) {
      readyCategoryCount += 1;
      upliftPercent += observed.medianExcessUpliftPercent;
      upliftPercentLow += observed.p25ExcessUpliftPercent ?? observed.medianExcessUpliftPercent;
      upliftPercentHigh += observed.p75ExcessUpliftPercent ?? observed.medianExcessUpliftPercent;
      topUpliftDrivers.push({
        flag: flags[0],
        label: `${flagLabels} (${category})`,
        value: Math.round(estimate.baseValue * observed.medianExcessUpliftPercent),
        upliftPercent: observed.medianExcessUpliftPercent,
        confidence: "medium",
        rationale: `Median excess uplift from ${observed.treatedPairs} treated repeat-sale pairs vs ${observed.controlPairs} matched controls. ${observed.note}`,
      });
    } else {
      zeroContributionNotes.push(`${category} contributes $0: ${observed.note}`);
      topUpliftDrivers.push({
        flag: flags[0],
        label: `${flagLabels} (${category})`,
        value: 0,
        upliftPercent: 0,
        confidence: "low",
        rationale: observed.note,
      });
    }
  }

  if (unmappedFlags.length) {
    zeroContributionNotes.push(`No observed Halifax uplift category covers: ${unmappedFlags.join(", ")} - these contribute $0.`);
  }

  const upliftValue = Math.round(estimate.baseValue * upliftPercent);
  const finalValueRaw = estimate.baseValue + upliftValue;
  const finalValueGuardrailed = Math.min(finalValueRaw, estimate.marketContext.practicalCeiling);

  return {
    provenance: resultProvenance({
      engineType: "rules",
      evidenceLevel: "observed",
      validationStatus: "descriptive",
      version: "public-halifax-observed-uplift-v1",
      dataAsOf: upliftFile.generatedAt,
      sourceIds: ["data/exports/halifax_uplift.json", "data/exports/market_evidence.json"],
      limitations: ["Observational permit-linked repeat-sale summary; broad renovation categories are not causal or separately measured effects."],
    }),
    status: "ready",
    message: "Public interactive mode: Halifax / Maritimes uplift comes from the committed local repeat-sale evidence export.",
    modelVersion: "public-halifax-observed-uplift-v1",
    trainingMode: "public-interactive-estimator",
    modelFamily: estimate.modelFamily,
    evidenceLevel: "observed",
    evidenceSummary: upliftFile.method,
    baseValue: estimate.baseValue,
    upliftPercent,
    treatedQuantileRange: {
      lowPercent: upliftPercentLow,
      highPercent: upliftPercentHigh,
      lowValue: Math.round(estimate.baseValue * upliftPercentLow),
      highValue: Math.round(estimate.baseValue * upliftPercentHigh),
    },
    upliftValue,
    finalValueRaw,
    finalValueGuardrailed,
    ceilingFlag: finalValueRaw > finalValueGuardrailed,
    plannedFlags: selectedFlags,
    topUpliftDrivers,
    observedShare: categoryFlags.size > 0 ? readyCategoryCount / categoryFlags.size : 1,
    dataSources: {
      ...publicDataSources(estimate),
      halifaxUplift: "data/exports/halifax_uplift.json",
    },
    rowCounts,
    methodNotes: [
      `Observed uplift source: ${upliftFile.source}.`,
      `Excess uplift percentiles use sale prices time-adjusted to the ${upliftFile.baselineMonth} baseline month.`,
      "Kitchen, bathroom, energy, maintenance, and roof selections share the same broad Renovation permit category; they are scope and cost labels, not separate measured effects.",
      ...zeroContributionNotes,
      "Categories without enough treated pairs contribute exactly $0 instead of an assumed percentage.",
      "Values are deal-screening estimates, not appraisals.",
    ],
  };
}

export function buildPublicSimulate(request: SimulateRequest): SimulateResponse {
  const estimate = buildPublicEstimate(request);

  if (estimate.market === "halifax_maritimes") {
    const upliftFile = loadHalifaxUplift();
    if (upliftFile && hasReadyUpliftCategory(upliftFile)) {
      return buildHalifaxObservedSimulate(request, estimate, upliftFile);
    }
    return {
      provenance: resultProvenance({
        engineType: "rules",
        evidenceLevel: "none",
        validationStatus: "not-applicable",
        version: "public-halifax-uplift-unavailable-v1",
        dataAsOf: publicEvidenceDataAsOf(),
        sourceIds: ["data/exports/halifax_uplift.json"],
        limitations: ["No reportable committed Halifax uplift evidence was available, so the calculation abstained."],
      }),
      status: "data-missing",
      message: "Halifax renovation uplift is unavailable because no reportable committed repeat-sale evidence category is loaded. No generic uplift assumption was substituted.",
      baseValue: estimate.baseValue,
      plannedFlags: request.plannedFlags ?? [],
      dataSources: publicDataSources(estimate),
      methodNotes: ["The public engine abstains instead of applying Vancouver or generic renovation assumptions to Halifax."],
    };
  }

  const selectedFlags = request.plannedFlags ?? [];
  const selectedItems = buildItemsForFlags(selectedFlags, request, estimate);
  const upliftValue = selectedItems.reduce((sum, item) => sum + item.projectedUplift, 0);
  const upliftPercent = percent(upliftValue, estimate.baseValue);
  const finalValueRaw = estimate.baseValue + upliftValue;
  const finalValueGuardrailed = Math.min(finalValueRaw, estimate.marketContext.practicalCeiling);
  const savedTrainingRows = getVancouverSavedTrainingRows();

  return {
    provenance: resultProvenance({
      engineType: "rules",
      evidenceLevel: "assumption",
      validationStatus: "unvalidated",
      version: "public-uplift-screening-v1",
      dataAsOf: publicEvidenceDataAsOf(),
      sourceIds: [PUBLIC_RULES_SOURCE, "data/exports/market_evidence.json"],
      limitations: ["Hand-authored uplift assumptions with an artificial range; not observed Vancouver renovation effects."],
    }),
    status: "ready",
    message: "Public interactive mode: calculated from the property inputs and selected improvements.",
    modelVersion: "public-uplift-screening-v1",
    trainingMode: "public-interactive-estimator",
    modelFamily: estimate.modelFamily,
    evidenceLevel: "assumption",
    evidenceSummary: "Public mode uses transparent uplift assumptions informed by the project workflow, then applies them to the current user-entered property.",
    baseValue: estimate.baseValue,
    upliftPercent,
    treatedQuantileRange: {
      lowPercent: Math.max(0, upliftPercent - 0.025),
      highPercent: upliftPercent + 0.025,
      lowValue: Math.max(0, upliftValue - estimate.baseValue * 0.025),
      highValue: upliftValue + estimate.baseValue * 0.025,
    },
    upliftValue,
    finalValueRaw,
    finalValueGuardrailed,
    ceilingFlag: finalValueRaw > finalValueGuardrailed,
    plannedFlags: selectedFlags,
    topUpliftDrivers: selectedItems.map((item) => ({
      flag: item.flag,
      label: item.label,
      value: item.projectedUplift,
      upliftPercent: item.projectedUpliftPercent,
      confidence: estimate.confidenceRatio > WIDE_CONFIDENCE_RATIO ? "low" : "medium",
      rationale: "Calculated from the current property estimate, improvement type, age, and local market ceiling.",
    })),
    observedShare: 1,
    dataSources: publicDataSources(estimate),
    rowCounts:
      estimate.market === "halifax_maritimes"
        ? { evidenceComparables: estimate.marketContext.comparableCount }
        : savedTrainingRows != null
          ? { savedTrainingRows }
          : {},
    methodNotes: [
      "Public mode is fully interactive and does not require private raw data.",
      "The Python model service remains available for live local mode.",
      "Values are deal-screening estimates, not appraisals.",
    ],
  };
}
