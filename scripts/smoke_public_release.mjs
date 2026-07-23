#!/usr/bin/env node

const CONTRACT_VERSION = "2026-07-18.v1";
const TIMEOUT_MS = 20_000;

function usage() {
  return [
    "Usage: node scripts/smoke_public_release.mjs <base-url> [--api-only]",
    "",
    "Examples:",
    "  node scripts/smoke_public_release.mjs https://preview.example.vercel.app",
    "  node scripts/smoke_public_release.mjs http://127.0.0.1:8787 --api-only",
    "",
    "Optional environment:",
    "  VERCEL_AUTOMATION_BYPASS_SECRET  Sent only as Vercel's protection-bypass header.",
  ].join("\n");
}

const args = process.argv.slice(2);
const rawBaseUrl = args.find((arg) => !arg.startsWith("--"));
const apiOnly = args.includes("--api-only");

if (!rawBaseUrl || args.includes("--help") || args.includes("-h")) {
  console.error(usage());
  process.exit(rawBaseUrl ? 0 : 2);
}

let baseUrl;
try {
  const parsed = new URL(rawBaseUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error("URL must use http or https");
  }
  baseUrl = parsed.toString().replace(/\/$/, "");
} catch (error) {
  console.error(`Invalid base URL: ${error.message}`);
  process.exit(2);
}

const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const baseHeaders = bypassSecret
  ? { "x-vercel-protection-bypass": bypassSecret }
  : {};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = performance.now();

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        ...baseHeaders,
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...options.headers,
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
    return {
      body,
      contentType,
      durationMs: Math.round(performance.now() - startedAt),
      headers: Object.fromEntries(response.headers.entries()),
      status: response.status,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function assertSecurityHeaders(result, label) {
  assert(result.headers["x-content-type-options"] === "nosniff", `${label}: MIME-sniffing protection is missing`);
  assert(result.headers["x-frame-options"] === "DENY", `${label}: clickjacking protection is missing`);
  assert(result.headers["referrer-policy"] === "strict-origin-when-cross-origin", `${label}: referrer policy is missing`);
  assert(result.headers["permissions-policy"]?.includes("camera=()"), `${label}: permissions policy is missing`);
  assert(result.headers["content-security-policy"]?.includes("script-src 'self'"), `${label}: CSP policy is missing`);
  assert(!result.headers["x-powered-by"], `${label}: framework fingerprint is exposed`);
}

function assertProvenance(body, label, expected = { evidenceLevel: "assumption", validationStatus: "unvalidated" }) {
  assert(body && typeof body === "object", `${label}: expected a JSON object`);
  assert(body.provenance?.contractVersion === CONTRACT_VERSION, `${label}: missing contract ${CONTRACT_VERSION}`);
  assert(body.provenance.engineType === "rules", `${label}: expected rules engine, got ${body.provenance?.engineType}`);
  assert(body.provenance.evidenceLevel === expected.evidenceLevel, `${label}: expected ${expected.evidenceLevel} evidence, got ${body.provenance.evidenceLevel}`);
  assert(body.provenance.validationStatus === expected.validationStatus, `${label}: expected ${expected.validationStatus} status, got ${body.provenance.validationStatus}`);
}

const property = {
  postalCode: "V5T 3K4",
  propertyType: "Townhouse",
  livingAreaSqft: 1320,
  bedrooms: 3,
  bathrooms: 2,
  yearBuilt: 1998,
};

const halifaxProperty = {
  postalCode: "B3H 1A1",
  propertyType: "Detached",
  livingAreaSqft: 1840,
  bedrooms: 3,
  bathrooms: 2,
  yearBuilt: 1988,
};

const checks = [
  ...(!apiOnly
    ? [{
        name: "web application",
        run: async () => {
          const result = await request("/");
          assert(result.status === 200, `web application: expected 200, got ${result.status}`);
          assert(result.contentType.includes("text/html"), "web application: expected HTML");
          assert(typeof result.body === "string" && result.body.includes("<div id=\"root\"></div>"), "web application: React root is missing");
          assertSecurityHeaders(result, "web application");
          return result;
        },
      }]
    : []),
  {
    name: "health contract",
    run: async () => {
      const result = await request("/api/health");
      assert(result.status === 200, `health contract: expected 200, got ${result.status}`);
      assert(result.body?.ok === true, "health contract: service is not healthy");
      assert(result.body?.mode === "public-interactive", `health contract: expected public-interactive, got ${result.body?.mode}`);
      assert(result.body?.contractVersion === CONTRACT_VERSION, `health contract: expected ${CONTRACT_VERSION}`);
      assertSecurityHeaders(result, "health contract");
      return result;
    },
  },
  {
    name: "estimate semantics",
    run: async () => {
      const result = await request("/api/estimate", { method: "POST", body: JSON.stringify(property) });
      assert(result.status === 200, `estimate semantics: expected 200, got ${result.status}`);
      assertProvenance(result.body, "estimate semantics");
      assert(result.body.modelFamily === "rules", "estimate semantics: public estimate must identify modelFamily=rules");
      assert(result.body.confidenceLow <= result.body.baseValue && result.body.baseValue <= result.body.confidenceHigh, "estimate semantics: range does not contain estimate");
      assert(result.body.uncertainty?.method === "error-ratio", "estimate semantics: public range must be labelled error-ratio");
      assert(result.body.uncertainty?.calibrationNote?.includes("no calibrated coverage claim"), "estimate semantics: uncalibrated range warning is missing");
      return result;
    },
  },
  {
    name: "two-market coverage",
    run: async () => {
      const [markets, evidence, estimate] = await Promise.all([
        request("/api/markets"),
        request("/api/evidence?market=halifax_maritimes&fsa=B3H&propertyType=Detached"),
        request("/api/estimate", { method: "POST", body: JSON.stringify(halifaxProperty) }),
      ]);
      assert(markets.status === 200, `two-market coverage: markets expected 200, got ${markets.status}`);
      const marketIds = markets.body?.markets?.map((market) => market.id) ?? [];
      assert(marketIds.includes("vancouver") && marketIds.includes("halifax_maritimes"), "two-market coverage: one or more supported markets are missing");
      assert(evidence.status === 200 && evidence.body?.status === "ready", "two-market coverage: Halifax evidence is unavailable");
      assert(evidence.body?.scope === "fsa-property-type" && evidence.body?.rows?.length > 0, "two-market coverage: Halifax FSA evidence is empty");
      assert(estimate.status === 200, `two-market coverage: Halifax estimate expected 200, got ${estimate.status}`);
      assertProvenance(estimate.body, "two-market coverage", { evidenceLevel: "mixed", validationStatus: "descriptive" });
      assert(estimate.body.market === "halifax_maritimes", `two-market coverage: wrong market ${estimate.body.market}`);
      return estimate;
    },
  },
  {
    name: "simulation semantics",
    run: async () => {
      const result = await request("/api/simulate", {
        method: "POST",
        body: JSON.stringify({ ...property, plannedFlags: ["renovatedKitchen"], horizonMonths: 10 }),
      });
      assert(result.status === 200, `simulation semantics: expected 200, got ${result.status}`);
      assertProvenance(result.body, "simulation semantics");
      assert(result.body.status === "ready", `simulation semantics: expected ready, got ${result.body.status}`);
      return result;
    },
  },
  {
    name: "plan semantics",
    run: async () => {
      const result = await request("/api/plan", {
        method: "POST",
        body: JSON.stringify({
          ...property,
          plannedFlags: ["renovatedKitchen"],
          targetPrice: 1_500_000,
          budget: 95_000,
          timelineMonths: 10,
        }),
      });
      assert(result.status === 200, `plan semantics: expected 200, got ${result.status}`);
      assertProvenance(result.body, "plan semantics");
      assert(result.body.status === "ready", `plan semantics: expected ready, got ${result.body.status}`);
      return result;
    },
  },
  {
    name: "deal decision semantics",
    run: async () => {
      const result = await request("/api/deal/analyze", {
        method: "POST",
        body: JSON.stringify({
          ...property,
          plannedFlags: ["renovatedKitchen"],
          askingPrice: 1_275_000,
          budget: 95_000,
          timelineMonths: 10,
        }),
      });
      assert(result.status === 200, `deal decision semantics: expected 200, got ${result.status}`);
      assertProvenance(result.body, "deal decision semantics");
      assert(["Worth review", "Needs caution", "Pass for now"].includes(result.body.dealLabel), "deal decision semantics: unsafe verdict vocabulary");
      assert(Number.isFinite(result.body.estimatedGrossUpside), "deal decision semantics: gross upside is missing");
      assert(Number.isFinite(result.body.estimatedNetUpside), "deal decision semantics: net upside is missing");
      assert(result.body.robustness?.method === "seeded-triangular-stress-test", "deal decision semantics: stress-test method is mislabeled");
      assert(Number.isFinite(result.body.robustness?.positiveUpsideShare), "deal decision semantics: scenario share is missing");
      assert(!("probabilityOfPositiveUpside" in (result.body.robustness ?? {})), "deal decision semantics: legacy probability wording remains");
      return result;
    },
  },
  {
    name: "no fabricated portfolio",
    run: async () => {
      const result = await request("/api/insights");
      assert(result.status === 409, `no fabricated portfolio: expected 409, got ${result.status}`);
      assert(typeof result.body?.message === "string" && result.body.message.includes("no server-side portfolio"), "no fabricated portfolio: truthful explanation is missing");
      return result;
    },
  },
  {
    name: "validation boundary",
    run: async () => {
      const result = await request("/api/estimate", {
        method: "POST",
        body: JSON.stringify({ ...property, livingAreaSqft: 0 }),
      });
      assert(result.status === 400, `validation boundary: expected 400, got ${result.status}`);
      assert(result.body?.message === "Request validation failed", "validation boundary: stable validation error is missing");
      assert(result.body?.issues?.some((issue) => issue.path === "livingAreaSqft"), "validation boundary: field-specific issue is missing");
      assertSecurityHeaders(result, "validation boundary");
      return result;
    },
  },
];

let failures = 0;
for (const check of checks) {
  try {
    const result = await check.run();
    console.log(`PASS ${check.name} (${result.status}, ${result.durationMs} ms)`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${check.name}: ${error.message}`);
  }
}

if (failures > 0) {
  console.error(`\nRelease gate failed: ${failures}/${checks.length} checks failed for ${baseUrl}`);
  process.exit(1);
}

console.log(`\nRelease gate passed: ${checks.length}/${checks.length} checks for ${baseUrl}`);
