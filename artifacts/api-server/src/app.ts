import "dotenv/config";

import {
  API_CONTRACT_VERSION,
  apiHealthResponseSchema,
  dealAnalyzeResponseSchema,
  estimateResponseSchema,
  insightsResponseSchema,
  marketQuerySchema,
  planResponseSchema,
  simulateResponseSchema,
} from "@vvl/shared";
import cors from "cors";
import express from "express";
import { ZodError } from "zod/v4";

import { getConfig, isDemoModeEnabled, isPublicModeEnabled } from "./config";
import { buildErrorBody } from "./errorEnvelope";
import { buildEvidenceResponse, evidenceQuerySchema } from "./evidence";
import { buildExperimentsResponse } from "./experiments";
import { resolveHandlers } from "./handlers";
import { ResponseContractError, parseResponseOrThrow } from "./httpErrors";
import { logError, requestLoggingMiddleware } from "./logging";
import { buildMapResponse } from "./map";
import { buildMarketsResponse, resolveApiMode } from "./marketsRoute";
import { modelServiceIsReady, ModelServiceError } from "./model";
import { dealAnalyzeRequestSchema, estimateRequestSchema, planRequestSchema, simulateRequestSchema } from "./schemas";
import { getMarketTrend } from "./trend";

const app = express();
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self'",
  "font-src 'self' https://fonts.gstatic.com",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: https://tile.openstreetmap.org",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "upgrade-insecure-requests",
].join("; ");

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use((_req, res, next) => {
  res.setHeader("Content-Security-Policy", contentSecurityPolicy);
  res.setHeader("Permissions-Policy", "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

app.use(requestLoggingMiddleware);

function runtimeMode() {
  const mode = resolveApiMode();
  return mode === "demo" ? "demo-samples" : mode === "public" ? "public-interactive" : "live-model";
}

function pruneRateLimitWindows(now: number): void {
  for (const [key, windowRow] of requestWindows.entries()) {
    if (now - windowRow.startedAt >= 60_000) {
      requestWindows.delete(key);
    }
  }
}

const requestWindows = new Map<string, { startedAt: number; count: number }>();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }
      try {
        const url = new URL(origin);
        const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
        const configuredOrigins = getConfig().apiCorsOrigins;
        return callback(null, local || configuredOrigins.has(origin));
      } catch {
        return callback(null, false);
      }
    },
  }),
);
app.use(express.json({ limit: "32kb" }));
app.use("/api", (req, res, next) => {
  if (req.method !== "POST") {
    return next();
  }
  const now = Date.now();
  const requestLimit = getConfig().modelRequestsPerMinute;
  pruneRateLimitWindows(now);
  const key = req.ip || "unknown";
  const current = requestWindows.get(key);
  const windowRow = !current || now - current.startedAt >= 60_000 ? { startedAt: now, count: 0 } : current;
  windowRow.count += 1;
  requestWindows.set(key, windowRow);
  if (windowRow.count > requestLimit) {
    console.warn(JSON.stringify({ level: "warn", event: "rate-limited", ip: key, path: req.path }));
    return res.status(429).json(buildErrorBody("RATE_LIMITED", "Too many model requests. Wait a minute and try again."));
  }
  return next();
});

app.get(["/health", "/api/health"], async (_req, res) => {
  const mode = runtimeMode();
  res.json(parseResponseOrThrow(apiHealthResponseSchema, {
    ok: true,
    service: "api-server",
    mode,
    contractVersion: API_CONTRACT_VERSION,
    ...(mode === "live-model" ? { modelServiceReady: await modelServiceIsReady() } : {}),
  }));
});

// Every endpoint validates at the API boundary so frontend, demo mode, public mode, and live model calls share one contract.
app.post("/api/estimate", async (req, res, next) => {
  try {
    const request = estimateRequestSchema.parse(req.body);
    const handlers = resolveHandlers();
    const response = await handlers.estimate(request);
    res.json(parseResponseOrThrow(estimateResponseSchema, response));
  } catch (error) {
    next(error);
  }
});

app.post("/api/simulate", async (req, res, next) => {
  try {
    const request = simulateRequestSchema.parse(req.body);
    const handlers = resolveHandlers();
    const response = await handlers.simulate(request);
    res.json(parseResponseOrThrow(simulateResponseSchema, response));
  } catch (error) {
    next(error);
  }
});

app.post("/api/plan", async (req, res, next) => {
  try {
    const request = planRequestSchema.parse(req.body);
    const handlers = resolveHandlers();
    const response = await handlers.plan(request);
    res.json(parseResponseOrThrow(planResponseSchema, response));
  } catch (error) {
    next(error);
  }
});

function setExportCacheHeaders(res: express.Response) {
  res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
}

// Evidence and markets serve committed real data, so all three modes share the same handlers.
app.get("/api/evidence", (req, res, next) => {
  try {
    const query = evidenceQuerySchema.parse(req.query);
    setExportCacheHeaders(res);
    res.json(buildEvidenceResponse(query.market, query.fsa, query.propertyType));
  } catch (error) {
    next(error);
  }
});

app.get("/api/trend", async (req, res, next) => {
  try {
    const query = marketQuerySchema.parse(req.query);
    setExportCacheHeaders(res);
    res.json(await getMarketTrend(query.market));
  } catch (error) {
    next(error);
  }
});

// Map and experiments serve committed exports, so all three modes share the same handlers; an
// unavailable payload stays HTTP 200 like the other static-export endpoints.
app.get("/api/map", (req, res, next) => {
  try {
    const query = marketQuerySchema.parse(req.query);
    setExportCacheHeaders(res);
    res.json(buildMapResponse(query.market));
  } catch (error) {
    next(error);
  }
});

app.get("/api/experiments", (_req, res, next) => {
  try {
    setExportCacheHeaders(res);
    res.json(buildExperimentsResponse());
  } catch (error) {
    next(error);
  }
});

app.get("/api/markets", (_req, res, next) => {
  try {
    setExportCacheHeaders(res);
    res.json(buildMarketsResponse());
  } catch (error) {
    next(error);
  }
});

app.get("/api/insights", (_req, res, next) => {
  try {
    const handlers = resolveHandlers();
    if (isDemoModeEnabled()) {
      return res.json(parseResponseOrThrow(insightsResponseSchema, handlers.insights()));
    }
    const message = isPublicModeEnabled()
      ? "Public mode has no server-side portfolio. Save scenarios in this browser to build personal insights."
      : "Live mode has no server-side sample portfolio. Save real scenarios in this browser to build insights.";
    return res.status(409).json(buildErrorBody("NO_PORTFOLIO", message));
  } catch (error) {
    next(error);
  }
});

app.post("/api/deal/analyze", async (req, res, next) => {
  try {
    const request = dealAnalyzeRequestSchema.parse(req.body);
    const handlers = resolveHandlers();
    const response = await handlers.deal(request);
    res.json(parseResponseOrThrow(dealAnalyzeResponseSchema, response));
  } catch (error) {
    next(error);
  }
});

app.use((_req, res) => {
  res.status(404).json(buildErrorBody("NOT_FOUND", "Route not found."));
});

app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const requestId = typeof res.locals.requestId === "string" ? res.locals.requestId : undefined;

  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    logError(requestId, "VALIDATION", "Request validation failed", issues);
    return res.status(400).json(buildErrorBody("VALIDATION", "Request validation failed", issues));
  }

  if (error instanceof ResponseContractError) {
    logError(requestId, "RESPONSE_CONTRACT", error.message, error.zodError.issues);
    return res.status(500).json(buildErrorBody("RESPONSE_CONTRACT", "Response failed contract validation"));
  }

  if (error instanceof ModelServiceError) {
    if (error.status === 504) {
      logError(requestId, "UPSTREAM_TIMEOUT", error.message);
      return res.status(504).json(buildErrorBody("UPSTREAM_TIMEOUT", error.message));
    }
    const status = error.status >= 400 && error.status < 500 ? 422 : 502;
    const code = status === 502 ? "UPSTREAM_UNAVAILABLE" : "VALIDATION";
    logError(requestId, code, error.message);
    return res.status(status).json(buildErrorBody(code, error.message));
  }

  logError(requestId, "INTERNAL", error instanceof Error ? error.message : "Unknown error", error);
  return res.status(500).json(buildErrorBody("INTERNAL", "The service could not complete this request. Check model health and try again."));
});

export default app;
