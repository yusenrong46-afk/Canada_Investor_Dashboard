import fs from "node:fs";
import path from "node:path";

// The dev server, the bundled build, and vitest run from different working directories, so probe upward for a known repo file.
export function findRepoRoot(markerRelativePath: string): string {
  const candidates = [process.cwd(), path.resolve(process.cwd(), "../.."), path.resolve(process.cwd(), "../../..")];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, markerRelativePath))) {
      return candidate;
    }
  }

  return path.resolve(process.cwd(), "../..");
}

export function readRepoJson<T>(relativePath: string): T {
  const filePath = path.join(findRepoRoot(relativePath), relativePath);
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}
