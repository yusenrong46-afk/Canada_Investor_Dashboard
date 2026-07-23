import { lazy, Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { NavLink } from "react-router-dom";
import { detectMarket, marketCatalog, marketValues } from "@vvl/shared";

import { MarketEvidencePanel } from "../components/MarketEvidencePanel";
import { PropertyFormCard } from "../components/PropertyFormCard";
import { InlineAlert } from "../components/InlineAlert";
import { MetricCard } from "../components/MetricCard";
import { ProvenanceBadge } from "../components/ProvenanceBadge";
import { ResultSkeleton } from "../components/ResultSkeleton";
import { SectionCard } from "../components/SectionCard";
import { usePropertySession } from "../context/PropertySessionContext";
import { formatCurrency, formatPercent, formatSignedCurrency } from "../lib/format";
import { firstPropertyValidationMessage } from "../lib/propertyValidation";
import type { EstimateResponse } from "../types";

const MarketTrendCard = lazy(() => import("../components/MarketTrendCard").then((module) => ({ default: module.MarketTrendCard })));

// Vancouver trains on listing prices while Halifax trains on real sale prices, so the copy names the right basis.
function basisNounFor(market: string | undefined): "sales" | "listings" {
  const marketId = marketValues.find((value) => value === market);
  return marketId && marketCatalog[marketId].valuationBasis === "sale-price" ? "sales" : "listings";
}

function confidenceHintFor(estimate: EstimateResponse | null): string {
  const uncertainty = estimate?.uncertainty;
  if (uncertainty?.method === "conformal") {
    const interval = `${formatPercent((uncertainty.targetCoverage ?? 0.8) * 100, 0)} split-conformal interval`;
    return uncertainty.empiricalCoverage != null
      ? `${interval} - empirical coverage ${formatPercent(uncertainty.empiricalCoverage * 100, 0)} on held-out ${basisNounFor(estimate?.market)}`
      : interval;
  }
  if (uncertainty?.method === "error-ratio") {
    return "Heuristic error-ratio band (public/demo mode)";
  }
  return "A practical low-to-high range";
}

function CurrencyRangeValue({ low, high }: { low: number; high: number }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="whitespace-nowrap">{formatCurrency(low)}</span>
      <span className="text-sm font-semibold text-muted">to</span>
      <span className="whitespace-nowrap">{formatCurrency(high)}</span>
    </span>
  );
}

export function EstimatePage() {
  const {
    property,
    setProperty,
    estimate,
    estimateLoading: loading,
    estimateError: error,
    markets,
    propertyValidation,
    setPropertyFormValidation,
  } = usePropertySession();
  const anchorDelta =
    estimate && property.knownCurrentValue != null ? Math.round(estimate.anchorValue - estimate.baseValue) : null;

  const topDrivers = (estimate?.drivers ?? []).slice(0, 5);
  const maxDriverMagnitude = topDrivers.reduce((max, driver) => Math.max(max, Math.abs(driver.value)), 0);
  const detectedMarket = detectMarket(property.postalCode);
  const marketLabel = estimate?.marketLabel ?? (detectedMarket ? marketCatalog[detectedMarket].label : "supported market");
  const validationMessage = propertyValidation.valid ? null : firstPropertyValidationMessage(propertyValidation);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-3xl text-ink">What is this home worth today?</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted">
          Enter basic details to estimate the current {marketLabel} value.
        </p>
      </div>

      {validationMessage ? <InlineAlert>{`Fix the home details to update results. ${validationMessage}`}</InlineAlert> : null}

      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}

      <div className="grid gap-6 xl:grid-cols-[380px,minmax(0,1fr)]">
        <PropertyFormCard property={property} onChange={setProperty} markets={markets} onValidationChange={setPropertyFormValidation} sticky={false} />

        <div className="space-y-6">
          <section className="hero-panel" aria-live="polite" aria-atomic="true">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-3">
                <div className="eyebrow">Estimated current price</div>
                <div className="metric-num text-4xl leading-none sm:text-5xl">
                  {estimate ? formatCurrency(estimate.baseValue) : validationMessage ? "Paused" : "Loading"}
                </div>
                <p className="max-w-xl text-sm leading-6 text-muted">
                  {estimate
                    ? `Based on ${estimate.marketLabel} ${estimate.modelScope.toLowerCase()} ${basisNounFor(estimate.market)} near ${estimate.marketContext.localAreaLabel}.`
                    : validationMessage
                      ? "Fix the highlighted home details before the dashboard updates the estimate."
                    : `Calculating from ${marketLabel} market patterns.`}
                </p>
              </div>
              {loading && !validationMessage ? <span className="rounded-pill bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">Updating</span> : null}
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <MetricCard
                label="Confidence range"
                value={estimate ? <CurrencyRangeValue low={estimate.confidenceLow} high={estimate.confidenceHigh} /> : validationMessage ? "Fix inputs" : "Loading"}
                hint={validationMessage ? "Estimate paused until inputs are valid" : confidenceHintFor(estimate)}
              />
              <MetricCard
                label="Local median"
                value={estimate ? formatCurrency(estimate.marketContext.localMedianValue) : validationMessage ? "Fix inputs" : "Loading"}
                hint={validationMessage ? "Nearby market hidden while inputs need review" : estimate?.marketContext.localAreaLabel ?? "Nearby market"}
              />
              <MetricCard
                label="Your anchor"
                value={anchorDelta != null ? formatSignedCurrency(anchorDelta) : "—"}
                hint={anchorDelta != null ? "Compared with your own value" : "Optional — add a known value in the form to compare"}
              />
            </div>

            {estimate?.provenance ? <ProvenanceBadge provenance={estimate.provenance} /> : null}
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard title="Why this value?">
              <div className="space-y-3">
                {topDrivers.length ? (
                  topDrivers.map((driver) => (
                    <div key={driver.label} className="space-y-1.5 rounded-field bg-canvas px-4 py-3">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-sm font-medium text-ink">{driver.label}</span>
                        <span className={`text-sm font-semibold tabular-nums ${driver.value >= 0 ? "text-success" : "text-danger"}`}>
                          {formatSignedCurrency(driver.value)}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-pill bg-line/70">
                        <div
                          className={`h-full rounded-pill ${driver.value >= 0 ? "bg-brand-500" : "bg-danger"}`}
                          style={{ width: `${maxDriverMagnitude > 0 ? (Math.abs(driver.value) / maxDriverMagnitude) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  ))
                ) : loading && !estimate ? (
                  <ResultSkeleton rows={4} />
                ) : (
                  <div className="data-row text-sm text-muted">
                    {validationMessage ? "Fix the highlighted home details to update value drivers." : "Drivers will appear after the estimate loads."}
                  </div>
                )}
              </div>
            </SectionCard>

            <SectionCard title="Market check">
              {estimate ? (
                <div className="space-y-3">
                  <div className="data-row">
                    <span className="text-sm font-medium text-body">Price per sqft</span>
                    <span className="text-sm font-semibold tabular-nums text-ink">{formatCurrency(estimate.pricePerSqft)}</span>
                  </div>
                  <div className="data-row">
                    <span className="text-sm font-medium text-body">Comparable {basisNounFor(estimate.market)}</span>
                    <span className="text-sm font-semibold tabular-nums text-ink">{estimate.marketContext.comparableCount.toLocaleString()}</span>
                  </div>
                  <div className="data-row">
                    <span className="text-sm font-medium text-body">Practical ceiling</span>
                    <span className="text-sm font-semibold tabular-nums text-ink">{formatCurrency(estimate.marketContext.practicalCeiling)}</span>
                  </div>
                  <div className="data-row">
                    <span className="text-sm font-medium text-body">Current market index</span>
                    <span className="text-right text-sm font-semibold tabular-nums text-ink">
                      {estimate.marketFreshness?.status === "adjusted" && estimate.marketFreshness.multiplier != null
                        ? formatPercent((estimate.marketFreshness.multiplier - 1) * 100, 1)
                        : estimate.marketFreshness?.status === "embedded-in-target"
                          ? "Included in training target"
                          : "Not applied"}
                    </span>
                  </div>
                  <p className="text-sm leading-6 text-muted">
                    {estimate.marketFreshness?.message ??
                      "This is a listing-price model, so treat it as a planning estimate rather than an appraisal."}
                  </p>
                  {estimate.modelQuality.validationSummary.missingnessNotes.length ? (
                    <div className="rounded-field border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-warning">
                      <span className="font-bold">Data limit: </span>
                      {estimate.modelQuality.validationSummary.missingnessNotes[0]}
                    </div>
                  ) : null}
                </div>
              ) : loading && !estimate ? (
                <ResultSkeleton rows={3} />
              ) : (
                <div className="data-row text-sm text-muted">
                  {validationMessage ? "Fix the highlighted home details to load local market context." : "Loading local market context..."}
                </div>
              )}
            </SectionCard>
          </div>

          <MarketEvidencePanel property={property} estimate={estimate} market={detectedMarket} />

          <div className="flex justify-end">
            <NavLink to="/improve" className="btn-primary">
              Next: improve value
              <ArrowRight className="h-4 w-4" />
            </NavLink>
          </div>
        </div>
      </div>

      <Suspense fallback={null}>
        <MarketTrendCard market={estimate?.market ?? detectedMarket} />
      </Suspense>
    </div>
  );
}
