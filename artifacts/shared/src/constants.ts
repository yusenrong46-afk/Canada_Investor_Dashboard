export const propertyTypeValues = ["Detached", "Townhouse", "Condo", "Duplex"] as const;

export const improvementFlagValues = [
  "renovatedKitchen",
  "renovatedBathrooms",
  "legalSuiteAdded",
  "energyEfficient",
  "deferredMaintenanceResolved",
  "roofIssueResolved",
] as const;

export const improvementCatalog = {
  renovatedKitchen: {
    label: "Renovated kitchen",
    defaultCost: 65_000,
    months: 2,
    phase: "Interior",
    hint: "Cabinets, counters, appliances, layout polish.",
  },
  renovatedBathrooms: {
    label: "Renovated bathrooms",
    defaultCost: 35_000,
    months: 2,
    phase: "Interior",
    hint: "Fixtures, tile, vanity, plumbing refresh.",
  },
  legalSuiteAdded: {
    label: "Legal suite added",
    defaultCost: 90_000,
    months: 4,
    phase: "Income",
    hint: "Secondary suite or lock-off income space.",
  },
  energyEfficient: {
    label: "Energy upgrades",
    defaultCost: 22_000,
    months: 2,
    phase: "Efficiency",
    hint: "Windows, insulation, HVAC, heat pump.",
  },
  deferredMaintenanceResolved: {
    label: "Deferred maintenance",
    defaultCost: 28_000,
    months: 2,
    phase: "Readiness",
    hint: "Repairs buyers would notice quickly.",
  },
  roofIssueResolved: {
    label: "Roof and systems",
    defaultCost: 24_000,
    months: 1,
    phase: "Readiness",
    hint: "Roofing, furnace, boiler, electrical.",
  },
} as const;
