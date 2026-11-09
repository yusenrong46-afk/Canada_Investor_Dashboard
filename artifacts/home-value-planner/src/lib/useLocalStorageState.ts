import { useEffect, useState } from "react";

/** Turns parsed JSON back into a usable value, or returns null when nothing in it can be used. */
export type StoredValueParser<T> = (raw: unknown) => T | null;

export function storageBackupKey(key: string): string {
  return `${key}:backup`;
}

// Every storage call is guarded: blocked cookies, some private modes, and full quotas make localStorage throw.
function readItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.warn(`[storage] failed to persist ${key}`, error);
  }
}

export function readStoredValue<T>(key: string, initialValue: T, parse: StoredValueParser<T>): T {
  if (typeof window === "undefined") {
    return initialValue;
  }

  const saved = readItem(key);
  if (!saved) {
    return initialValue;
  }

  let parsed: T | null = null;
  try {
    parsed = parse(JSON.parse(saved));
  } catch {
    parsed = null;
  }

  // The value read back is written over the original on the next render. If reading rejected or changed
  // anything, keep the original under a backup key first so nothing the user saved is silently lost.
  if (parsed == null || JSON.stringify(parsed) !== saved) {
    console.warn(`[storage] ${key} was invalid or migrated; original kept under ${storageBackupKey(key)}`);
    writeItem(storageBackupKey(key), saved);
  }

  return parsed ?? initialValue;
}

export function useLocalStorageState<T>(key: string, initialValue: T, parse: StoredValueParser<T>) {
  const [value, setValue] = useState<T>(() => readStoredValue(key, initialValue, parse));

  useEffect(() => {
    writeItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue] as const;
}
