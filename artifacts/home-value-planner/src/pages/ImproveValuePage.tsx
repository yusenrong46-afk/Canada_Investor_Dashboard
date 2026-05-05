import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";

import { postImproveValue } from "../api/client";
import { ImprovementFlagPicker } from "../components/ImprovementFlagPicker";
import { MetricCard } from "../components/MetricCard";
import { SectionCard } from "../components/SectionCard";
import { formatCurrency } from "../lib/format";
import type { EstimateResponse, ImproveValueResponse, PlannedFlag, PropertyInput } from "../types";

interface ImproveValuePageProps {
  property: PropertyInput;
  estimate: EstimateResponse | null;
  plannedFlags: PlannedFlag[];
  onPlannedFlagsChange: (flags: PlannedFlag[]) => void;
}

export function ImproveValuePage({ property, estimate, plannedFlags, onPlannedFlagsChange }: ImproveValuePageProps) {
  const [result, setResult] = useState<ImproveValueResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    postImproveValue({
      ...property,
      plannedFlags,
      horizonMonths: 9,
    })
      .then((response) => {
        if (active) {
          setResult(response);
        }
      })
      .catch((caughtError: Error) => {
        if (active) {
          setError(caughtError.message);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [plannedFlags, property]);

  const drivers = result?.topUpliftDrivers ?? [];
  const hasResult = result?.status === "ready";

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-sound-600">2. Improve value</div>
        <h1 className="font-display text-3xl text-cedar">What can I do to improve value?</h1>
        <p className="max-w-2xl text-sm leading-6 text-slate-500">
          Pick realistic improvements and see the estimated value impact on top of the current price estimate.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{error}</div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[380px,minmax(0,1fr)]">
        <SectionCard
          title="Choose improvements"
          eyebrow="Your changes"
          description="Select the work you could realistically finish before selling."
        >
          <ImprovementFlagPicker plannedFlags={plannedFlags} onChange={onPlannedFlagsChange} />
        </SectionCard>

        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard label="Current as-is value" value={estimate ? formatCurrency(estimate.baseValue) : "Loading"} hint="From the live base model" />
            <MetricCard
              label="Added value"
              value={hasResult && result.upliftValue != null ? formatCurrency(result.upliftValue) : loading ? "Updating" : "Unavailable"}
              hint="Estimated value from selected work"
            />
            <MetricCard
              label="After improvements"
              value={
                hasResult && result.finalValueGuardrailed != null
                  ? formatCurrency(result.finalValueGuardrailed)
                  : loading
                    ? "Updating"
                    : "Unavailable"
              }
              hint="Capped by local market headroom"
            />
          </div>

          <SectionCard
            title="Highest-impact changes"
            eyebrow="Result"
            description="The list shows which selected improvements are doing the most work."
          >
            {hasResult ? (
              <div className="space-y-4">
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                  Renovation upside is rule-based, so use it for planning and compare it with real contractor quotes before acting.
                </p>
                <div className="grid gap-3">
                  {drivers.length ? (
                    drivers.map((driver) => (
                      <div key={driver.flag} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-sm font-semibold text-cedar">{driver.label}</div>
                            {driver.rationale ? <div className="mt-1 text-xs leading-5 text-slate-500">{driver.rationale}</div> : null}
                          </div>
                          <div className="text-sm font-semibold text-sound-700">{formatCurrency(driver.value)}</div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-500">Choose improvements to see value drivers.</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
                {result?.message ?? "Select improvements to estimate value impact."}
              </div>
            )}
          </SectionCard>

          <div className="flex justify-end">
            <NavLink
              to="/plan"
              className="inline-flex rounded-lg bg-cedar px-4 py-2 text-sm font-semibold text-white transition hover:bg-slateblue"
            >
              Next: make a plan
            </NavLink>
          </div>
        </div>
      </div>
    </div>
  );
}
