import fs from "node:fs";
import path from "node:path";

const cachedRoots = new Map<string, string>();
const REPO_MARKER = "pnpm-workspace.yaml";

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

export function resolveRepoFile(relativePath: string): string {
  const root = findRepoRoot(relativePath);
  const normalized = relativePath.split(path.sep).join("/");
  if (!normalized.startsWith("data/exports/")) {
    return path.join(root, relativePath);
  }

  const pointerPath = path.join(root, "data", "releases", "current.json");
  if (!fs.existsSync(pointerPath)) {
    return path.join(root, relativePath);
  }

  const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8")) as { relativePath?: string };
  if (!pointer.relativePath) {
    throw new Error("current.json is missing relativePath");
  }

  const filename = path.posix.basename(normalized);
  const resolved = path.join(root, "data", "releases", pointer.relativePath, "exports", filename);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Selected release is missing ${filename}. Readers do not mix this file with data/exports.`);
  }
  return resolved;
}

export function readRepoJson(relativePath: string): unknown {
  const filePath = resolveRepoFile(relativePath);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
