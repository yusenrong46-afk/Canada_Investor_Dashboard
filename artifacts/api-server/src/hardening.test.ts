import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { marketEvidenceApiResponseSchema } from "@vvl/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Regression tests for request-handling bugs: each case used to return the wrong status or a
// response the frontend's own contract rejected.

const validProperty = {
  postalCode: "V6B 1X9",
  propertyType: "Condo",
  livingAreaSqft: 708,
  bedrooms: 1,
  bathrooms: 1,
};

async function startApp(env: Record<string, string>): Promise<{ server: Server; baseUrl: string }> {
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  vi.resetModules();
  const { resetConfigForTests } = await import("./config");
  resetConfigForTests();
  const { default: app } = await import("./app");
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  return { server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

async function stopApp(server: Server): Promise<void> {
  vi.unstubAllEnvs();
  const { resetConfigForTests } = await import("./config");
  resetConfigForTests();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function postJson(url: string, body: string, headers: Record<string, string> = {}) {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body });
}

describe("live mode with the model service down", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // Port 1 refuses connections, like a stopped model service.
    ({ server, baseUrl } = await startApp({ MODEL_SERVICE_URL: "http://127.0.0.1:1", DEMO_MODE: "", PUBLIC_MODE: "" }));
  });
  afterAll(() => stopApp(server));

  it("returns 502 UPSTREAM_UNAVAILABLE instead of a generic 500", async () => {
    const response = await postJson(`${baseUrl}/api/estimate`, JSON.stringify(validProperty));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error.code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("returns 400 for malformed JSON instead of 500", async () => {
    const response = await postJson(`${baseUrl}/api/estimate`, "{bad json");
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION");
    expect(body.message).toBe("Request body is not valid JSON.");
  });

  it("returns 413 for a body over the 32kb limit", async () => {
    const response = await postJson(`${baseUrl}/api/estimate`, JSON.stringify({ ...validProperty, padding: "x".repeat(40_000) }));

    expect(response.status).toBe(413);
  });

  it("rejects absurd money inputs with 400 before they overflow to Infinity", async () => {
    const response = await postJson(
      `${baseUrl}/api/deal/analyze`,
      JSON.stringify({ ...validProperty, askingPrice: 1.7e308, budget: 50_000, timelineMonths: 6 }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.issues.map((issue: { path: string }) => issue.path)).toContain("askingPrice");
  });

  it("serves evidence that satisfies the shared contract the frontend validates against", async () => {
    const response = await fetch(`${baseUrl}/api/evidence?market=vancouver&fsa=V6B&propertyType=Condo`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(marketEvidenceApiResponseSchema.safeParse(body).success).toBe(true);
    expect(body.markets.length).toBeGreaterThan(0);
  });

  it("echoes a well-formed x-request-id but replaces an unsafe one", async () => {
    const good = await fetch(`${baseUrl}/api/health`, { headers: { "x-request-id": "trace-123" } });
    expect(good.headers.get("x-request-id")).toBe("trace-123");

    const bad = await fetch(`${baseUrl}/api/health`, { headers: { "x-request-id": "a".repeat(500) } });
    expect(bad.headers.get("x-request-id")).not.toBe("a".repeat(500));
    expect(bad.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("rate limiting without a trusted proxy", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    ({ server, baseUrl } = await startApp({
      PUBLIC_MODE: "true",
      DEMO_MODE: "",
      MODEL_REQUESTS_PER_MINUTE: "10",
      TRUST_PROXY: "",
      VERCEL: "",
    }));
  });
  afterAll(() => stopApp(server));

  it("ignores client-supplied X-Forwarded-For, so rotating it cannot bypass the limit", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await postJson(`${baseUrl}/api/estimate`, JSON.stringify(validProperty), {
        "X-Forwarded-For": `203.0.113.${attempt}`,
      });
      statuses.push(response.status);
    }

    expect(statuses).toContain(429);
  });
});

describe("demo mode postal matching", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    ({ server, baseUrl } = await startApp({ DEMO_MODE: "true", PUBLIC_MODE: "" }));
  });
  afterAll(() => stopApp(server));

  it("matches sample postal codes regardless of case and spacing", async () => {
    // V5T 3K4 is the townhouse sample; asking for a Condo there means a failed postal match would
    // silently fall back to the condo sample instead.
    const property = { ...validProperty, postalCode: "V5T 3K4", propertyType: "Condo" };
    const upper = await (await postJson(`${baseUrl}/api/estimate`, JSON.stringify(property))).json();
    const lower = await (
      await postJson(`${baseUrl}/api/estimate`, JSON.stringify({ ...property, postalCode: "v5t3k4" }))
    ).json();

    expect(upper.baseValue).toBeTypeOf("number");
    expect(lower.baseValue).toBe(upper.baseValue);
  });
});
