import crypto from "node:crypto";

import type express from "express";

import { isDemoModeEnabled, isPublicModeEnabled } from "./config";

function resolveModeLabel(): string {
  if (isDemoModeEnabled()) {
    return "demo-samples";
  }
  if (isPublicModeEnabled()) {
    return "public-interactive";
  }
  return "live-model";
}

export function requestLoggingMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  // Accept a caller's request id only if it is short and header-safe; it is echoed back and logged.
  const incoming = req.headers["x-request-id"];
  const requestId = typeof incoming === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(incoming.trim())
    ? incoming.trim()
    : crypto.randomUUID();

  res.locals.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  const startedAt = Date.now();
  res.on("finish", () => {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        requestId,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
        mode: resolveModeLabel(),
      }),
    );
  });

  next();
}

export function logError(requestId: string | undefined, code: string, message: string, detail?: unknown): void {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      requestId,
      code,
      message,
      ...(detail !== undefined ? { detail } : {}),
    }),
  );
}
