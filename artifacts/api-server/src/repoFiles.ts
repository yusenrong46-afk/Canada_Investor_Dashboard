import fs from "node:fs";
import path from "node:path";

const cachedRoots = new Map<string, string>();

// The dev server, the bundled build, and vitest run from different working directories, so probe upward for a known repo file.
export function findRepoRoot(markerRelativePath: string): string {
  const cached = cachedRoots.get(markerRelativePath);
  if (cached) {
    return cached;
  }

  const candidates = [process.cwd(), path.resolve(process.cwd(), "../.."), path.resolve(process.cwd(), "../../..")];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, markerRelativePath))) {
      cachedRoots.set(markerRelativePath, candidate);
      return candidate;
    }
  }

  const fallback = path.resolve(process.cwd(), "../..");
  cachedRoots.set(markerRelativePath, fallback);
  return fallback;
}

export function readRepoJson(relativePath: string): unknown {
  const filePath = path.join(findRepoRoot(relativePath), relativePath);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
