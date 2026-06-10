import type { MarketId, PropertyInput } from "@vvl/shared";

export const defaultProperty: PropertyInput = {
  postalCode: "V6B 1X9",
  propertyType: "Condo",
  livingAreaSqft: 708,
  bedrooms: 1,
  bathrooms: 1,
  yearBuilt: 2006,
  knownCurrentValue: undefined,
};

export const defaultPropertyByMarket: Record<MarketId, PropertyInput> = {
  vancouver: defaultProperty,
  halifax_maritimes: {
    postalCode: "B3H 1A1",
    propertyType: "Detached",
    livingAreaSqft: 1800,
    bedrooms: 3,
    bathrooms: 2,
    yearBuilt: 1990,
    knownCurrentValue: undefined,
  },
};
