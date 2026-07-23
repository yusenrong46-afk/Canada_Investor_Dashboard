import { z } from "zod/v4";

import { improvementFlagValues, propertyTypeValues } from "./constants";
import { API_CONTRACT_VERSION, evidenceLevelValues, resultProvenanceSchema } from "./provenance";

const nullableMetricSchema = z.number().finite().nullable();

const metricRangeSummarySchema = z.object({
  mean: nullableMetricSchema,
  p05: nullableMetricSchema,
  p50: nullableMetricSchema,
  p95: nullableMetricSchema,
});

const validationSummarySchema = z.object({
  trainHoldoutSplit: z.string(),
  crossValidation: z.string(),
  bootstrap: z.string(),
  bootstrapRanges: z.object({
    mae: metricRangeSummarySchema,
    mape: metricRangeSummarySchema,
    r2: metricRangeSummarySchema,
  }),
  missingnessNotes: z.array(z.string()),
  locationFeatures: z.string(),
  clusterCount: z.number().int().nonnegative(),
});

const modelQualitySchema = z
  .object({
    trainingRows: z.number().int().nonnegative(),
    cvMae: nullableMetricSchema,
    cvMape: nullableMetricSchema,
    cvR2: nullableMetricSchema,
    holdoutMae: nullableMetricSchema,
    holdoutMape: nullableMetricSchema,
    holdoutR2: nullableMetricSchema,
    outlierRemovedRate: nullableMetricSchema,
    validationSummary: validationSummarySchema,
  })
  .passthrough();

const driverSchema = z.object({
  label: z.string(),
  value: z.number().finite(),
  source: z.enum(["shap", "heuristic"]).optional(),
});

const marketContextSchema = z
  .object({
    localAreaLabel: z.string(),
    localAreaScope: z.enum(["postal-code", "fsa", "city-property-type", "city"]),
    localMedianValue: z.number().finite(),
    localMedianPricePerSqft: z.number().finite(),
    cityMedianValue: z.number().finite(),
    cityMedianPricePerSqft: z.number().finite(),
    vancouverMedianValue: z.number().finite().optional(),
    vancouverMedianPricePerSqft: z.number().finite().optional(),
    percentileRank: z.number().finite(),
    practicalCeiling: z.number().finite(),
    premiumGap: z.number().finite(),
    comparableCount: z.number().int().nonnegative(),
  })
  .passthrough();

const estimateResponseShape = {
  provenance: resultProvenanceSchema,
  modelVersion: z.string().min(1),
  trainingMode: z.string().min(1),
    modelFamily: z.enum(["xgboost", "random-forest", "rules", "precomputed"]),
  modelScope: z.enum(propertyTypeValues),
  market: z.string().min(1),
  marketLabel: z.string().min(1),
  baseValue: z.number().finite().nonnegative(),
  confidenceLow: z.number().finite().nonnegative(),
  confidenceHigh: z.number().finite().nonnegative(),
  anchorValue: z.number().finite().nonnegative(),
  pricePerSqft: z.number().finite().nonnegative(),
  confidenceRatio: z.number().finite().nonnegative(),
  modelQuality: modelQualitySchema,
  drivers: z.array(driverSchema),
  marketContext: marketContextSchema,
  uncertainty: z
    .object({
      method: z.enum(["conformal", "error-ratio", "sample-range"]),
      targetCoverage: z.number().min(0).max(1).optional(),
      empiricalCoverage: z.number().min(0).max(1).nullable().optional(),
      calibrationNote: z.string().optional(),
    })
    .optional(),
  explanationMethod: z.enum(["shap", "heuristic"]).optional(),
  marketFreshness: z
    .object({
      status: z.enum(["adjusted", "not-applied", "embedded-in-target"]),
      message: z.string(),
      multiplier: z.number().finite().optional(),
      baselinePeriod: z.string().optional(),
      latestPeriod: z.string().optional(),
      dataSource: z.string().optional(),
    })
    .passthrough()
    .optional(),
} as const;

export const estimateResponseSchema = z
  .object(estimateResponseShape)
  .passthrough()
  .superRefine((value, context) => {
    if (value.confidenceLow > value.baseValue || value.baseValue > value.confidenceHigh) {
      context.addIssue({
        code: "custom",
        path: ["confidenceLow"],
        message: "Estimate confidence bounds must contain baseValue.",
      });
    }
    if (value.provenance.version !== value.modelVersion) {
      context.addIssue({
        code: "custom",
        path: ["provenance", "version"],
        message: "Estimate provenance version must match modelVersion.",
      });
    }
    if (value.provenance.engineType === "rules" && value.modelFamily !== "rules") {
      context.addIssue({
        code: "custom",
        path: ["modelFamily"],
        message: "A rules estimate must report modelFamily=rules.",
      });
    }
  });

const { provenance: _estimateProvenanceSchema, ...rawEstimateResponseShape } = estimateResponseShape;
export const rawEstimateResponseSchema = z
  .object(rawEstimateResponseShape)
  .passthrough()
  .superRefine((value, context) => {
    if (value.confidenceLow > value.baseValue || value.baseValue > value.confidenceHigh) {
      context.addIssue({
        code: "custom",
        path: ["confidenceLow"],
        message: "Estimate confidence bounds must contain baseValue.",
      });
    }
  });

const upliftDriverSchema = z.object({
  flag: z.enum(improvementFlagValues),
  label: z.string(),
  value: z.number().finite(),
  upliftPercent: z.number().finite().optional(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
  rationale: z.string().optional(),
});

const treatedQuantileRangeSchema = z.object({
  lowPercent: z.number().finite(),
  highPercent: z.number().finite(),
  lowValue: z.number().finite(),
  highValue: z.number().finite(),
});

const simulateResponseShape = {
  provenance: resultProvenanceSchema,
  status: z.enum(["ready", "data-missing"]),
  message: z.string().optional(),
  modelVersion: z.string().optional(),
  trainingMode: z.string().optional(),
  modelFamily: z.enum(["xgboost", "random-forest", "rules", "precomputed"]).optional(),
  evidenceLevel: z.enum(evidenceLevelValues).optional(),
  evidenceSummary: z.string().optional(),
  baseValue: z.number().finite().optional(),
  upliftPercent: z.number().finite().optional(),
  treatedQuantileRange: treatedQuantileRangeSchema.optional(),
  upliftValue: z.number().finite().optional(),
  finalValueRaw: z.number().finite().optional(),
  finalValueGuardrailed: z.number().finite().optional(),
  ceilingFlag: z.boolean().optional(),
  plannedFlags: z.array(z.enum(improvementFlagValues)).optional(),
  topUpliftDrivers: z.array(upliftDriverSchema).optional(),
  observedShare: z.number().min(0).max(1).optional(),
  dataSources: z.record(z.string(), z.string()).optional(),
  rowCounts: z.record(z.string(), z.number().finite()).optional(),
  methodNotes: z.array(z.string()).optional(),
} as const;

export const simulateResponseSchema = z
  .object(simulateResponseShape)
  .passthrough()
  .superRefine((value, context) => {
    if (value.evidenceLevel && value.evidenceLevel !== value.provenance.evidenceLevel) {
      context.addIssue({
        code: "custom",
        path: ["evidenceLevel"],
        message: "Top-level evidenceLevel must match provenance.evidenceLevel.",
      });
    }
    if (value.modelVersion && value.modelVersion !== value.provenance.version) {
      context.addIssue({
        code: "custom",
        path: ["provenance", "version"],
        message: "Simulation provenance version must match modelVersion.",
      });
    }
  });

export const rawSimulateResponseSchema = z.object({
  ...simulateResponseShape,
  provenance: z.never().optional(),
});

const planLineItemSchema = z.object({
  flag: z.enum(improvementFlagValues),
  label: z.string(),
  phase: z.string(),
  cost: z.number().finite().nonnegative(),
  months: z.number().finite().nonnegative(),
  projectedUplift: z.number().finite(),
  projectedUpliftPercent: z.number().finite().optional(),
  projectedFinalValue: z.number().finite(),
  valueRecoveryRate: z.number().finite(),
  origin: z.enum(["committed", "recommended"]).optional(),
});

const planPhaseSchema = z.object({
  phase: z.string(),
  durationMonths: z.number().finite().nonnegative(),
  plannedSpend: z.number().finite().nonnegative(),
  plannedUplift: z.number().finite(),
  items: z.array(planLineItemSchema),
});

export const planResponseSchema = z
  .object({
    provenance: resultProvenanceSchema,
    status: z.enum(["ready", "data-missing"]),
    message: z.string().optional(),
    evidenceLevel: z.enum(evidenceLevelValues).optional(),
    dataSources: z.record(z.string(), z.string()).optional(),
    methodNotes: z.array(z.string()).optional(),
    targetAssessment: z.enum(["Meets target", "Near target", "Below target"]).optional(),
    baseValue: z.number().finite().optional(),
    achievableValue: z.number().finite().optional(),
    targetPrice: z.number().finite().optional(),
    gapToTarget: z.number().finite().optional(),
    plannedSpend: z.number().finite().nonnegative().optional(),
    plannedMonths: z.number().finite().nonnegative().optional(),
    upliftConfidenceLow: z.number().finite().optional(),
    upliftConfidenceHigh: z.number().finite().optional(),
    items: z.array(planLineItemSchema).optional(),
    phases: z.array(planPhaseSchema).optional(),
  })
  .superRefine((value, context) => {
    if (value.evidenceLevel && value.evidenceLevel !== value.provenance.evidenceLevel) {
      context.addIssue({
        code: "custom",
        path: ["evidenceLevel"],
        message: "Top-level evidenceLevel must match provenance.evidenceLevel.",
      });
    }
  });

const riskFlagSchema = z.object({
  level: z.enum(["info", "warning", "danger"]),
  label: z.string(),
  detail: z.string(),
});

const dealRobustnessSchema = z.object({
  method: z.literal("seeded-triangular-stress-test"),
  draws: z.number().int().positive(),
  positiveUpsideShare: z.number().min(0).max(1),
  targetAchievableShare: z.number().min(0).max(1).nullable(),
  upsideP10: z.number().finite(),
  upsideP50: z.number().finite(),
  upsideP90: z.number().finite(),
  note: z.string(),
});

export const dealAnalyzeResponseSchema = z.object({
  provenance: resultProvenanceSchema,
  dealLabel: z.enum(["Worth review", "Needs caution", "Pass for now"]),
  modeledValueGap: z.number().finite(),
  valueGapPercent: z.number().finite(),
  afterPlanValue: z.number().finite(),
  estimatedGrossUpside: z.number().finite(),
  grossUpsidePercent: z.number().finite(),
  estimatedNetUpside: z.number().finite(),
  netUpsidePercent: z.number().finite(),
  riskFlags: z.array(riskFlagSchema),
  estimate: estimateResponseSchema,
  plan: planResponseSchema,
  robustness: dealRobustnessSchema.optional(),
});

const insightRowSchema = z.object({
  id: z.string(),
  propertyType: z.enum(propertyTypeValues),
  livingAreaSqft: z.number().finite(),
  bedrooms: z.number().finite(),
  bathrooms: z.number().finite(),
  estimatedValue: z.number().finite(),
  pricePerSqft: z.number().finite(),
  budget: z.number().finite(),
  targetPrice: z.number().finite(),
  estimatedUpside: z.number().finite(),
  riskLevel: z.enum(["Low", "Medium", "High"]),
  verdict: z.string(),
  warnings: z.array(z.string()),
});

export const insightsResponseSchema = z.object({
  provenance: resultProvenanceSchema,
  mode: z.enum(["demo-safe", "public-interactive"]),
  note: z.string(),
  summary: z.object({
    averageEstimatedValue: z.number().finite(),
    medianEstimatedValue: z.number().finite(),
    averagePricePerSqft: z.number().finite(),
    samplePropertyCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative(),
  }),
  rows: z.array(insightRowSchema),
  dataQualityNotes: z.array(z.string()),
});

export const apiHealthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("api-server"),
  mode: z.enum(["live-model", "public-interactive", "demo-samples"]),
  contractVersion: z.literal(API_CONTRACT_VERSION),
  modelServiceReady: z.boolean().optional(),
});

const marketMapCellSchema = z.object({
  h3: z.string(),
  boundary: z.array(z.tuple([z.number(), z.number()])),
  rows: z.number().int(),
  medianValue: z.number(),
  medianPricePerSqft: z.number(),
});

export const marketMapResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    generatedAt: z.string(),
    source: z.string(),
    market: z.string(),
    label: z.string(),
    zoom: z.number(),
    center: z.tuple([z.number(), z.number()]),
    pricePerSqftDomain: z.tuple([z.number(), z.number()]),
    cells: z.array(marketMapCellSchema),
  }),
  z.object({
    status: z.literal("unavailable"),
    message: z.string(),
  }),
]);

export const marketsResponseSchema = z.object({
  markets: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      region: z.string(),
      status: z.enum(["available", "live-only"]),
      postalPlaceholder: z.string(),
      valuationBasis: z.string(),
      note: z.string().optional(),
    }),
  ),
});

export const modelExperimentsResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    generatedAt: z.string(),
    source: z.string(),
    rows: z.array(
      z.object({
        experiment: z.enum(["local", "pooled", "hybrid"]),
        market: z.string(),
        propertyType: z.string(),
        family: z.string(),
        trainingRows: z.number().int(),
        holdoutRows: z.number().int(),
        holdoutMae: z.number(),
        holdoutMape: z.number(),
        spatialCvMae: z.number().nullable(),
        notes: z.string().optional(),
      }),
    ),
    conclusions: z.array(z.string()),
  }),
  z.object({
    status: z.literal("unavailable"),
    message: z.string(),
  }),
]);

export const marketEvidenceApiResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    scope: z.enum(["fsa-property-type", "fsa", "market-property-type", "market"]),
    generatedAt: z.string(),
    provenance: z.object({
      warehousePath: z.string(),
      builtFrom: z.string(),
      sourceDatasets: z.array(
        z.object({
          id: z.string(),
          market: z.string(),
          name: z.string(),
        }),
      ),
    }),
    markets: z.array(
      z.object({
        marketId: z.string(),
        label: z.string(),
        region: z.string(),
      }),
    ),
    rows: z.array(
      z.object({
        marketId: z.string(),
        cityName: z.string(),
        provinceState: z.string(),
        propertyType: z.string(),
        postalFsa: z.string(),
        trainingRows: z.number().int(),
        modelReadyRows: z.number().int(),
        medianValue: z.number().nullable(),
        avgValue: z.number().nullable(),
        medianPricePerSqft: z.number().nullable(),
        avgLivingAreaSqft: z.number().nullable(),
        avgBedrooms: z.number().nullable(),
        avgBathrooms: z.number().nullable(),
      }),
    ),
  }),
  z.object({
    status: z.literal("unavailable"),
    message: z.string(),
  }),
]);
