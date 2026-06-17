import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The committed snapshot is produced by scripts/export_registry_snapshot.py and may not exist in
// every checkout, so these tests mock the repo-file loader instead of relying on the file.
const registryFixture = {
  status: "ready",
  generatedAt: "2026-06-17T20:54:23+00:00",
  trackingStore: "sqlite:///mlflow/tracking.db",
  policy: {
    primaryMetric: "spatialCvMae",
    direction: "lower-is-better",
    guardrail: "holdoutMape may not regress more than 0.02 vs the incumbent Production version",
    rationale: "GroupKFold-by-FSA spatial CV measures generalization to unseen postal areas.",
  },
  models: [
    {
      name: "vancouver-base-price",
      market: "vancouver",
      productionVersion: 1,
      modelVersionTag: "vancouver-base-price-v5",
      stage: "Production",
      modelArchitecture: "local-per-type",
      spatialCvMae: 432_059.45,
      holdoutMae: 331_348.39,
      holdoutMape: 0.1264,
      runId: "efdda861661c42d4805ceec47aa1975e",
    },
  ],
};

async function importRegistryWithFile(file: unknown | Error) {
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
  return import("./registry");
}

afterEach(() => {
  vi.doUnmock("./repoFiles");
  vi.resetModules();
});

describe("buildRegistryResponse", () => {
  it("serves a shape-valid snapshot verbatim", async () => {
    const { buildRegistryResponse } = await importRegistryWithFile(registryFixture);

    expect(buildRegistryResponse()).toEqual(registryFixture);
  });

  it("returns unavailable when the snapshot is missing", async () => {
    const { buildRegistryResponse } = await importRegistryWithFile(new Error("ENOENT: model_registry.json is missing"));

    const response = buildRegistryResponse();

    expect(response.status).toBe("unavailable");
    if (response.status === "unavailable") {
      expect(response.message).toContain("model_registry.json");
    }
  });

  it("returns unavailable when the snapshot breaks the registry contract", async () => {
    const { models: _models, ...fileMissingModels } = registryFixture;
    const { buildRegistryResponse } = await importRegistryWithFile(fileMissingModels);

    expect(buildRegistryResponse().status).toBe("unavailable");
  });
});

describe("GET /api/registry", () => {
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

  it("answers HTTP 200 with a contract-shaped payload whether or not the snapshot exists", async () => {
    const response = await fetch(`${baseUrl}/api/registry`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(["ready", "unavailable"]).toContain(body.status);
    if (body.status === "ready") {
      expect(Array.isArray(body.models)).toBe(true);
      expect(typeof body.policy.primaryMetric).toBe("string");
    } else {
      expect(typeof body.message).toBe("string");
    }
  });
});
