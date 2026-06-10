export const marketValues = ["vancouver", "halifax_maritimes"] as const;

export type MarketId = (typeof marketValues)[number];

export interface MarketDefinition {
  id: MarketId;
  label: string;
  region: string;
  postalPrefixPattern: RegExp;
  postalPlaceholder: string;
  postalHint: string;
  valuationBasis: "listing-price" | "sale-price";
}

export const marketCatalog: Record<MarketId, MarketDefinition> = {
  vancouver: {
    id: "vancouver",
    label: "Vancouver",
    region: "BC",
    postalPrefixPattern: /^V[56]/i,
    postalPlaceholder: "V6B 1X9",
    postalHint: "Use a Vancouver postal code in the V5 or V6 area.",
    valuationBasis: "listing-price",
  },
  halifax_maritimes: {
    id: "halifax_maritimes",
    label: "Halifax / Maritimes",
    region: "NS",
    postalPrefixPattern: /^B\d/i,
    postalPlaceholder: "B3H 1A1",
    postalHint: "Use a Halifax / Maritimes postal code in the B area, like B3H 1A1.",
    // Halifax trains on real PVSC parcel sale prices, not listing prices.
    valuationBasis: "sale-price",
  },
};

export function detectMarket(postalCode: string): MarketId | null {
  const normalized = postalCode.trim().toUpperCase();

  for (const marketId of marketValues) {
    if (marketCatalog[marketId].postalPrefixPattern.test(normalized)) {
      return marketId;
    }
  }

  return null;
}
