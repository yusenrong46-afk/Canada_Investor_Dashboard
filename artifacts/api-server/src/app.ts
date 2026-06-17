import "dotenv/config";

import cors from "cors";
import express from "express";
import { ZodError } from "zod/v4";

import { analyzeDeal } from "./dealAnalysis";
import { buildDemoDealAnalyze, buildDemoEstimate, buildDemoPlan, buildDemoSimulate, demoModeEnabled, getDemoMetrics } from "./demo";
import { buildEvidenceResponse, evidenceQuerySchema } from "./evidence";
import { buildExperimentsResponse } from "./experiments";
import { buildRegistryResponse } from "./registry";
import { buildMapResponse } from "./map";
import { buildMarketsResponse } from "./marketsRoute";
import { buildSalePlan, estimateProperty, simulateScenario } from "./model";
import { buildPublicDealAnalyze, buildPublicEstimate, buildPublicPlan, buildPublicSimulate, getPublicMetrics, publicModeEnabled } from "./publicEngine";
import { dealAnalyzeRequestSchema, estimateRequestSchema, planRequestSchema, simulateRequestSchema } from "./schemas";
import { getMarketTrend } from "./trend";

const app = express();

app.use(cors());
app.use(express.json());

app.get(["/health", "/api/health"], (_req, res) => {
  res.json({
    ok: true,
    service: "api-server",
    mode: demoModeEnabled ? "demo-safe-samples" : publicModeEnabled ? "public-interactive-estimator" : "vancouver-estimate-plus-seattle-observed-uplift",
  });
});

// Every endpoint validates at the API boundary so frontend, demo mode, public mode, and live model calls share one contract.
app.post("/api/estimate", async (req, res, next) => {
  try {
    const request = estimateRequestSchema.parse(req.body);
    const response = demoModeEnabled ? buildDemoEstimate(request) : publicModeEnabled ? buildPublicEstimate(request) : await estimateProperty(request);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

app.post("/api/simulate", async (req, res, next) => {
  try {
    const request = simulateRequestSchema.parse(req.body);
    const response = demoModeEnabled ? buildDemoSimulate(request) : publicModeEnabled ? buildPublicSimulate(request) : await simulateScenario(request);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

app.post("/api/plan", async (req, res, next) => {
  try {
    const request = planRequestSchema.parse(req.body);
    const response = demoModeEnabled ? buildDemoPlan(request) : publicModeEnabled ? buildPublicPlan(request) : await buildSalePlan(request);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

// Evidence and markets serve committed real data, so all three modes share the same handlers.
app.get("/api/evidence", (req, res, next) => {
  try {
    const query = evidenceQuerySchema.parse(req.query);
    res.json(buildEvidenceResponse(query.market, query.fsa, query.propertyType));
  } catch (error) {
    next(error);
  }
});

app.get("/api/trend", async (req, res, next) => {
  try {
    const market = typeof req.query.market === "string" ? req.query.market : "";
    res.json(await getMarketTrend(market));
  } catch (error) {
    next(error);
  }
});

// Map and experiments serve committed exports, so all three modes share the same handlers; an
// unavailable payload stays HTTP 200 like the other static-export endpoints.
app.get("/api/map", (req, res, next) => {
  try {
    const market = typeof req.query.market === "string" ? req.query.market : "";
    res.json(buildMapResponse(market));
  } catch (error) {
    next(error);
  }
});

app.get("/api/experiments", (_req, res, next) => {
  try {
    res.json(buildExperimentsResponse());
  } catch (error) {
    next(error);
  }
});

app.get("/api/registry", (_req, res, next) => {
  try {
    res.json(buildRegistryResponse());
  } catch (error) {
    next(error);
  }
});

app.get("/api/markets", (_req, res, next) => {
  try {
    res.json(buildMarketsResponse());
  } catch (error) {
    next(error);
  }
});

app.get("/api/insights", (_req, res, next) => {
  try {
    res.json(publicModeEnabled ? getPublicMetrics() : getDemoMetrics());
  } catch (error) {
    next(error);
  }
});

app.post("/api/deal/analyze", async (req, res, next) => {
  try {
    const request = dealAnalyzeRequestSchema.parse(req.body);
    const response = demoModeEnabled ? buildDemoDealAnalyze(request) : publicModeEnabled ? buildPublicDealAnalyze(request) : await analyzeDeal(request);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    return res.status(400).json({
      message: "Request validation failed",
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const message = error instanceof Error ? error.message : "Unknown server error";
  return res.status(500).json({ message });
});

export default app;
