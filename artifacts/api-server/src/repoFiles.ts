import fs from "node:fs";
import path from "node:path";

const cachedRoots = new Map<string, string>();
const REPO_MARKER = "pnpm-workspace.yaml";

export type ReleaseIdentity = {
  releaseId: string | null;
  role: string;
  validated: boolean;
  productDataValidated: boolean;
  validationScope: string | null;
  lineageClass: string | null;
  dataChecksPassed: boolean;
  rawLineageRecovered: boolean;
  markets: Record<string, string>;
  summary: string;
};

type ReleasePointer = {
  releaseId?: string;
  relativePath?: string;
  role?: string;
  validated?: boolean;
  productDataValidated?: boolean;
  validationScope?: string;
  lineageClass?: string;
  dataChecksPassed?: boolean;
  rawLineageRecovered?: boolean;
  markets?: Record<string, string>;
};

// One pointer for the life of this process. A new release is picked up on restart.
let processPin: { root: string; pointer: ReleasePointer | null } | undefined;

export function resetReleasePinForTests(): void {
  processPin = undefined;
}

// The dev server, the bundled build, and vitest run from different working directories.
// Walk upward for the workspace file. Do not key off package.json: api-server has its own.
export function findRepoRoot(markerRelativePath = REPO_MARKER): string {
  const cached = cachedRoots.get(markerRelativePath);
  if (cached) {
    return cached;
  }

  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), "../.."),
    path.resolve(process.cwd(), "../../.."),
    path.resolve(process.cwd(), "../../../.."),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, REPO_MARKER)) || fs.existsSync(path.join(candidate, markerRelativePath))) {
      cachedRoots.set(markerRelativePath, candidate);
      return candidate;
    }
  }

  const fallback = path.resolve(process.cwd(), "../..");
  cachedRoots.set(markerRelativePath, fallback);
  return fallback;
}

export function pinnedReleasePointer(repoRoot: string): ReleasePointer | null {
  if (processPin && processPin.root === repoRoot) {
    return processPin.pointer;
  }

  const pointerPath = path.join(repoRoot, "data", "releases", "current.json");
  if (!fs.existsSync(pointerPath)) {
    processPin = { root: repoRoot, pointer: null };
    return null;
  }

  const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8")) as ReleasePointer;
  processPin = { root: repoRoot, pointer };
  return pointer;
}

export function readReleaseIdentity(repoRoot = findRepoRoot()): ReleaseIdentity {
  const pointer = pinnedReleasePointer(repoRoot);
  if (!pointer) {
    return {
      releaseId: null,
      role: "unpinned",
      validated: false,
      productDataValidated: false,
      validationScope: null,
      lineageClass: null,
      dataChecksPassed: false,
      rawLineageRecovered: false,
      markets: {},
      summary: "No data release is pinned. Readers are using the legacy export directory.",
    };
  }

  const role = pointer.role ?? "unknown";
  const lineageClass = pointer.lineageClass ?? null;
  const releaseId = pointer.releaseId ?? null;
  const productDataValidated = pointer.productDataValidated === true;
  return {
    releaseId,
    role,
    validated: pointer.validated === true,
    productDataValidated,
    validationScope: pointer.validationScope ?? role,
    lineageClass,
    dataChecksPassed: pointer.dataChecksPassed === true,
    rawLineageRecovered: pointer.rawLineageRecovered === true,
    markets: pointer.markets ?? {},
    summary: releaseSummary(releaseId, role, lineageClass, productDataValidated),
  };
}

function releaseSummary(
  releaseId: string | null,
  role: string,
  lineageClass: string | null,
  productDataValidated: boolean,
): string {
  const label = releaseId ?? "unknown";
  if (role === "retained_legacy" || lineageClass === "legacy_processed_snapshot") {
    return `Data release ${label} is a retained legacy snapshot and is not a validated product dataset.`;
  }
  if (role === "fixture") {
    return `Data release ${label} is an offline fixture. Its checks do not validate production data.`;
  }
  if (role === "scoped_hrm_data") {
    return `Data release ${label} passed HRM data checks only. Vancouver is outside that scope, and fitted models were not validated.`;
  }
  if (productDataValidated) {
    return `Data release ${label} claims product data validation.`;
  }
  return `Data release ${label} (${role}) is not a validated product dataset.`;
}

export function resolvePublishedExport(repoRoot: string, filename: string): string {
  const pointer = pinnedReleasePointer(repoRoot);
  if (!pointer) {
    return path.join(repoRoot, "data", "exports", filename);
  }
  if (!pointer.relativePath) {
    throw new Error("current.json is missing relativePath");
  }
  const resolved = path.join(repoRoot, "data", "releases", pointer.relativePath, "exports", filename);
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `Selected release ${pointer.releaseId ?? ""} is missing ${filename}. Readers do not fall back to another release.`,
    );
  }
  return resolved;
}

export function resolveRepoFile(relativePath: string): string {
  const root = findRepoRoot(relativePath);
  const normalized = relativePath.split(path.sep).join("/");
  if (!normalized.startsWith("data/exports/")) {
    return path.join(root, relativePath);
  }

  const filename = path.posix.basename(normalized);
  return resolvePublishedExport(root, filename);
}

export function readRepoJson(relativePath: string): unknown {
  const filePath = resolveRepoFile(relativePath);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
