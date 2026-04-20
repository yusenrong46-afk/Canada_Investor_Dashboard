import "dotenv/config";

import cors from "cors";
import express from "express";
import { ZodError } from "zod/v4";

import { buildSalePlan, estimateProperty, simulateScenario } from "./model";
import { estimateRequestSchema, planRequestSchema, simulateRequestSchema } from "./schemas";

const app = express();
const host = process.env.API_HOST ?? "127.0.0.1";
const port = Number(process.env.API_PORT ?? 4000);

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "api-server", mode: "vancouver-estimate-plus-rule-uplift" });
});

app.post("/api/estimate", async (req, res, next) => {
  try {
    const property = estimateRequestSchema.parse(req.body);
    const estimate = await estimateProperty(property);
    res.json(estimate);
  } catch (error) {
    next(error);
  }
});

app.post("/api/simulate", async (req, res, next) => {
  try {
    const request = simulateRequestSchema.parse(req.body);
    const response = await simulateScenario(request);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

app.post("/api/plan", async (req, res, next) => {
  try {
    const request = planRequestSchema.parse(req.body);
    const response = await buildSalePlan(request);
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

app.listen(port, host, () => {
  console.log(`API server listening on http://${host}:${port}`);
});
