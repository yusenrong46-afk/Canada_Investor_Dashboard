import { useEffect, useState } from "react";
import { Bookmark } from "lucide-react";

import { postPlan } from "../api/client";
import { ImprovementFlagPicker } from "../components/ImprovementFlagPicker";
import { MetricCard } from "../components/MetricCard";
import { SectionCard } from "../components/SectionCard";
import { StatusPill } from "../components/StatusPill";
import { formatCurrency, formatPercent, formatSignedCurrency } from "../lib/format";
import { createPlanScenario, type PlanInputState, type ScenarioRecord } from "../lib/scenarios";
import type { EstimateResponse, PlanResponse, PlannedFlag, PropertyInput } from "../types";

interface PlanPageProps {
  property: PropertyInput;
  estimate: EstimateResponse | null;
  plannedFlags: PlannedFlag[];
  onPlannedFlagsChange: (flags: PlannedFlag[]) => void;
  onSaveScenario?: (scenario: ScenarioRecord) => void;
  planInputs: PlanInputState;
  onPlanInputsChange: (inputs: PlanInputState) => void;
}

const dataSourceLabels: Record<string, string> = {
  seattlePermits: "Seattle building permits",
  kingCountySales: "King County sales",
  kingCountyResidentialBuildings: "King County residential buildings",
};

function shortDataPath(path: string): string {
  const marker = "/data/raw/";
  const markerIndex = path.indexOf(marker);
  return markerIndex >= 0 ? `data/raw/${path.slice(markerIndex + marker.length)}` : path;
}

function updateNumberDraft(
  value: string,
  setDraft: (value: string) => void,
  setNumber: (value: number) => void,
  min: number,
  max?: number,
) {
  setDraft(value);

  if (value.trim() === "") {
    return;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return;
  }

  if (parsed < min || (max != null && parsed > max)) {
    return;
  }

  setNumber(parsed);
}

export function PlanPage({ property, estimate, plannedFlags, onPlannedFlagsChange, onSaveScenario, planInputs, onPlanInputsChange }: PlanPageProps) {
  const { targetPrice, budget, timelineMonths } = planInputs;
  const [targetPriceDraft, setTargetPriceDraft] = useState(String(planInputs.targetPrice));
  const [budgetDraft, setBudgetDraft] = useState(String(planInputs.budget));
  const [timelineDraft, setTimelineDraft] = useState(String(planInputs.timelineMonths));
  const [result, setResult] = useState<PlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    setTargetPriceDraft(String(targetPrice));
  }, [targetPrice]);

  useEffect(() => {
    setBudgetDraft(String(budget));
  }, [budget]);

  useEffect(() => {
    setTimelineDraft(String(timelineMonths));
  }, [timelineMonths]);

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

  useEffect(() => {
    setSavedMessage(null);
  }, [budget, plannedFlags, property, targetPrice, timelineMonths]);

  const dataMissing = result?.status === "data-missing";
  const dataSources = Object.entries(result?.dataSources ?? {});
  const canSaveScenario = Boolean(onSaveScenario && estimate && result?.status === "ready");
  const gapTone: "success" | "danger" | "neutral" =
    result?.status === "ready" && result.gapToTarget != null ? (result.gapToTarget <= 0 ? "success" : "danger") : "neutral";

  function handleSaveScenario() {
    if (!onSaveScenario || !estimate || result?.status !== "ready") {
      return;
    }

    onSaveScenario(
      createPlanScenario({
        property,
        plannedFlags,
        estimate,
        plan: result,
        targetPrice,
        budget,
        timelineMonths,
      }),
    );
    setSavedMessage("Saved to Scenario Workspace");
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="eyebrow">3. Plan</div>
        <h1 className="font-display text-3xl text-ink">What should I do next?</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted">
          Set your target, budget, and timeline. The planner recommends the most useful next actions.
        </p>
      </div>

      {error ? (
        <div className="rounded-card border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">{error}</div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[400px,minmax(0,1fr)]">
        <SectionCard
          title="Plan inputs"
          eyebrow="Your goal"
          description="Keep this simple: target price, budget, timeline, and any must-do improvements."
        >
          <div className="grid gap-4">
            <label className="space-y-2">
              <span className="label">Target sale price</span>
              <input
                className="field"
                type="number"
                min={100000}
                value={targetPriceDraft}
                onChange={(event) =>
                  updateNumberDraft(
                    event.target.value,
                    setTargetPriceDraft,
                    (nextValue) => onPlanInputsChange({ ...planInputs, targetPrice: nextValue }),
                    100_000,
                  )
                }
                onBlur={() => setTargetPriceDraft(String(targetPrice))}
              />
            </label>
            <label className="space-y-2">
              <span className="label">Budget</span>
              <input
                className="field"
                type="number"
                min={1}
                value={budgetDraft}
                onChange={(event) =>
                  updateNumberDraft(event.target.value, setBudgetDraft, (nextValue) => onPlanInputsChange({ ...planInputs, budget: nextValue }), 1)
                }
                onBlur={() => setBudgetDraft(String(budget))}
              />
            </label>
            <label className="space-y-2">
              <span className="label">Timeline (months)</span>
              <input
                className="field"
                type="number"
                min={3}
                max={18}
                value={timelineDraft}
                onChange={(event) =>
                  updateNumberDraft(
                    event.target.value,
                    setTimelineDraft,
                    (nextValue) => onPlanInputsChange({ ...planInputs, timelineMonths: nextValue }),
                    3,
                    18,
                  )
                }
                onBlur={() => setTimelineDraft(String(timelineMonths))}
              />
            </label>
          </div>

          <div className="mt-6">
            <div className="eyebrow mb-3">Already committed</div>
            <ImprovementFlagPicker plannedFlags={plannedFlags} onChange={onPlannedFlagsChange} />
          </div>
        </SectionCard>

        <div className="space-y-6">
          <MetricCard
            variant="hero"
            label="Achievable value"
            value={result?.status === "ready" && result.achievableValue != null ? formatCurrency(result.achievableValue) : loading ? "Updating" : dataMissing ? "Data needed" : "Set goal"}
            hint={dataMissing ? "Waiting for real uplift CSVs" : "After the selected plan and local market guardrails"}
          />

          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard label="Current as-is value" value={estimate ? formatCurrency(estimate.baseValue) : "Loading"} hint="The starting point" />
            <MetricCard
              label="Gap to target"
              tone={gapTone}
              value={result?.status === "ready" && result.gapToTarget != null ? formatSignedCurrency(-result.gapToTarget) : loading ? "Updating" : dataMissing ? "Pending data" : "Set goal"}
              hint={dataMissing ? "No fake plan value is shown" : "Positive means the modeled plan reaches or beats the target"}
            />
            <MetricCard
              label="Planned spend"
              value={result?.status === "ready" && result.plannedSpend != null ? formatCurrency(result.plannedSpend) : loading ? "Updating" : dataMissing ? "Pending data" : "Set goal"}
              hint={dataMissing ? "Plan waits for observed uplift data" : "Sum of the recommended actions"}
            />
          </div>

          <SectionCard
            title="Recommended next steps"
            eyebrow="Action list"
            description="These are the improvements that fit your budget and timeline best."
            aside={
              <button type="button" disabled={!canSaveScenario} onClick={handleSaveScenario} className="btn-ghost">
                <Bookmark className="h-4 w-4" />
                Save scenario
              </button>
            }
          >
            {savedMessage ? (
              <div className="mb-4 rounded-field border border-success/30 bg-success/10 px-4 py-3 text-sm font-semibold text-success">
                {savedMessage}
              </div>
            ) : null}

            {result?.status === "ready" ? (
              <div className="space-y-4">
                <div className="rounded-field border border-line bg-canvas p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    {result.targetAssessment ? <StatusPill value={result.targetAssessment} /> : null}
                    <span className="rounded-pill bg-surface px-3 py-1 text-xs font-semibold text-body ring-1 ring-line">
                      {result.plannedMonths ?? 0} months
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-body">
                    This plan aims for {result.achievableValue != null ? formatCurrency(result.achievableValue) : "an achievable value"} against a target of{" "}
                    {result.targetPrice != null ? formatCurrency(result.targetPrice) : "your target"}.
                  </p>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    {result.methodNotes?.[0] ??
                      "The planner estimates renovation upside, applies local market guardrails, and keeps the plan inside your budget and timeline."}
                  </p>
                </div>

                <div className="space-y-3">
                  {(result.items ?? []).length ? (
                    result.items?.map((item, index) => (
                      <div key={item.flag} className="rounded-field border border-line bg-surface p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-pill bg-brand-50 text-xs font-extrabold text-brand-700 ring-1 ring-brand-200">
                              {index + 1}
                            </span>
                            <div>
                              <div className="text-sm font-semibold text-ink">{item.label}</div>
                              <div className="mt-1 text-xs uppercase tracking-[0.16em] text-muted">{item.phase}</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-semibold tabular-nums text-success">{formatCurrency(item.projectedUplift)}</div>
                            {item.projectedUpliftPercent != null ? (
                              <div className="mt-1 text-xs text-muted">{formatPercent(item.projectedUpliftPercent * 100)} uplift</div>
                            ) : null}
                            <div className="mt-1 text-xs text-muted">{formatPercent(item.valueRecoveryRate * 100, 0)} value recovery</div>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-4 text-sm text-body">
                          <span>Cost: {formatCurrency(item.cost)}</span>
                          <span>Time: {item.months} months</span>
                          <span>Projected final value: {formatCurrency(item.projectedFinalValue)}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="data-row text-sm text-muted">
                      No positive-value plan fit inside the current budget and timeline.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-field border border-warning/30 bg-warning/10 p-4 text-sm leading-6 text-body">
                  <div className="font-semibold text-ink">{dataMissing ? "Plan recommendations need real uplift data." : "Enter a target, budget, and timeline."}</div>
                  <p className="mt-2">{result?.message ?? "Enter a target, budget, and timeline to run the Seattle observed uplift planner."}</p>
                </div>

                {dataMissing ? (
                  <div className="rounded-field border border-line bg-surface p-4">
                    <div className="text-sm font-semibold text-ink">Files needed for recommendations</div>
                    <p className="mt-2 text-sm leading-6 text-muted">
                      The plan chooses actions by estimated observed uplift. Until the real local CSVs exist, the app will not guess.
                    </p>
                    <div className="mt-4 space-y-2">
                      {dataSources.map(([key, path]) => (
                        <div key={key} className="rounded-field bg-canvas px-3 py-2">
                          <div className="text-sm font-medium text-ink">{dataSourceLabels[key] ?? key}</div>
                          <div className="mt-1 font-mono text-xs text-muted">{shortDataPath(path)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
