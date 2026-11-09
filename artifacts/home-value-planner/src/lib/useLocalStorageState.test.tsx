/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultProperty } from "./defaults";
import { cleanPlannedFlags, cleanProperty, parseDealInputs, parsePlanInputs } from "./storedSession";
import { readStoredValue, storageBackupKey, useLocalStorageState } from "./useLocalStorageState";

const defaultPlan = { targetPrice: 1_400_000, budget: 120_000, timelineMonths: 9 };
const acceptAnything = (raw: unknown) => raw as string;

describe("useLocalStorageState with blocked storage", () => {
  const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    Object.defineProperty(window, "localStorage", original);
    vi.restoreAllMocks();
  });

  it("falls back to the initial value and keeps working when reading localStorage throws", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });

    const { result } = renderHook(() => useLocalStorageState("blocked-key", "initial", acceptAnything));
    expect(result.current[0]).toBe("initial");

    act(() => result.current[1]("next"));
    expect(result.current[0]).toBe("next");
  });

  it("survives getItem and setItem throwing (e.g. quota exceeded)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    const { result } = renderHook(() => useLocalStorageState("quota-key", 1, (raw) => (typeof raw === "number" ? raw : null)));
    expect(result.current[0]).toBe(1);
    act(() => result.current[1](2));
    expect(result.current[0]).toBe(2);
  });
});

describe("readStoredValue with corrupt values", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the initial value for unparseable JSON and backs up the raw text", () => {
    window.localStorage.setItem("plan", "{not json");

    expect(readStoredValue("plan", defaultPlan, parsePlanInputs)).toEqual(defaultPlan);
    expect(window.localStorage.getItem(storageBackupKey("plan"))).toBe("{not json");
  });

  it("rejects empty plan inputs instead of producing NaN", () => {
    window.localStorage.setItem("plan", "{}");

    expect(readStoredValue("plan", defaultPlan, parsePlanInputs)).toEqual(defaultPlan);
    expect(window.localStorage.getItem(storageBackupKey("plan"))).toBe("{}");
  });

  it("falls back to the default property when the stored property is null", () => {
    window.localStorage.setItem("property", "null");

    expect(readStoredValue("property", defaultProperty, cleanProperty)).toEqual(defaultProperty);
    expect(window.localStorage.getItem(storageBackupKey("property"))).toBe("null");
  });

  it("falls back to no flags when the stored flags are not an array", () => {
    window.localStorage.setItem("flags", '{"renovatedKitchen":true}');

    expect(readStoredValue("flags", [], cleanPlannedFlags)).toEqual([]);
  });

  it("returns a valid stored value unchanged and writes no backup", () => {
    const stored = { targetPrice: 900_000, budget: 50_000, timelineMonths: 6 };
    window.localStorage.setItem("plan", JSON.stringify(stored));

    expect(readStoredValue("plan", defaultPlan, parsePlanInputs)).toEqual(stored);
    expect(window.localStorage.getItem(storageBackupKey("plan"))).toBeNull();
  });
});

describe("stored session parsers", () => {
  it("keeps valid property fields and replaces only malformed ones", () => {
    const cleaned = cleanProperty({ ...defaultProperty, postalCode: "V6", bedrooms: "three", livingAreaSqft: 1200, yearBuilt: "old" });

    expect(cleaned).toEqual({ ...defaultProperty, postalCode: "V6", livingAreaSqft: 1200, yearBuilt: undefined });
  });

  it("drops unknown improvement flags", () => {
    expect(cleanPlannedFlags(["renovatedKitchen", "hotTub", 7])).toEqual(["renovatedKitchen"]);
  });

  it("rejects deal inputs with any missing or out-of-range field", () => {
    expect(parseDealInputs({ askingPrice: 700_000, budget: 50_000, timelineMonths: 9 })).toEqual({
      askingPrice: 700_000,
      budget: 50_000,
      timelineMonths: 9,
    });
    expect(parseDealInputs({ askingPrice: 700_000, budget: 50_000 })).toBeNull();
    expect(parseDealInputs({ askingPrice: 700_000, budget: 50_000, timelineMonths: 40 })).toBeNull();
    expect(parseDealInputs([1, 2, 3])).toBeNull();
  });
});
