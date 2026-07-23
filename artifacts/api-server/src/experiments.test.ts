import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The committed export is produced by a separate pipeline and may not exist in every checkout,
// so these tests mock the repo-file loader instead of relying on the file's presence.
const experimentsFixture = {
  status: "ready",
  generatedAt: "2026-06-09T00:00:00+00:00",
  source: "scripts/run_model_experiments.py against fact_property_training_mart",
  rows: [
    {
      experiment: "local",
      market: "halifax_maritimes",
      propertyType: "Detached",
      family: "xgboost",
      trainingRows: 14_398,
      holdoutRows: 3_600,
      holdoutMae: 48_212.5,
      holdoutMape: 0.171,
      spatialCvMae: 51_204.25,
    },
    {
      experiment: "pooled",
      market: "vancouver",
      propertyType: "Condo",
      family: "random-forest",
      trainingRows: 2_100,
      holdoutRows: 525,
      holdoutMae: 301_440,
      holdoutMape: 0.139,
      spatialCvMae: null,
      notes: "Pooled training mixes sale-price and listing-price targets.",
    },
  ],
  conclusions: ["Local models beat pooled training on holdout MAE in both markets."],
};

async function importExperimentsWithFile(file: unknown | Error) {
  vi.resetModules();
  vi.doMock("./repoFiles", () => ({
    findRepoRoot: () => "/nonexistent",
    readRepoJson: () => {
      if (file instanceof Error) {
        throw file;
      }
      return file;
    },
  }));
  return import("./experiments");
}

afterEach(() => {
  vi.doUnmock("./repoFiles");
  vi.resetModules();
});

describe("buildExperimentsResponse", () => {
  it("serves a shape-valid export verbatim", async () => {
    const { buildExperimentsResponse } = await importExperimentsWithFile(experimentsFixture);

    expect(buildExperimentsResponse()).toEqual(experimentsFixture);
  });

  it("returns unavailable when the export file is missing", async () => {
    const { buildExperimentsResponse } = await importExperimentsWithFile(new Error("ENOENT: model_experiments.json is missing"));

    const response = buildExperimentsResponse();

    expect(response.status).toBe("unavailable");
    if (response.status === "unavailable") {
      expect(response.message).toContain("model_experiments.json");
    }
  });

  it("returns unavailable when the export breaks the experiments contract", async () => {
    const { conclusions: _conclusions, ...fileMissingConclusions } = experimentsFixture;
    const { buildExperimentsResponse } = await importExperimentsWithFile(fileMissingConclusions);

    expect(buildExperimentsResponse().status).toBe("unavailable");
  });

  it("rejects rows with an unknown experiment kind", async () => {
    const fileWithBadRow = {
      ...experimentsFixture,
      rows: [{ ...experimentsFixture.rows[0], experiment: "ensemble" }],
    };
    const { buildExperimentsResponse } = await importExperimentsWithFile(fileWithBadRow);

    expect(buildExperimentsResponse().status).toBe("unavailable");
  });
});

describe("GET /api/experiments", () => {
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

  it("answers HTTP 200 with a contract-shaped payload whether or not the export exists", async () => {
    const response = await fetch(`${baseUrl}/api/experiments`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(["ready", "unavailable"]).toContain(body.status);
    if (body.status === "ready") {
      expect(Array.isArray(body.rows)).toBe(true);
      expect(Array.isArray(body.conclusions)).toBe(true);
    } else {
      expect(typeof body.message).toBe("string");
    }
  });
});
