import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  // Point the live-mode trend proxy at a dead port so the unavailable branch is deterministic.
  vi.stubEnv("MODEL_SERVICE_URL", "http://127.0.0.1:1");
  vi.stubEnv("DEMO_MODE", "");
  vi.stubEnv("PUBLIC_MODE", "");
  vi.resetModules();
  const { default: app } = await import("./app");

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("GET /api/evidence", () => {
  it("serves committed evidence rows with scope metadata", async () => {
    const response = await fetch(`${baseUrl}/api/evidence?market=halifax_maritimes&fsa=B3H&propertyType=Detached`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ready");
    expect(body.scope).toBe("fsa-property-type");
    expect(body.rows).toHaveLength(1);
    expect(body.provenance.sourceDatasets.length).toBeGreaterThan(0);
  });

  it("rejects an unknown market with a 400 validation error", async () => {
    const response = await fetch(`${baseUrl}/api/evidence?market=toronto`);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toBe("Request validation failed");
  });

  it("requires the market query param", async () => {
    const response = await fetch(`${baseUrl}/api/evidence`);

    expect(response.status).toBe(400);
  });
});

describe("GET /api/trend", () => {
  it("returns HTTP 200 with an unavailable payload when the live model service is unreachable", async () => {
    const response = await fetch(`${baseUrl}/api/trend?market=vancouver`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("unavailable");
    expect(typeof body.message).toBe("string");
  });
});

describe("GET /api/markets", () => {
  it("lists both markets as available in live mode", async () => {
    const response = await fetch(`${baseUrl}/api/markets`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.markets.map((market: { id: string; status: string }) => [market.id, market.status])).toEqual([
      ["vancouver", "available"],
      ["halifax_maritimes", "available"],
    ]);
  });
});

describe("runtime provenance and live insights", () => {
  it("reports the configured runtime mode without stale market-specific wording", async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mode).toBe("live-model");
    expect(body.modelServiceReady).toBe(false);
    expect(response.headers.get("x-powered-by")).toBeNull();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self'");
  });

  it("does not insert demo portfolio rows into live insights", async () => {
    const response = await fetch(`${baseUrl}/api/insights`);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.message).toContain("no server-side sample portfolio");
  });
});

describe("demo mode app", () => {
  let demoServer: Server;
  let demoBaseUrl: string;

  beforeAll(async () => {
    vi.stubEnv("DEMO_MODE", "true");
    vi.resetModules();
    const { default: demoApp } = await import("./app");

    await new Promise<void>((resolve) => {
      demoServer = demoApp.listen(0, "127.0.0.1", () => resolve());
    });
    demoBaseUrl = `http://127.0.0.1:${(demoServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => demoServer.close((error) => (error ? reject(error) : resolve())));
  });

  it("returns a 400 for B-prefix postal codes that points at live or public mode", async () => {
    const response = await fetch(`${demoBaseUrl}/api/estimate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postalCode: "B3H 1A1", propertyType: "Detached", livingAreaSqft: 1840, bedrooms: 3, bathrooms: 2 }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toBe("Request validation failed");
    expect(body.issues[0].message).toContain("live or public mode");
  });

  it("keeps the precomputed Vancouver sample estimate stable (canary)", async () => {
    const response = await fetch(`${demoBaseUrl}/api/estimate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postalCode: "V6B 1X9", propertyType: "Condo", livingAreaSqft: 708, bedrooms: 1, bathrooms: 1 }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.baseValue).toBe(748000);
    expect(body.modelVersion).toBe("demo-sample-v1");
    expect(body.confidenceLow).toBeLessThanOrEqual(body.baseValue);
    expect(body.confidenceHigh).toBeGreaterThanOrEqual(body.baseValue);
  });
});
