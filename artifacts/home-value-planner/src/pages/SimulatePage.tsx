import { useEffect, useState } from "react";

import { postSimulate } from "../api/client";
import { ImprovementFlagPicker } from "../components/ImprovementFlagPicker";
import { MetricCard } from "../components/MetricCard";
import { SectionCard } from "../components/SectionCard";
import { formatCurrency } from "../lib/format";
import type { EstimateResponse, PlannedFlag, PropertyInput, SimulateResponse } from "../types";

interface SimulatePageProps {
  property: PropertyInput;
  estimate: EstimateResponse | null;
  plannedFlags: PlannedFlag[];
  onPlannedFlagsChange: (flags: PlannedFlag[]) => void;
}

export function SimulatePage({ property, estimate, plannedFlags, onPlannedFlagsChange }: SimulatePageProps) {
  const [result, setResult] = useState<SimulateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    postSimulate({
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

  const evidenceWarning =
    result?.evidenceLevel === "rule-based"
      ? "This is a transparent rule-based estimate, not a trained causal uplift model. It uses published cost-recovery patterns, Vancouver feasibility rules, property type fit, timeline, and market-ceiling guardrails."
      : result?.evidenceLevel === "proxy-heavy"
      ? "This uplift number is mostly inferred from permit and assessment proxies, not a large matched set of observed resale outcomes."
      : result?.evidenceLevel === "hybrid"
        ? "This uplift number mixes observed resale evidence with proxy examples. Use it as a directional planning aid, not a guarantee."
        : null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-sound-600">Simulate</div>
        <h1 className="font-display text-3xl text-cedar">Test how renovation choices could change the sale value</h1>
        <p className="max-w-2xl text-sm leading-6 text-slate-500">
          This rule-based uplift engine estimates how much value selected changes could add on top of the current ML base estimate, then caps
          the result against local market headroom.
        </p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{error}</div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[380px,minmax(0,1fr)]">
        <SectionCard
          title="Choose improvements"
          eyebrow="Planner input"
          description="Select only the changes you realistically plan to finish before listing."
        >
          <ImprovementFlagPicker plannedFlags={plannedFlags} onChange={onPlannedFlagsChange} />
        </SectionCard>

        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard label="Current as-is value" value={estimate ? formatCurrency(estimate.baseValue) : "Loading"} hint="From the live base model" />
            <MetricCard
              label="Modeled uplift"
              value={result?.status === "ready" && result.upliftValue != null ? formatCurrency(result.upliftValue) : loading ? "Updating" : "Unavailable"}
              hint="Additional value attributed to the selected work"
            />
            <MetricCard
              label="Guardrailed final value"
              value={
                result?.status === "ready" && result.finalValueGuardrailed != null
                  ? formatCurrency(result.finalValueGuardrailed)
                  : loading
                    ? "Updating"
                    : "Unavailable"
              }
              hint="Capped against the local practical ceiling"
            />
          </div>

          <SectionCard
            title="Simulation result"
            eyebrow="Current scenario"
            description="The calculator shows both the raw uplift and the final number after local-market guardrails."
          >
            {result?.status === "ready" ? (
              <div className="space-y-5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-full bg-sound-50 px-3 py-1 text-xs font-semibold text-sound-700">
                      Evidence: {result.evidenceLevel}
                    </span>
                    {result.ceilingFlag ? (
                      <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">Ceiling guardrail applied</span>
                    ) : null}
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                      {result.modelFamily} uplift engine
                    </span>
                  </div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Uplift confidence range</div>
                      <div className="mt-2 text-lg font-semibold text-cedar">
                        {result.upliftConfidenceLow != null && result.upliftConfidenceHigh != null
                          ? `${formatCurrency(result.upliftConfidenceLow)} to ${formatCurrency(result.upliftConfidenceHigh)}`
                          : "Unavailable"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        {result.evidenceLevel === "rule-based" ? "Rule basis" : "Observed share"}
                      </div>
                      <div className="mt-2 text-lg font-semibold text-cedar">
                        {result.evidenceLevel === "rule-based"
                          ? `${result.rowCounts?.selectedRules ?? 0} selected rules`
                          : result.observedShare != null
                            ? `${(result.observedShare * 100).toFixed(1)}%`
                            : "Unavailable"}
                      </div>
                    </div>
                  </div>
                  {evidenceWarning ? (
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                      {evidenceWarning}
                    </div>
                  ) : null}
                </div>

                <div className="grid gap-3">
                  {(result.topUpliftDrivers ?? []).length ? (
                    result.topUpliftDrivers?.map((driver) => (
                      <div key={driver.flag} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <div>
                          <div className="text-sm font-semibold text-cedar">{driver.label}</div>
                          <div className="text-xs text-slate-500">
                            {driver.confidence ? `${driver.confidence} confidence · ` : ""}
                            {driver.flag}
                          </div>
                          {driver.rationale ? <div className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">{driver.rationale}</div> : null}
                        </div>
                        <div className="text-sm font-semibold text-sound-700">{formatCurrency(driver.value)}</div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
                      Add at least one improvement to see the strongest uplift contributors.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
                {result?.message ?? "Select improvements to run the rule-based uplift calculator."}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
