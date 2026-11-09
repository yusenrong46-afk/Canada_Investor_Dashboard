/** @vitest-environment jsdom */
import type { EstimateResponse, PlanResponse } from "@vvl/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultProperty } from "./defaults";
import { createPlanScenario, migrateScenarioStore, type ScenarioRecord } from "./scenarios";
import { readStoredValue, storageBackupKey } from "./useLocalStorageState";

function scenario(overrides: Partial<ScenarioRecord> = {}): ScenarioRecord {
  return {
    id: "deal-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    source: "deal-analyzer",
    title: "V6B 1X9 Condo deal",
    property: defaultProperty,
    plannedFlags: ["renovatedKitchen"],
    estimatedValue: 800_000,
    achievableValue: 860_000,
    pricePerSqft: 1_130,
    askingPrice: 780_000,
    budget: 85_000,
    timelineMonths: 9,
    plannedSpend: 40_000,
    estimatedUpside: 40_000,
    upsidePercent: 0.051,
    verdict: "Worth review",
    riskLevel: "Low",
    tag: "Shortlist",
    note: "Saved for comparison.",
    warnings: [],
    ...overrides,
  };
}

const emptyStore = { version: 1 as const, data: [] };

describe("migrateScenarioStore", () => {
  it("keeps the valid records when one record in a versioned store is invalid", () => {
    const good = scenario();
    const migrated = migrateScenarioStore({ version: 1, data: [good, { id: 42 }, null] });

    expect(migrated?.data).toEqual([good]);
  });

  it("reads the older bare-array format", () => {
    const migrated = migrateScenarioStore([scenario()]);

    expect(migrated?.data).toHaveLength(1);
  });

  it("returns null for values that are not a scenario store", () => {
    expect(migrateScenarioStore({ version: 99, data: [] })).toBeNull();
    expect(migrateScenarioStore("scenarios")).toBeNull();
  });

  it("recomputes old gross plan upside as net of spend", () => {
    const oldPlan = scenario({
      id: "plan-1",
      source: "plan",
      estimatedValue: 1_000_000,
      achievableValue: 1_100_000,
      plannedSpend: 60_000,
      estimatedUpside: 100_000,
      upsidePercent: 0.1,
    });

    const [migrated] = migrateScenarioStore({ version: 1, data: [oldPlan] })!.data;
    expect(migrated.estimatedUpside).toBe(40_000);
    expect(migrated.upsidePercent).toBeCloseTo(0.04);
  });
});

describe("scenario store in localStorage", () => {
  const key = "vvl-scenarios-v1";

  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps good records and backs up the original when one record is bad", () => {
    const raw = JSON.stringify({ version: 1, data: [scenario(), { id: "broken" }] });
    window.localStorage.setItem(key, raw);

    const store = readStoredValue(key, emptyStore, migrateScenarioStore);

    expect(store.data.map((record) => record.id)).toEqual(["deal-1"]);
    expect(window.localStorage.getItem(storageBackupKey(key))).toBe(raw);
    // Reading never deletes the stored value itself.
    expect(window.localStorage.getItem(key)).toBe(raw);
  });

  it("backs up an unrecognised store instead of deleting it", () => {
    window.localStorage.setItem(key, '{"version":2,"data":[]}');

    expect(readStoredValue(key, emptyStore, migrateScenarioStore)).toEqual(emptyStore);
    expect(window.localStorage.getItem(storageBackupKey(key))).toBe('{"version":2,"data":[]}');
  });

  it("writes no backup for a store that is already current", () => {
    window.localStorage.setItem(key, JSON.stringify({ version: 1, data: [scenario()] }));

    readStoredValue(key, emptyStore, migrateScenarioStore);

    expect(window.localStorage.getItem(storageBackupKey(key))).toBeNull();
  });
});

describe("createPlanScenario", () => {
  const plan = {
    status: "ready",
    targetAssessment: "Meets target",
    baseValue: 1_000_000,
    achievableValue: 1_100_000,
    plannedSpend: 60_000,
  } as PlanResponse;
  const input = { property: defaultProperty, plannedFlags: [], plan, targetPrice: 1_050_000, budget: 80_000, timelineMonths: 9 };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores upside net of planned spend", () => {
    const record = createPlanScenario(input);

    expect(record.estimatedUpside).toBe(40_000);
    expect(record.upsidePercent).toBeCloseTo(0.04);
  });

  it("gives the same risk label whether or not the estimate was loaded", () => {
    const wideEstimate = { confidenceRatio: 0.3, pricePerSqft: 1_400, modelVersion: "test" } as EstimateResponse;

    const withoutEstimate = createPlanScenario(input);
    const withEstimate = createPlanScenario({ ...input, estimate: wideEstimate });

    expect(withEstimate.riskLevel).toBe(withoutEstimate.riskLevel);
    expect(withEstimate.warnings).toContain("Wide estimate confidence range");
  });

  it("round-trips through storage without triggering a migration backup", () => {
    window.localStorage.clear();
    window.localStorage.setItem("store", JSON.stringify({ version: 1, data: [createPlanScenario(input)] }));

    readStoredValue("store", emptyStore, migrateScenarioStore);

    expect(window.localStorage.getItem(storageBackupKey("store"))).toBeNull();
  });

  it("creates an id when crypto.randomUUID is unavailable (insecure context)", () => {
    vi.stubGlobal("crypto", {});

    const record = createPlanScenario(input);

    expect(record.id).toEqual(expect.any(String));
    expect(record.id.length).toBeGreaterThan(5);
  });
});
