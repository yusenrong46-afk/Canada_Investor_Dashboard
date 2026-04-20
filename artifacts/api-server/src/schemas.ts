import { z } from "zod/v4";

import { improvementFlagValues, propertyTypeValues } from "./data";

const postalCodePattern = /^V[56][A-Z]\s?\d[A-Z]\d$/i;

export const propertyInputSchema = z.object({
  postalCode: z
    .string()
    .trim()
    .regex(postalCodePattern, "Use a Vancouver postal code like V6B 1X9"),
  propertyType: z.enum(propertyTypeValues),
  livingAreaSqft: z.number().min(250).max(10_000),
  bedrooms: z.number().min(0).max(10),
  bathrooms: z.number().min(0).max(10),
  propertyTax: z.number().positive().optional(),
  knownCurrentValue: z.number().positive().optional(),
});

export const estimateRequestSchema = propertyInputSchema;

export const simulateRequestSchema = propertyInputSchema.extend({
  plannedFlags: z.array(z.enum(improvementFlagValues)).default([]),
  horizonMonths: z.number().min(3).max(18).optional(),
});

export const planRequestSchema = simulateRequestSchema.extend({
  targetPrice: z.number().positive(),
  budget: z.number().positive(),
  timelineMonths: z.number().min(3).max(18),
});

export type PropertyInput = z.infer<typeof propertyInputSchema>;
export type EstimateRequest = z.infer<typeof estimateRequestSchema>;
export type SimulateRequest = z.infer<typeof simulateRequestSchema>;
export type PlanRequest = z.infer<typeof planRequestSchema>;
