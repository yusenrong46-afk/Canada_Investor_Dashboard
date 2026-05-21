import { NavLink } from "react-router-dom";

import { PropertyFormCard } from "../components/PropertyFormCard";
import { MetricCard } from "../components/MetricCard";
import { SectionCard } from "../components/SectionCard";
import { formatCurrency, formatPercent, formatSignedCurrency } from "../lib/format";
import type { EstimateResponse, PropertyInput } from "../types";

interface EstimatePageProps {
  property: PropertyInput;
  estimate: EstimateResponse | null;
  onPropertyChange: (property: PropertyInput) => void;
  loading: boolean;
}

export function EstimatePage({ property, estimate, onPropertyChange, loading }: EstimatePageProps) {
  const anchorDelta =
    estimate && property.knownCurrentValue != null ? Math.round(estimate.anchorValue - estimate.baseValue) : null;

  const topDrivers = (estimate?.drivers ?? []).slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-sound-600">1. Estimate current price</div>
        <h1 className="font-display text-3xl text-cedar">What is this home worth today?</h1>
        <p className="max-w-2xl text-sm leading-6 text-slate-500">
          Enter the basic listing details and the app will estimate the current Vancouver list value.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[380px,minmax(0,1fr)]">
        <PropertyFormCard property={property} onChange={onPropertyChange} />

        <div className="space-y-6">
          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-soft">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-3">
                <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-sound-600">Estimated current price</div>
                <div className="font-display text-5xl leading-none text-cedar">
                  {estimate ? formatCurrency(estimate.baseValue) : "Loading"}
                </div>
                <p className="max-w-xl text-sm leading-6 text-slate-500">
                  {estimate
                    ? `Based on Vancouver ${estimate.modelScope.toLowerCase()} listings near ${estimate.marketContext.localAreaLabel}.`
                    : "Calculating from Vancouver listing patterns."}
                </p>
              </div>
              {loading ? <span className="rounded-lg bg-sound-50 px-3 py-1 text-xs font-semibold text-sound-700">Updating</span> : null}
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <MetricCard
                label="Confidence range"
                value={estimate ? `${formatCurrency(estimate.confidenceLow)} to ${formatCurrency(estimate.confidenceHigh)}` : "Loading"}
                hint="A practical low-to-high range"
              />
              <MetricCard
                label="Local median"
                value={estimate ? formatCurrency(estimate.marketContext.localMedianValue) : "Loading"}
                hint={estimate?.marketContext.localAreaLabel ?? "Nearby market"}
              />
              <MetricCard
                label="Your anchor"
                value={anchorDelta != null ? formatSignedCurrency(anchorDelta) : "Optional"}
                hint={anchorDelta != null ? "Compared with your own value" : "Add known value in the form"}
              />
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard
              title="Why this value?"
              eyebrow="Main drivers"
              description="These are the strongest signals pushing the estimate up or down."
            >
              <div className="space-y-3">
                {topDrivers.length ? (
                  topDrivers.map((driver) => (
                    <div key={driver.label} className="flex items-center justify-between gap-4 rounded-lg bg-slate-50 px-4 py-3">
                      <span className="text-sm font-medium text-slate-700">{driver.label}</span>
                      <span className={`text-sm font-semibold ${driver.value >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                        {formatSignedCurrency(driver.value)}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-500">Drivers will appear after the estimate loads.</div>
                )}
              </div>
            </SectionCard>

            <SectionCard
              title="Market check"
              eyebrow="Nearby context"
              description="A small sanity check against the local market."
            >
              {estimate ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
                    <span className="text-sm font-medium text-slate-600">Price per sqft</span>
                    <span className="text-sm font-semibold text-cedar">{formatCurrency(estimate.pricePerSqft)}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
                    <span className="text-sm font-medium text-slate-600">Comparable listings</span>
                    <span className="text-sm font-semibold text-cedar">{estimate.marketContext.comparableCount.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
                    <span className="text-sm font-medium text-slate-600">Practical ceiling</span>
                    <span className="text-sm font-semibold text-cedar">{formatCurrency(estimate.marketContext.practicalCeiling)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4 rounded-lg bg-slate-50 px-4 py-3">
                    <span className="text-sm font-medium text-slate-600">Current market index</span>
                    <span className="text-right text-sm font-semibold text-cedar">
                      {estimate.marketFreshness?.status === "adjusted" && estimate.marketFreshness.multiplier != null
                        ? formatPercent((estimate.marketFreshness.multiplier - 1) * 100, 1)
                        : "Not applied"}
                    </span>
                  </div>
                  <p className="text-sm leading-6 text-slate-500">
                    {estimate.marketFreshness?.message ??
                      "This is a listing-price model, so treat it as a planning estimate rather than an appraisal."}
                  </p>
                </div>
              ) : (
                <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-500">Loading local market context...</div>
              )}
            </SectionCard>
          </div>

          <div className="flex justify-end">
            <NavLink
              to="/improve"
              className="inline-flex rounded-lg bg-cedar px-4 py-2 text-sm font-semibold text-white transition hover:bg-slateblue"
            >
              Next: improve value
            </NavLink>
          </div>
        </div>
      </div>
    </div>
  );
}
