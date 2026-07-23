import type { PropertyType } from "@vvl/shared";

// dataAsOf: committed public screening tables as of 2026-07-18 release contract.

export interface AreaProfile {
  label: string;
  multiplier: number;
  comparableCount: number;
}

export interface TypeProfile {
  basePricePerSqft: number;
  medianSqft: number;
  cityMedianValue: number;
  cityMedianPricePerSqft: number;
  baseConfidenceRatio: number;
}

export const typeProfiles: Record<PropertyType, TypeProfile> = {
  Condo: {
    basePricePerSqft: 990,
    medianSqft: 760,
    cityMedianValue: 930_000,
    cityMedianPricePerSqft: 1_045,
    baseConfidenceRatio: 0.11,
  },
  Townhouse: {
    basePricePerSqft: 920,
    medianSqft: 1_300,
    cityMedianValue: 1_215_000,
    cityMedianPricePerSqft: 940,
    baseConfidenceRatio: 0.14,
  },
  Detached: {
    basePricePerSqft: 890,
    medianSqft: 2_150,
    cityMedianValue: 1_900_000,
    cityMedianPricePerSqft: 885,
    baseConfidenceRatio: 0.18,
  },
  Duplex: {
    basePricePerSqft: 930,
    medianSqft: 1_520,
    cityMedianValue: 1_390_000,
    cityMedianPricePerSqft: 915,
    baseConfidenceRatio: 0.13,
  },
};

export const fsaProfiles: Record<string, AreaProfile> = {
  V6B: { label: "Yaletown / Downtown", multiplier: 1.08, comparableCount: 44 },
  V6C: { label: "Downtown core", multiplier: 1.09, comparableCount: 30 },
  V6E: { label: "West End / Coal Harbour", multiplier: 1.1, comparableCount: 38 },
  V6G: { label: "West End / Stanley Park", multiplier: 1.07, comparableCount: 28 },
  V6H: { label: "Fairview / South Granville", multiplier: 1.12, comparableCount: 34 },
  V6J: { label: "Kitsilano / Fairview west", multiplier: 1.16, comparableCount: 32 },
  V6K: { label: "Kitsilano", multiplier: 1.18, comparableCount: 31 },
  V6L: { label: "Arbutus Ridge / Kerrisdale", multiplier: 1.14, comparableCount: 24 },
  V6M: { label: "Shaughnessy / Kerrisdale", multiplier: 1.2, comparableCount: 20 },
  V6N: { label: "Dunbar / West Side", multiplier: 1.17, comparableCount: 24 },
  V6P: { label: "Marpole / Oakridge", multiplier: 1.03, comparableCount: 27 },
  V6R: { label: "Point Grey / Kits west", multiplier: 1.19, comparableCount: 22 },
  V6S: { label: "UBC / West Point Grey", multiplier: 1.15, comparableCount: 18 },
  V6T: { label: "University Endowment Lands", multiplier: 1.11, comparableCount: 15 },
  V6X: { label: "Sunset / Victoria-Fraserview east", multiplier: 0.96, comparableCount: 22 },
  V6Z: { label: "Downtown south", multiplier: 1.08, comparableCount: 36 },
  V5C: { label: "North Vancouver / Lower Lonsdale", multiplier: 1.04, comparableCount: 22 },
  V5K: { label: "Hastings-Sunrise", multiplier: 0.93, comparableCount: 26 },
  V5L: { label: "Grandview-Woodland", multiplier: 0.97, comparableCount: 30 },
  V5M: { label: "Renfrew-Collingwood north", multiplier: 0.95, comparableCount: 28 },
  V5N: { label: "East Vancouver / Commercial", multiplier: 0.99, comparableCount: 34 },
  V5P: { label: "Killarney / Victoria-Fraserview", multiplier: 0.91, comparableCount: 29 },
  V5R: { label: "Renfrew-Collingwood", multiplier: 0.92, comparableCount: 30 },
  V5S: { label: "Champlain Heights", multiplier: 0.9, comparableCount: 20 },
  V5T: { label: "Mount Pleasant", multiplier: 1.05, comparableCount: 32 },
  V5V: { label: "Riley Park / Kensington", multiplier: 1.03, comparableCount: 33 },
  V5W: { label: "South Vancouver", multiplier: 0.94, comparableCount: 26 },
  V5X: { label: "Oakridge / Sunset", multiplier: 0.98, comparableCount: 24 },
  V5Y: { label: "Olympic Village / Mount Pleasant", multiplier: 1.06, comparableCount: 35 },
  V5Z: { label: "Fairview / Cambie", multiplier: 1.08, comparableCount: 30 },
};

export function getAreaProfile(postalCode: string): AreaProfile | undefined {
  const fsa = postalCode.toUpperCase().replace(/\s+/g, "").slice(0, 3);
  return fsaProfiles[fsa];
}
