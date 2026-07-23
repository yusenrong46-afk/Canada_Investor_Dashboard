import { marketCatalog, type MarketId, type PropertyType } from "@vvl/shared";

import { selectEvidenceRows, type EvidenceScope } from "./evidence";

// Area profiles are derived from the committed evidence export so public-mode numbers stay traceable to real rows.
export interface EvidenceAreaProfile {
  label: string;
  scope: EvidenceScope;
  medianPricePerSqft: number;
  medianValue: number;
  avgLivingAreaSqft: number;
  comparableCount: number;
}

function median(values: number[]): number | null {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const profileCache = new Map<string, EvidenceAreaProfile | null>();

function buildProfile(market: MarketId, fsa: string | undefined, propertyType: PropertyType | undefined): EvidenceAreaProfile | null {
  const selection = selectEvidenceRows(market, fsa, propertyType);
  if (!selection) {
    return null;
  }

  const medianPricePerSqft = median(selection.rows.map((row) => row.medianPricePerSqft).filter((value): value is number => value != null));
  const medianValue = median(selection.rows.map((row) => row.medianValue).filter((value): value is number => value != null));
  const sqftRows = selection.rows.filter((row) => row.avgLivingAreaSqft != null);
  const sqftWeight = sqftRows.reduce((sum, row) => sum + row.trainingRows, 0);
  const avgLivingAreaSqft = sqftWeight > 0 ? sqftRows.reduce((sum, row) => sum + (row.avgLivingAreaSqft ?? 0) * row.trainingRows, 0) / sqftWeight : null;

  if (medianPricePerSqft == null || medianValue == null || avgLivingAreaSqft == null) {
    return null;
  }

  const fsaScoped = selection.scope === "fsa-property-type" || selection.scope === "fsa";
  return {
    label: fsaScoped && fsa ? fsa.trim().toUpperCase() : marketCatalog[market].label,
    scope: selection.scope,
    medianPricePerSqft,
    medianValue,
    avgLivingAreaSqft,
    comparableCount: selection.rows.reduce((sum, row) => sum + row.trainingRows, 0),
  };
}

export function getEvidenceAreaProfile(market: MarketId, fsa: string | undefined, propertyType: PropertyType | undefined): EvidenceAreaProfile | null {
  const cacheKey = `${market}|${fsa?.trim().toUpperCase() ?? ""}|${propertyType ?? ""}`;
  const cached = profileCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const profile = buildProfile(market, fsa, propertyType);
  profileCache.set(cacheKey, profile);
  return profile;
}
