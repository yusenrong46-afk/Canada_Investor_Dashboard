import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("public-mode Insights route", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    vi.stubEnv("DEMO_MODE", "false");
    vi.stubEnv("PUBLIC_MODE", "true");
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

  it("does not return manufactured starter portfolio rows", async () => {
    const response = await fetch(`${baseUrl}/api/insights`);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("NO_PORTFOLIO");
    expect(body.message).toContain("no server-side portfolio");
    expect(body.rows).toBeUndefined();
  });
});
