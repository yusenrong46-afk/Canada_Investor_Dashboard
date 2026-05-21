import "dotenv/config";

import cors from "cors";
import express from "express";
import { ZodError } from "zod/v4";

import { answerProjectQuestion } from "./assistant";
import { analyzeDeal } from "./dealAnalysis";
import { assistantQuerySchema, dealAnalyzeRequestSchema } from "./schemas";

const app = express();
const host = process.env.API_HOST ?? (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const port = Number(process.env.API_PORT ?? process.env.PORT ?? 4000);

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "api-server", mode: "vancouver-estimate-plus-seattle-observed-uplift" });
});

app.post("/api/deal/analyze", async (req, res, next) => {
  try {
    const request = dealAnalyzeRequestSchema.parse(req.body);
    const response = await analyzeDeal(request);
    res.json(response);
  } catch (error) {
    next(error);
  }
});

app.post("/api/assistant/query", (req, res, next) => {
  try {
    const request = assistantQuerySchema.parse(req.body);
    const response = answerProjectQuestion(request);
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
