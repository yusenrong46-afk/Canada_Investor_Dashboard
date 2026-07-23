import { marketCatalog, marketValues, propertyTypeValues, type MarketsResponse } from "@vvl/shared";

import { isDemoModeEnabled, isPublicModeEnabled } from "./config";
import { hasEvidenceRows } from "./evidence";

export type ApiMode = "live" | "demo" | "public";

// Demo wins over public to match the endpoint routing ternaries in app.ts.
export function resolveApiMode(): ApiMode {
  return isDemoModeEnabled() ? "demo" : isPublicModeEnabled() ? "public" : "live";
}

export function buildMarketsResponse(mode: ApiMode = resolveApiMode()): MarketsResponse {
  return {
    markets: marketValues.map((id) => {
      const definition = marketCatalog[id];
      let status: "available" | "live-only" = "available";
      let note: string | undefined;

      if (id === "halifax_maritimes" && mode === "demo") {
        status = "live-only";
        note = "Demo mode has precomputed Vancouver samples only.";
      } else if (id === "halifax_maritimes" && mode === "public" && !hasEvidenceRows("halifax_maritimes")) {
        status = "live-only";
        note = "The Halifax / Maritimes evidence export has no rows, so public mode falls back to live mode for this market.";
      }

      return {
        id,
        label: definition.label,
        region: definition.region,
        status,
        postalPlaceholder: definition.postalPlaceholder,
        valuationBasis: definition.valuationBasis,
        ...(note ? { note } : {}),
      };
    }),
  };
}
