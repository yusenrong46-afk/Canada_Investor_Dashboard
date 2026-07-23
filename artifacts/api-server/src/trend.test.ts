import { marketTrendResponseSchema } from "@vvl/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { trendFromExportFile, trendFromModelService } from "./trend";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("trendFromExportFile (demo/public path)", () => {
  it("serves the committed Vancouver trend and satisfies the shared contract", () => {
    const response = trendFromExportFile("vancouver");

    expect(marketTrendResponseSchema.safeParse(response).success).toBe(true);
    expect(response.status).toBe("ready");
    if (response.status === "ready") {
      expect(response.market).toBe("vancouver");
      expect(response.marketLabel).toBe("Vancouver");
      expect(response.license.length).toBeGreaterThan(0);
      expect(response.generatedAt.length).toBeGreaterThan(0);
      expect(response.points.length).toBeGreaterThan(0);
    }
  });

  it("serves the committed Halifax / Maritimes trend", () => {
    const response = trendFromExportFile("halifax_maritimes");

    expect(marketTrendResponseSchema.safeParse(response).success).toBe(true);
    expect(response.status).toBe("ready");
    if (response.status === "ready") {
      expect(response.market).toBe("halifax_maritimes");
    }
  });

  it("returns unavailable for an unknown market and names the available ones", () => {
    const response = trendFromExportFile("toronto");

    expect(response.status).toBe("unavailable");
    if (response.status === "unavailable") {
      expect(response.message).toContain("toronto");
      expect(response.message).toContain("halifax_maritimes");
      expect(response.message).toContain("vancouver");
    }
  });
});

describe("trendFromModelService (live path)", () => {
  const readyPayload = {
    status: "ready",
    market: "vancouver",
    marketLabel: "Vancouver",
    method: "ETS(A,Ad,N) exponential smoothing, 80% prediction interval",
    dataSource: "Statistics Canada New Housing Price Index (table 18-10-0205-01)",
    license: "Open Government Licence - Canada",
    baselinePeriod: "2026-04",
    generatedAt: "2026-06-09T23:51:49+00:00",
    backtestMape: 1.218,
    points: [{ period: "2026-05", indexValue: null, forecastValue: 132.1, forecastLow: 131.0, forecastHigh: 133.2 }],
  };

  it("passes a contract-valid Flask payload through unchanged", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(readyPayload), { status: 200, headers: { "Content-Type": "application/json" } }));
    globalThis.fetch = fetchMock as typeof fetch;

    const response = await trendFromModelService("vancouver");

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/trend?market=vancouver"), expect.objectContaining({ method: "GET" }));
    expect(response).toEqual(readyPayload);
  });

  it("passes a Flask unavailable payload through", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ status: "unavailable", message: "Market trend export not found." }), { status: 200, headers: { "Content-Type": "application/json" } }),
    ) as typeof fetch;

    const response = await trendFromModelService("vancouver");

    expect(response).toEqual({ status: "unavailable", message: "Market trend export not found." });
  });

  it("returns unavailable when the Flask payload breaks the shared contract", async () => {
    const { license: _license, ...payloadMissingLicense } = readyPayload;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(payloadMissingLicense), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;

    const response = await trendFromModelService("vancouver");

    expect(response.status).toBe("unavailable");
    if (response.status === "unavailable") {
      expect(response.message).toContain("market trend contract");
    }
  });

  it("returns unavailable when the model service is unreachable", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("fetch failed");
    }) as typeof fetch;

    const response = await trendFromModelService("vancouver");

    expect(response).toEqual({ status: "unavailable", message: "Model service GET /trend request failed: fetch failed" });
  });
});

describe("getMarketTrend mode routing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function importTrendWithEnv(env: Record<string, string>) {
    vi.resetModules();
    for (const [key, value] of Object.entries(env)) {
      vi.stubEnv(key, value);
    }
    return import("./trend");
  }

  it("reads the committed export directly in public mode without touching fetch", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof fetch;
    const { getMarketTrend } = await importTrendWithEnv({ PUBLIC_MODE: "true", DEMO_MODE: "" });

    const response = await getMarketTrend("vancouver");

    expect(response.status).toBe("ready");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reads the committed export directly in demo mode without touching fetch", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof fetch;
    const { getMarketTrend } = await importTrendWithEnv({ DEMO_MODE: "true", PUBLIC_MODE: "" });

    const response = await getMarketTrend("halifax_maritimes");

    expect(response.status).toBe("ready");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("proxies the Flask service in live mode", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "unavailable", message: "no export" }), { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;
    const { getMarketTrend } = await importTrendWithEnv({ DEMO_MODE: "", PUBLIC_MODE: "" });

    const response = await getMarketTrend("vancouver");

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/trend?market=vancouver"), expect.anything());
    expect(response).toEqual({ status: "unavailable", message: "no export" });
  });
});
