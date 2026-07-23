import { useEffect, useState } from "react";

interface LocalStorageOptions<T> {
  migrate?: (raw: unknown) => T | null;
  validate?: (value: T) => boolean;
}

function readStoredValue<T>(key: string, initialValue: T, options?: LocalStorageOptions<T>): T {
  if (typeof window === "undefined") {
    return initialValue;
  }

  const saved = window.localStorage.getItem(key);
  if (!saved) {
    return initialValue;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(saved);
  } catch {
    window.localStorage.removeItem(key);
    return initialValue;
  }

  if (options?.migrate) {
    const migrated = options.migrate(raw);
    if (migrated != null) {
      if (options.validate && !options.validate(migrated)) {
        window.localStorage.removeItem(key);
        return initialValue;
      }
      return migrated;
    }
  }

  const candidate = raw as T;
  if (options?.validate && !options.validate(candidate)) {
    window.localStorage.removeItem(key);
    return initialValue;
  }

  return candidate;
}

export function useLocalStorageState<T>(key: string, initialValue: T, options?: LocalStorageOptions<T>) {
  const [value, setValue] = useState<T>(() => readStoredValue(key, initialValue, options));

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn(`[storage] failed to persist ${key}`, error);
    }
  }, [key, value]);

  return [value, setValue] as const;
}
