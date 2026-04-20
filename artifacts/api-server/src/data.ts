export const propertyTypeValues = ["Detached", "Townhouse", "Condo", "Duplex"] as const;

export const improvementFlagValues = [
  "renovatedKitchen",
  "renovatedBathrooms",
  "legalSuiteAdded",
  "energyEfficient",
  "curbAppealImproved",
  "permitIssuesResolved",
  "deferredMaintenanceResolved",
  "roofIssueResolved",
] as const;

export const improvementCatalog = {
  renovatedKitchen: {
    label: "Renovated kitchen",
    defaultCost: 65_000,
    months: 2,
    phase: "Interior",
  },
  renovatedBathrooms: {
    label: "Renovated bathrooms",
    defaultCost: 35_000,
    months: 2,
    phase: "Interior",
  },
  legalSuiteAdded: {
    label: "Legal suite added",
    defaultCost: 90_000,
    months: 4,
    phase: "Income",
  },
  energyEfficient: {
    label: "Energy upgrades",
    defaultCost: 22_000,
    months: 2,
    phase: "Efficiency",
  },
  curbAppealImproved: {
    label: "Curb appeal",
    defaultCost: 18_000,
    months: 1,
    phase: "Exterior",
  },
  permitIssuesResolved: {
    label: "Permit issues resolved",
    defaultCost: 12_000,
    months: 1,
    phase: "Compliance",
  },
  deferredMaintenanceResolved: {
    label: "Deferred maintenance resolved",
    defaultCost: 28_000,
    months: 2,
    phase: "Readiness",
  },
  roofIssueResolved: {
    label: "Roof and systems resolved",
    defaultCost: 24_000,
    months: 1,
    phase: "Readiness",
  },
} as const;
