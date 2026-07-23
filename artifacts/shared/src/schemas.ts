import { z } from "zod/v4";

import { improvementFlagValues, propertyTypeValues } from "./constants";
import { marketValues, supportedPostalFsasByMarket } from "./markets";

const postalCodePattern = /^(V[56]|B\d)[A-Z]\s?\d[A-Z]\d$/i;
const currentYear = new Date().getFullYear();

export const propertyInputSchema = z.object({
  postalCode: z
    .string()
    .trim()
    .regex(postalCodePattern, "Use a Vancouver postal code like V6B 1X9 or a Halifax / Maritimes postal code like B3H 1A1"),
  propertyType: z.enum(propertyTypeValues),
  livingAreaSqft: z.number().min(250).max(10_000),
  bedrooms: z.number().min(0).max(10),
  bathrooms: z.number().min(0).max(10),
  yearBuilt: z.number().int().min(1800).max(currentYear).optional(),
  knownCurrentValue: z.number().positive().optional(),
}).superRefine((value, context) => {
  const normalized = value.postalCode.toUpperCase().replace(/\s+/g, "");
  const fsa = normalized.slice(0, 3);
  const market = normalized.startsWith("B") ? "halifax_maritimes" : "vancouver";
  if (!supportedPostalFsasByMarket[market].includes(fsa)) {
    context.addIssue({
      code: "custom",
      path: ["postalCode"],
      message: `Postal area ${fsa} is outside the model's observed training geography.`,
    });
  }
});

export const estimateRequestSchema = propertyInputSchema;

export const simulateRequestSchema = propertyInputSchema.safeExtend({
  plannedFlags: z.array(z.enum(improvementFlagValues)).default([]),
  horizonMonths: z.number().min(3).max(18).optional(),
});

export const planRequestSchema = simulateRequestSchema.safeExtend({
  targetPrice: z.number().positive(),
  budget: z.number().positive(),
  timelineMonths: z.number().min(3).max(18),
});

export const dealAnalyzeRequestSchema = propertyInputSchema.safeExtend({
  plannedFlags: z.array(z.enum(improvementFlagValues)).default([]),
  horizonMonths: z.number().min(3).max(18).optional(),
  askingPrice: z.number().positive(),
  budget: z.number().positive(),
  timelineMonths: z.number().min(3).max(18),
});

export const marketEvidenceRowSchema = z.object({
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
});

export const marketEvidenceFileSchema = z.object({
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
  rows: z.array(marketEvidenceRowSchema),
});

export const marketTrendPointSchema = z.object({
  period: z.string(),
  indexValue: z.number().nullable(),
  forecastValue: z.number().nullable(),
  forecastLow: z.number().nullable(),
  forecastHigh: z.number().nullable(),
});

export const marketTrendResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    market: z.string(),
    marketLabel: z.string(),
    method: z.string(),
    dataSource: z.string(),
    license: z.string(),
    baselinePeriod: z.string(),
    generatedAt: z.string(),
    backtestMape: z.number().nullable(),
    points: z.array(marketTrendPointSchema),
  }),
  z.object({
    status: z.literal("unavailable"),
    message: z.string(),
  }),
]);

export const marketQuerySchema = z.object({
  market: z.enum(marketValues),
});

export type PropertyInputSchema = z.infer<typeof propertyInputSchema>;
export type EstimateRequestSchema = z.infer<typeof estimateRequestSchema>;
export type SimulateRequestSchema = z.infer<typeof simulateRequestSchema>;
export type PlanRequestSchema = z.infer<typeof planRequestSchema>;
export type DealAnalyzeRequest = z.infer<typeof dealAnalyzeRequestSchema>;
