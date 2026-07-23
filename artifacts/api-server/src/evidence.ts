import path from "node:path";

import { marketEvidenceFileSchema, marketValues, propertyTypeValues, type MarketEvidenceFile, type MarketEvidenceRow, type MarketId } from "@vvl/shared";
import { z } from "zod/v4";

import { readRepoJson } from "./repoFiles";

export const evidenceRelativePath = path.join("data", "exports", "market_evidence.json");

export const evidenceQuerySchema = z.object({
  market: z.enum(marketValues),
  fsa: z.string().trim().min(1).optional(),
  propertyType: z.enum(propertyTypeValues).optional(),
});

export type EvidenceScope = "fsa-property-type" | "fsa" | "market-property-type" | "market";

export interface EvidenceSelection {
  scope: EvidenceScope;
  rows: MarketEvidenceRow[];
}

export type EvidenceResponse =
  | {
      status: "ready";
      scope: EvidenceScope;
      generatedAt: string;
      provenance: MarketEvidenceFile["provenance"];
      rows: MarketEvidenceRow[];
    }
  | {
      status: "unavailable";
      message: string;
    };

// The committed export is validated once and cached; null means the file is missing or fails the shared contract.
let cachedEvidence: MarketEvidenceFile | null | undefined;

export function loadMarketEvidence(): MarketEvidenceFile | null {
  if (cachedEvidence === undefined) {
    try {
      cachedEvidence = marketEvidenceFileSchema.parse(readRepoJson(evidenceRelativePath));
    } catch (error) {
      console.warn(`[api] failed to load ${evidenceRelativePath}`, error);
      cachedEvidence = null;
    }
  }
  return cachedEvidence;
}

export function hasEvidenceRows(market: MarketId): boolean {
  return (loadMarketEvidence()?.rows ?? []).some((row) => row.marketId === market);
}

// Scope fallback keeps the endpoint useful for sparse FSAs: exact match, then the FSA, then the market-wide slice.
export function selectEvidenceRows(market: MarketId, fsa?: string, propertyType?: string): EvidenceSelection | null {
  const file = loadMarketEvidence();
  if (!file) {
    return null;
  }

  const marketRows = file.rows.filter((row) => row.marketId === market);
  if (!marketRows.length) {
    return null;
  }

  const normalizedFsa = fsa?.trim().toUpperCase();
  if (normalizedFsa) {
    const fsaRows = marketRows.filter((row) => row.postalFsa.toUpperCase() === normalizedFsa);
    if (propertyType) {
      const exactRows = fsaRows.filter((row) => row.propertyType === propertyType);
      if (exactRows.length) {
        return { scope: "fsa-property-type", rows: exactRows };
      }
    }
    if (fsaRows.length) {
      return { scope: "fsa", rows: fsaRows };
    }
  }

  if (propertyType) {
    const typeRows = marketRows.filter((row) => row.propertyType === propertyType);
    if (typeRows.length) {
      return { scope: "market-property-type", rows: typeRows };
    }
  }

  return { scope: "market", rows: marketRows };
}

export function buildEvidenceResponse(market: MarketId, fsa?: string, propertyType?: string): EvidenceResponse {
  const file = loadMarketEvidence();
  if (!file) {
    return {
      status: "unavailable",
      message: `Market evidence export is missing or invalid at ${evidenceRelativePath}. Run scripts/build_property_warehouse.py to regenerate it.`,
    };
  }

  const selection = selectEvidenceRows(market, fsa, propertyType);
  if (!selection) {
    return {
      status: "unavailable",
      message: `No evidence rows exist for market '${market}' in ${evidenceRelativePath}.`,
    };
  }

  return {
    status: "ready",
    scope: selection.scope,
    generatedAt: file.generatedAt,
    provenance: file.provenance,
    rows: selection.rows,
  };
}
