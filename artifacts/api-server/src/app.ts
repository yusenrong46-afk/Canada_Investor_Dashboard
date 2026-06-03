import "dotenv/config";

import cors from "cors";
import express from "express";
import { ZodError } from "zod/v4";

import { analyzeDeal } from "./dealAnalysis";
import { buildDemoDealAnalyze, buildDemoEstimate, buildDemoPlan, buildDemoSimulate, demoModeEnabled, getDemoMetrics } from "./demo";
import { buildSalePlan, estimateProperty, simulateScenario } from "./model";
import { buildPublicDealAnalyze, buildPublicEstimate, buildPublicPlan, buildPublicSimulate, getPublicMetrics, publicModeEnabled } from "./publicEngine";
import { dealAnalyzeRequestSchema, estimateRequestSchema, planRequestSchema, simulateRequestSchema } from "./schemas";

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
