import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./handlers", () => ({
  resolveHandlers: vi.fn(() => ({
    estimate: async () => ({ notAValidEstimate: true }),
    simulate: async () => ({ notAValidSimulate: true }),
    plan: async () => ({ notAValidPlan: true }),
    deal: async () => ({ notAValidDeal: true }),
    insights: () => {
      throw Object.assign(new Error("Public mode has no server-side portfolio."), { statusCode: 409 });
    },
  })),
}));

describe("API contract acceptance (public mode)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    vi.stubEnv("PUBLIC_MODE", "true");
    vi.stubEnv("DEMO_MODE", "");
    vi.stubEnv("MODEL_REQUESTS_PER_MINUTE", "10");
    vi.resetModules();
    const { resetConfigForTests } = await import("./config");
    resetConfigForTests();
    const { default: app } = await import("./app");

    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    const { resetConfigForTests } = await import("./config");
    resetConfigForTests();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it("returns RESPONSE_CONTRACT 500 when an outgoing estimate fails response Zod", async () => {
    const response = await fetch(`${baseUrl}/api/estimate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postalCode: "V6B 1X9",
        propertyType: "Condo",
        livingAreaSqft: 700,
        bedrooms: 1,
        bathrooms: 1,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("RESPONSE_CONTRACT");
    expect(body.message).toBe("Response failed contract validation");
    expect(body.error.message).toBe("Response failed contract validation");
  });

  it("echoes x-request-id when provided and always sets the header", async () => {
    const echoed = await fetch(`${baseUrl}/api/health`, {
      headers: { "x-request-id": "test-id-123" },
    });
    expect(echoed.status).toBe(200);
    expect(echoed.headers.get("x-request-id")).toBe("test-id-123");

    const generated = await fetch(`${baseUrl}/api/health`);
    expect(generated.status).toBe(200);
    expect(generated.headers.get("x-request-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("returns VALIDATION envelope on bad estimate body", async () => {
    const response = await fetch(`${baseUrl}/api/estimate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postalCode: "V6B 1X9" }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION");
    expect(body.message).toBe("Request validation failed");
    expect(Array.isArray(body.error.issues)).toBe(true);
  });

  it("returns NOT_FOUND envelope for unknown routes", async () => {
    const response = await fetch(`${baseUrl}/api/does-not-exist`);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.message).toBe("Route not found.");
  });

  it("returns NO_PORTFOLIO envelope for public insights", async () => {
    const response = await fetch(`${baseUrl}/api/insights`);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("NO_PORTFOLIO");
    expect(body.message).toContain("no server-side portfolio");
  });
});
