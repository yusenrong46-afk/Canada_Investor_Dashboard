import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let server: Server;
let baseUrl: string;

const vancouverCondo = {
  postalCode: "V6B 1X9",
  propertyType: "Condo" as const,
  livingAreaSqft: 708,
  bedrooms: 1,
  bathrooms: 1,
  yearBuilt: 2012,
};

beforeAll(async () => {
  vi.stubEnv("PUBLIC_MODE", "true");
  vi.stubEnv("DEMO_MODE", "");
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

describe("public mode POST routes", () => {
  it("POST /api/estimate returns 200 with provenance for a supported Vancouver FSA", async () => {
    const response = await fetch(`${baseUrl}/api/estimate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(vancouverCondo),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.provenance.contractVersion).toBeTruthy();
    expect(body.provenance.engineType).toBe("rules");
    expect(body.baseValue).toBeGreaterThan(0);
    expect(body.confidenceLow).toBeLessThanOrEqual(body.baseValue);
    expect(body.confidenceHigh).toBeGreaterThanOrEqual(body.baseValue);
  });

  it("POST /api/estimate returns 400 validation envelope for an invalid body", async () => {
    const response = await fetch(`${baseUrl}/api/estimate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postalCode: "V6B 1X9" }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error?.code ?? body.message).toBeTruthy();
    expect(body.message).toBe("Request validation failed");
  });

  it("POST /api/estimate rejects V6A with VALIDATION (no public FSA profile)", async () => {
    const response = await fetch(`${baseUrl}/api/estimate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postalCode: "V6A 1A1",
        propertyType: "Condo",
        livingAreaSqft: 700,
        bedrooms: 1,
        bathrooms: 1,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION");
    expect(body.message).toBe("Request validation failed");
  });

  it("POST /api/simulate returns ready status with uplift drivers", async () => {
    const response = await fetch(`${baseUrl}/api/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...vancouverCondo, plannedFlags: ["renovatedKitchen"] }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ready");
    expect(body.provenance.engineType).toBe("rules");
    expect(body.upliftValue).toBeGreaterThan(0);
  });

  it("POST /api/plan returns a ready plan inside budget", async () => {
    const response = await fetch(`${baseUrl}/api/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...vancouverCondo,
        plannedFlags: ["renovatedKitchen"],
        targetPrice: 900_000,
        budget: 85_000,
        timelineMonths: 9,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ready");
    expect(body.provenance).toBeDefined();
    expect(body.plannedSpend).toBeLessThanOrEqual(85_000);
  });

  it("POST /api/deal/analyze returns a deal label and nested estimate/plan", async () => {
    const response = await fetch(`${baseUrl}/api/deal/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...vancouverCondo,
        askingPrice: 735_000,
        budget: 85_000,
        timelineMonths: 9,
        plannedFlags: ["renovatedKitchen"],
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.dealLabel).toBeTruthy();
    expect(body.estimate.trainingMode).toBe("public-interactive-estimator");
    expect(body.plan.status).toBe("ready");
    expect(body.robustness?.draws).toBe(5000);
  });

  it("POST /api/deal/analyze returns 400 for missing askingPrice", async () => {
    const response = await fetch(`${baseUrl}/api/deal/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...vancouverCondo, budget: 85_000, timelineMonths: 9 }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toBe("Request validation failed");
  });
});

describe("public mode health", () => {
  it("reports public-interactive runtime mode", async () => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mode).toBe("public-interactive");
  });
});
