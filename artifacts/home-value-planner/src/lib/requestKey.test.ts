import { describe, expect, it } from "vitest";

import { buildRequestKey, isFreshResult } from "./requestKey";

describe("requestKey freshness", () => {
  it("treats mismatched keys as stale", () => {
    expect(isFreshResult({ requestKey: "a", value: 1 }, "b")).toBe(false);
    expect(isFreshResult({ requestKey: "a", value: 1 }, "a")).toBe(true);
  });

  it("builds stable keys for equivalent objects", () => {
    const left = buildRequestKey({ property: { postalCode: "V6B 1X9" }, plannedFlags: ["renovatedKitchen"] });
    const right = buildRequestKey({ property: { postalCode: "V6B 1X9" }, plannedFlags: ["renovatedKitchen"] });
    expect(left).toBe(right);
  });
});
