import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readReleaseIdentity, resetReleasePinForTests, resolvePublishedExport } from "./repoFiles";

function writeRelease(root: string, releaseId: string, evidence: string, mapBody: string) {
  const exportDir = path.join(root, "data", "releases", "published", releaseId, "exports");
  fs.mkdirSync(exportDir, { recursive: true });
  fs.writeFileSync(path.join(exportDir, "market_evidence.json"), evidence);
  fs.writeFileSync(path.join(exportDir, "market_map.json"), mapBody);
}

function select(root: string, releaseId: string, role: string) {
  const pointer = {
    releaseId,
    relativePath: `published/${releaseId}`,
    validated: false,
    role,
    lineageClass: role === "retained_legacy" ? "legacy_processed_snapshot" : "offline_fixture",
    productDataValidated: false,
    validationScope: role,
    dataChecksPassed: role === "fixture",
    rawLineageRecovered: false,
    markets: {},
  };
  fs.mkdirSync(path.join(root, "data", "releases"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "releases", "current.json"), JSON.stringify(pointer));
}

describe("process release pin", () => {
  let root: string;

  afterEach(() => {
    resetReleasePinForTests();
  });

  it("keeps release A for related exports until the process pin is reset", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cvh-pin-"));
    writeRelease(root, "release-a", "evidence-a", "map-a");
    writeRelease(root, "release-b", "evidence-b", "map-b");
    select(root, "release-a", "retained_legacy");

    expect(fs.readFileSync(resolvePublishedExport(root, "market_evidence.json"), "utf8")).toBe("evidence-a");
    expect(fs.readFileSync(resolvePublishedExport(root, "market_map.json"), "utf8")).toBe("map-a");
    expect(readReleaseIdentity(root).summary).toContain("not a validated product dataset");
    expect(readReleaseIdentity(root).productDataValidated).toBe(false);

    select(root, "release-b", "fixture");
    expect(fs.readFileSync(resolvePublishedExport(root, "market_evidence.json"), "utf8")).toBe("evidence-a");
    expect(fs.readFileSync(resolvePublishedExport(root, "market_map.json"), "utf8")).toBe("map-a");

    resetReleasePinForTests();
    expect(fs.readFileSync(resolvePublishedExport(root, "market_evidence.json"), "utf8")).toBe("evidence-b");
    expect(readReleaseIdentity(root).role).toBe("fixture");
    expect(readReleaseIdentity(root).summary).toContain("do not validate production data");

    fs.unlinkSync(path.join(root, "data", "releases", "published", "release-b", "exports", "market_map.json"));
    fs.mkdirSync(path.join(root, "data", "exports"), { recursive: true });
    fs.writeFileSync(path.join(root, "data", "exports", "market_map.json"), "legacy-map");
    resetReleasePinForTests();
    expect(() => resolvePublishedExport(root, "market_map.json")).toThrow(/do not fall back/);
  });
});
