import {
  dealAnalyzeRequestSchema,
  improvementFlagValues,
  planRequestSchema,
  propertyInputSchema,
  type PlannedFlag,
  type PropertyInput,
} from "@vvl/shared";

import { defaultProperty } from "./defaults";
import type { DealInputState, PlanInputState } from "./scenarios";

// Parsers for the session values kept in localStorage. Stored data can be stale, hand-edited, or
// written by an older build, so each parser checks it against the shared request schemas.

type FieldSchema<T> = { safeParse: (value: unknown) => { success: true; data: T } | { success: false } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function validOr<T>(schema: FieldSchema<T>, value: unknown, fallback: T): T {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

const propertyFields = propertyInputSchema.shape;
const validPlannedFlagSet = new Set<unknown>(improvementFlagValues);

/** Keeps each valid property field and falls back to the default for any missing or malformed one. */
export function cleanProperty(raw: unknown): PropertyInput | null {
  if (!isRecord(raw)) {
    return null;
  }

  return {
    // The postal code is saved while the user types, so any string is kept; the form flags incomplete codes.
    postalCode: typeof raw.postalCode === "string" ? raw.postalCode : defaultProperty.postalCode,
    propertyType: validOr(propertyFields.propertyType, raw.propertyType, defaultProperty.propertyType),
    livingAreaSqft: validOr(propertyFields.livingAreaSqft, raw.livingAreaSqft, defaultProperty.livingAreaSqft),
    bedrooms: validOr(propertyFields.bedrooms, raw.bedrooms, defaultProperty.bedrooms),
    bathrooms: validOr(propertyFields.bathrooms, raw.bathrooms, defaultProperty.bathrooms),
    yearBuilt: validOr(propertyFields.yearBuilt, raw.yearBuilt, undefined),
    knownCurrentValue: validOr(propertyFields.knownCurrentValue, raw.knownCurrentValue, undefined),
  };
}

export function cleanPlannedFlags(raw: unknown): PlannedFlag[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  return raw.filter((flag): flag is PlannedFlag => validPlannedFlagSet.has(flag));
}

const planFields = planRequestSchema.shape;
const dealFields = dealAnalyzeRequestSchema.shape;

/** Plan inputs are all-or-nothing: a partial set would send a request the API rejects. */
export function parsePlanInputs(raw: unknown): PlanInputState | null {
  if (!isRecord(raw)) {
    return null;
  }
  const targetPrice = planFields.targetPrice.safeParse(raw.targetPrice);
  const budget = planFields.budget.safeParse(raw.budget);
  const timelineMonths = planFields.timelineMonths.safeParse(raw.timelineMonths);
  if (!targetPrice.success || !budget.success || !timelineMonths.success) {
    return null;
  }
  return { targetPrice: targetPrice.data, budget: budget.data, timelineMonths: timelineMonths.data };
}

export function parseDealInputs(raw: unknown): DealInputState | null {
  if (!isRecord(raw)) {
    return null;
  }
  const askingPrice = dealFields.askingPrice.safeParse(raw.askingPrice);
  const budget = dealFields.budget.safeParse(raw.budget);
  const timelineMonths = dealFields.timelineMonths.safeParse(raw.timelineMonths);
  if (!askingPrice.success || !budget.success || !timelineMonths.success) {
    return null;
  }
  return { askingPrice: askingPrice.data, budget: budget.data, timelineMonths: timelineMonths.data };
}
