import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildMapResponse } from "./map";

describe("buildMapResponse from the committed export", () => {
  it("returns a ready Vancouver payload with [lat, lng] H3 boundaries", () => {
    const response = buildMapResponse("vancouver");

    expect(response.status).toBe("ready");
    if (response.status === "ready") {
      expect(response.generatedAt.length).toBeGreaterThan(0);
      expect(response.source.length).toBeGreaterThan(0);
      expect(response.market).toBe("vancouver");
      expect(response.label).toBe("Vancouver");
      expect(response.zoom).toBeGreaterThan(0);
      expect(response.pricePerSqftDomain[0]).toBeLessThan(response.pricePerSqftDomain[1]);
      expect(response.cells.length).toBeGreaterThan(0);
      for (const cell of response.cells) {
        expect(cell.rows).toBeGreaterThanOrEqual(5);
        expect(cell.boundary.length).toBeGreaterThanOrEqual(6);
        for (const [lat, lng] of cell.boundary) {
          // Vancouver vertices must be [lat, lng]; a swapped pair would put longitude near 49.
          expect(lat).toBeGreaterThan(48);
          expect(lat).toBeLessThan(50.5);
          expect(lng).toBeGreaterThan(-124);
          expect(lng).toBeLessThan(-122);
        }
      }
    }
  });

  it("returns a ready Halifax / Maritimes payload", () => {
    const response = buildMapResponse("halifax_maritimes");

    expect(response.status).toBe("ready");
    if (response.status === "ready") {
      expect(response.market).toBe("halifax_maritimes");
      expect(response.cells.length).toBeGreaterThan(0);
    }
  });

  it("returns unavailable for an unknown market and names the available ones", () => {
    const response = buildMapResponse("toronto");

    expect(response.status).toBe("unavailable");
    if (response.status === "unavailable") {
      expect(response.message).toContain("toronto");
      expect(response.message).toContain("halifax_maritimes");
      expect(response.message).toContain("vancouver");
    }
  });

  it("returns unavailable when the export file is missing", async () => {
    vi.resetModules();
    vi.doMock("./repoFiles", () => ({
      findRepoRoot: () => "/nonexistent",
      readRepoJson: () => {
        throw new Error("ENOENT: market_map.json is missing");
      },
    }));
    const { buildMapResponse: buildWithoutFile } = await import("./map");

    const response = buildWithoutFile("vancouver");

    expect(response.status).toBe("unavailable");
    if (response.status === "unavailable") {
      expect(response.message).toContain("market_map.json");
    }

    vi.doUnmock("./repoFiles");
    vi.resetModules();
  });
});

describe("GET /api/map", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    vi.resetModules();
    const { default: app } = await import("./app");
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it("serves the committed map export with HTTP 200", async () => {
    const response = await fetch(`${baseUrl}/api/map?market=vancouver`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ready");
    expect(body.market).toBe("vancouver");
    expect(body.cells.length).toBeGreaterThan(0);
  });

  it("rejects an unknown market with a 400 validation error", async () => {
    const response = await fetch(`${baseUrl}/api/map?market=toronto`);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toBe("Request validation failed");
    expect(body.error?.code).toBe("VALIDATION");
  });

  it("requires the market query param", async () => {
    const response = await fetch(`${baseUrl}/api/map`);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toBe("Request validation failed");
  });
});
