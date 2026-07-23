let cachedConfig: RuntimeConfig | null = null;

export interface RuntimeConfig {
  demoModeEnabled: boolean;
  publicModeEnabled: boolean;
  modelServiceBaseUrl: string;
  modelServiceTimeoutMs: number;
  apiCorsOrigins: Set<string>;
  modelRequestsPerMinute: number;
  apiHost: string;
  apiPort: number;
}

function parseBooleanFlag(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

function parseBoundedNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric environment value: ${value}`);
  }
  return Math.min(Math.max(parsed, min), max);
}

export function getConfig(): RuntimeConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  cachedConfig = {
    demoModeEnabled: parseBooleanFlag(process.env.DEMO_MODE),
    publicModeEnabled: parseBooleanFlag(process.env.PUBLIC_MODE),
    modelServiceBaseUrl: (process.env.MODEL_SERVICE_URL ?? "http://127.0.0.1:5001").replace(/\/$/, ""),
    modelServiceTimeoutMs: parseBoundedNumber(process.env.MODEL_SERVICE_TIMEOUT_MS, 60_000, 1_000, 120_000),
    apiCorsOrigins: new Set(
      (process.env.API_CORS_ORIGINS ?? "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
    modelRequestsPerMinute: parseBoundedNumber(process.env.MODEL_REQUESTS_PER_MINUTE, 120, 10, 1_000),
    apiHost: process.env.API_HOST ?? "127.0.0.1",
    apiPort: parseBoundedNumber(process.env.API_PORT ?? process.env.PORT, 4000, 1, 65_535),
  };

  return cachedConfig;
}

export function resetConfigForTests(): void {
  cachedConfig = null;
}

export function isDemoModeEnabled(): boolean {
  return getConfig().demoModeEnabled;
}

export function isPublicModeEnabled(): boolean {
  return getConfig().publicModeEnabled;
}
