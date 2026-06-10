import { afterEach, describe, expect, it, vi } from "vitest";

import type { MarketsResponse } from "@vvl/shared";

// Mode flags are read from process.env at module load, so each combo re-imports a fresh module graph.
async function marketsWithEnv(env: Record<string, string>): Promise<MarketsResponse> {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  const { buildMarketsResponse } = await import("./marketsRoute");
  return buildMarketsResponse();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("/api/markets payload by mode", () => {
  it("marks both markets available in live mode", async () => {
    const response = await marketsWithEnv({ DEMO_MODE: "", PUBLIC_MODE: "" });

    expect(response.markets).toEqual([
      {
        id: "vancouver",
        label: "Vancouver",
        region: "BC",
        status: "available",
        postalPlaceholder: "V6B 1X9",
        valuationBasis: "listing-price",
      },
      {
        id: "halifax_maritimes",
        label: "Halifax / Maritimes",
        region: "NS",
        status: "available",
        postalPlaceholder: "B3H 1A1",
        valuationBasis: "sale-price",
      },
    ]);
  });

  it("marks both markets available in public mode because the committed evidence file has Halifax rows", async () => {
    const response = await marketsWithEnv({ PUBLIC_MODE: "true", DEMO_MODE: "" });

    expect(response.markets.map((market) => [market.id, market.status])).toEqual([
      ["vancouver", "available"],
      ["halifax_maritimes", "available"],
    ]);
  });

  it("marks Halifax / Maritimes live-only in demo mode with the explanatory note", async () => {
    const response = await marketsWithEnv({ DEMO_MODE: "true", PUBLIC_MODE: "" });
    const halifax = response.markets.find((market) => market.id === "halifax_maritimes");
    const vancouver = response.markets.find((market) => market.id === "vancouver");

    expect(vancouver?.status).toBe("available");
    expect(vancouver?.note).toBeUndefined();
    expect(halifax?.status).toBe("live-only");
    expect(halifax?.note).toBe("Demo mode has precomputed Vancouver samples only.");
  });

  it("lets demo mode win when both mode flags are set, matching app.ts routing", async () => {
    const response = await marketsWithEnv({ DEMO_MODE: "true", PUBLIC_MODE: "true" });
    const halifax = response.markets.find((market) => market.id === "halifax_maritimes");

    expect(halifax?.status).toBe("live-only");
    expect(halifax?.note).toBe("Demo mode has precomputed Vancouver samples only.");
  });
});
