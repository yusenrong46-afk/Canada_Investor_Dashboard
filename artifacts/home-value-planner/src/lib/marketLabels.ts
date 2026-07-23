import { detectMarket, marketCatalog, type MarketId, type PropertyInput } from "@vvl/shared";

export function resolveMarketId(property: PropertyInput): MarketId {
  return detectMarket(property.postalCode) ?? "vancouver";
}

export function targetPriceLabel(property: PropertyInput): string {
  const market = resolveMarketId(property);
  return marketCatalog[market].valuationBasis === "listing-price" ? "Target listing price" : "Target sale price";
}

export function upliftUnavailableMessage(): string {
  return "Renovation evidence is unavailable for this market or property type.";
}
