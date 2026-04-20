import { useEffect, useState } from "react";

import { postPlan } from "../api/client";
import { ImprovementFlagPicker } from "../components/ImprovementFlagPicker";
import { MetricCard } from "../components/MetricCard";
import { SectionCard } from "../components/SectionCard";
import { StatusPill } from "../components/StatusPill";
import { formatCurrency, formatPercent, formatSignedCurrency } from "../lib/format";
import type { EstimateResponse, PlanResponse, PlannedFlag, PropertyInput } from "../types";

interface PlanPageProps {
  property: PropertyInput;
  estimate: EstimateResponse | null;
  plannedFlags: PlannedFlag[];
  onPlannedFlagsChange: (flags: PlannedFlag[]) => void;
}

export function PlanPage({ property, estimate, plannedFlags, onPlannedFlagsChange }: PlanPageProps) {
  const [targetPrice, setTargetPrice] = useState<number>(Math.max(1_400_000, estimate?.baseValue ?? 1_400_000));
  const [budget, setBudget] = useState<number>(120_000);
  const [timelineMonths, setTimelineMonths] = useState<number>(9);
  const [result, setResult] = useState<PlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (estimate?.baseValue) {
      setTargetPrice(Math.max(estimate.baseValue + 100_000, targetPrice));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimate?.baseValue]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    postPlan({
      ...property,
      plannedFlags,
      targetPrice,
      budget,
      timelineMonths,
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
  }, [budget, plannedFlags, property, targetPrice, timelineMonths]);

  const evidenceWarning =
    result?.evidenceLevel === "rule-based"
      ? "This plan is produced by a transparent rule-based uplift engine, not a trained causal renovation model. Use it to prioritize scenarios, then verify costs and permits before acting."
      : result?.evidenceLevel === "proxy-heavy"
      ? "This plan is mostly inferred from permit and assessment proxies, not a large set of observed Vancouver flip resales."
      : result?.evidenceLevel === "hybrid"
        ? "This plan mixes observed resale examples with proxy evidence, so treat the ranking as directional rather than guaranteed."
        : null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-sound-600">Plan</div>
        <h1 className="font-display text-3xl text-cedar">Build a sale plan that aims for the highest realistic value</h1>
        <p className="max-w-2xl text-sm leading-6 text-slate-500">
          The planner ranks candidate upgrades using rule-based uplift, cost, timeline, property-type fit, and local market headroom, then groups
          the selected actions into simple phases.
        </p>
      </div>

      {error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{error}</div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[400px,minmax(0,1fr)]">
        <SectionCard
          title="Planner inputs"
          eyebrow="Your goal"
          description="Set the target, budget, and timeline, then keep any upgrades you already know you want."
        >
          <div className="grid gap-4">
            <label className="space-y-2">
              <span className="label">Target sale price</span>
              <input className="field" type="number" min={100000} value={targetPrice} onChange={(event) => setTargetPrice(Number(event.target.value))} />
            </label>
            <label className="space-y-2">
              <span className="label">Budget</span>
              <input className="field" type="number" min={0} value={budget} onChange={(event) => setBudget(Number(event.target.value))} />
            </label>
            <label className="space-y-2">
              <span className="label">Timeline (months)</span>
              <input className="field" type="number" min={3} max={18} value={timelineMonths} onChange={(event) => setTimelineMonths(Number(event.target.value))} />
            </label>
          </div>

          <div className="mt-6">
            <div className="mb-3 text-[11px] font-extrabold uppercase tracking-[0.18em] text-sound-600">Already committed</div>
            <ImprovementFlagPicker plannedFlags={plannedFlags} onChange={onPlannedFlagsChange} />
          </div>
        </SectionCard>

        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            <MetricCard label="Current as-is value" value={estimate ? formatCurrency(estimate.baseValue) : "Loading"} hint="The starting point" />
            <MetricCard
              label="Achievable value"
              value={result?.status === "ready" && result.achievableValue != null ? formatCurrency(result.achievableValue) : loading ? "Updating" : "Unavailable"}
              hint="After the selected plan and guardrails"
            />
            <MetricCard
              label="Gap to target"
              value={result?.status === "ready" && result.gapToTarget != null ? formatSignedCurrency(-result.gapToTarget) : loading ? "Updating" : "Unavailable"}
              hint="Positive means the modeled plan reaches or beats the target"
            />
            <MetricCard
              label="Planned spend"
              value={result?.status === "ready" && result.plannedSpend != null ? formatCurrency(result.plannedSpend) : loading ? "Updating" : "Unavailable"}
              hint="Sum of the recommended actions"
            />
          </div>

          <SectionCard
            title="Recommended plan"
            eyebrow="Ranked actions"
            description="The planner defaults to maximizing the final sale value while respecting your budget and timeline."
          >
            {result?.status === "ready" ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    {result.targetAssessment ? <StatusPill value={result.targetAssessment} /> : null}
                    <span className="rounded-full bg-sound-50 px-3 py-1 text-xs font-semibold text-sound-700">
                      Evidence: {result.evidenceLevel}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                      {result.plannedMonths ?? 0} months
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    This plan aims for {result.achievableValue != null ? formatCurrency(result.achievableValue) : "an achievable value"} against a target of{" "}
                    {result.targetPrice != null ? formatCurrency(result.targetPrice) : "your target"}.
                  </p>
                  {evidenceWarning ? (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                      {evidenceWarning}
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3">
                  {(result.items ?? []).length ? (
                    result.items?.map((item) => (
                      <div key={item.flag} className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-cedar">{item.label}</div>
                            <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">{item.phase}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-semibold text-sound-700">{formatCurrency(item.projectedUplift)}</div>
                            <div className="mt-1 text-xs text-slate-500">{formatPercent(item.valueRecoveryRate * 100, 0)} value recovery</div>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-600">
                          <span>Cost: {formatCurrency(item.cost)}</span>
                          <span>Time: {item.months} months</span>
                          <span>Projected final value: {formatCurrency(item.projectedFinalValue)}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
                      No positive-value plan fit inside the current budget and timeline.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
                {result?.message ?? "Enter a target, budget, and timeline to run the rule-based planner."}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
