export const marketValues = ["vancouver", "halifax_maritimes"] as const;

export type MarketId = (typeof marketValues)[number];

export const supportedPostalFsasByMarket: Record<MarketId, readonly string[]> = {
  vancouver: [
    "V5C", "V5K", "V5L", "V5M", "V5N", "V5P", "V5R", "V5S", "V5T", "V5V", "V5W", "V5X", "V5Y", "V5Z",
    // V6A omitted: public rules have no committed FSA profile (no invented east/west fallback).
    "V6B", "V6C", "V6E", "V6G", "V6H", "V6J", "V6K", "V6L", "V6M", "V6N", "V6P", "V6R", "V6S", "V6T", "V6X", "V6Z",
  ],
  halifax_maritimes: [
    // B3B omitted: committed market_evidence export has no rows for that FSA.
    "B0J", "B0N", "B2R", "B2S", "B2T", "B2V", "B2W", "B2X", "B2Y", "B2Z", "B3A", "B3E", "B3G", "B3H", "B3J",
    "B3K", "B3L", "B3M", "B3N", "B3P", "B3R", "B3S", "B3T", "B3V", "B3Z", "B4A", "B4B", "B4C", "B4E", "B4G",
  ],
};

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
    postalHint: "Use a postal area observed in the Vancouver training data, like V6B 1X9.",
    valuationBasis: "listing-price",
  },
  halifax_maritimes: {
    id: "halifax_maritimes",
    label: "Halifax / Maritimes",
    region: "NS",
    postalPrefixPattern: /^B\d/i,
    postalPlaceholder: "B3H 1A1",
    postalHint: "Use a postal area observed in the Halifax training data, like B3H 1A1.",
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
