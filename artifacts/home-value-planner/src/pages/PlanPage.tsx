import { useCallback, useEffect, useState } from "react";
import { Bookmark } from "lucide-react";
import { NavLink } from "react-router-dom";
import { improvementCatalog } from "@vvl/shared";

import { postPlan } from "../api/client";
import { CostVsValueNote } from "../components/CostVsValueNote";
import { HalifaxUpliftCaveat } from "../components/HalifaxUpliftCaveat";
import { InlineAlert } from "../components/InlineAlert";
import { MetricCard } from "../components/MetricCard";
import { ProvenanceBadge } from "../components/ProvenanceBadge";
import { ResultSkeleton } from "../components/ResultSkeleton";
import { SectionCard } from "../components/SectionCard";
import { StatusPill } from "../components/StatusPill";
import { usePropertySession } from "../context/PropertySessionContext";
import { dataSourceLabels, shortDataPath } from "../lib/dataSources";
import { formatCurrency, formatPercent, formatSignedCurrency } from "../lib/format";
import { updateNumberDraft } from "../lib/numberDraft";
import { firstPropertyValidationMessage } from "../lib/propertyValidation";
import { targetPriceLabel, upliftUnavailableMessage } from "../lib/marketLabels";
import { buildRequestKey } from "../lib/requestKey";
import { createPlanScenario } from "../lib/scenarios";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { useLatestRequest } from "../lib/useLatestRequest";
import type { PlanResponse } from "../types";

export function PlanPage() {
  const {
    property,
    estimate,
    plannedFlags,
    saveScenario,
    planInputs,
    setPlanInputs,
    propertyValidation,
  } = usePropertySession();
  const debouncedProperty = useDebouncedValue(property, 400);
  const debouncedFlags = useDebouncedValue(plannedFlags, 400);
  const debouncedPlanInputs = useDebouncedValue(planInputs, 400);
  const { targetPrice, budget, timelineMonths } = planInputs;
  const [targetPriceDraft, setTargetPriceDraft] = useState(String(planInputs.targetPrice));
  const [budgetDraft, setBudgetDraft] = useState(String(planInputs.budget));
  const [timelineDraft, setTimelineDraft] = useState(String(planInputs.timelineMonths));
  const [targetPriceError, setTargetPriceError] = useState<string | null>(null);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const visibleKey = buildRequestKey({
    property,
    plannedFlags,
    targetPrice,
    budget,
    timelineMonths,
  });
  const fetchKey = buildRequestKey({
    property: debouncedProperty,
    plannedFlags: debouncedFlags,
    targetPrice: debouncedPlanInputs.targetPrice,
    budget: debouncedPlanInputs.budget,
    timelineMonths: debouncedPlanInputs.timelineMonths,
  });

  const fetchPlan = useCallback(
    (signal: AbortSignal) =>
      postPlan(
        {
          ...debouncedProperty,
          plannedFlags: debouncedFlags,
          targetPrice: debouncedPlanInputs.targetPrice,
          budget: debouncedPlanInputs.budget,
          timelineMonths: debouncedPlanInputs.timelineMonths,
        },
        signal,
      ),
    [debouncedFlags, debouncedPlanInputs, debouncedProperty],
  );

  const {
    data: freshResult,
    loading,
    error,
    isFresh,
    isDebouncing,
  } = useLatestRequest<PlanResponse>(visibleKey, fetchKey, propertyValidation.valid, fetchPlan);

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
    setSavedMessage(null);
  }, [budget, plannedFlags, property, propertyValidation.valid, targetPrice, timelineMonths]);

  const dataMissing = freshResult?.status === "data-missing";
  const dataSources = Object.entries(freshResult?.dataSources ?? {});
  const asIsValue = freshResult?.baseValue ?? estimate?.baseValue;
  const hasInputErrors = Boolean(targetPriceError || budgetError || timelineError);
  const canSaveScenario = Boolean(
    isFresh &&
      !loading &&
      !isDebouncing &&
      !hasInputErrors &&
      propertyValidation.valid &&
      freshResult?.status === "ready" &&
      asIsValue != null,
  );
  const validationMessage = propertyValidation.valid ? null : firstPropertyValidationMessage(propertyValidation);
  const gapTone: "success" | "danger" | "neutral" =
    freshResult?.status === "ready" && freshResult.gapToTarget != null ? (freshResult.gapToTarget <= 0 ? "success" : "danger") : "neutral";
  const planUplift =
    freshResult?.status === "ready" && freshResult.achievableValue != null && asIsValue != null
      ? Math.max(0, freshResult.achievableValue - asIsValue)
      : null;

  function handleSaveScenario() {
    if (!canSaveScenario || freshResult?.status !== "ready" || asIsValue == null) {
      return;
    }

    saveScenario(
      createPlanScenario({
        property,
        plannedFlags,
        estimate,
        plan: freshResult,
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
        <h1 className="font-display text-3xl text-ink">What should I do next?</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted">
          Set target, budget, and timeline. Committed improvements come from Improve.
        </p>
      </div>

      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}

      {validationMessage ? (
        <InlineAlert>{`Fix the home details on Estimate or Deal before building a plan. ${validationMessage}`}</InlineAlert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[400px,minmax(0,1fr)]">
        <SectionCard title="Plan inputs">
          <div className="grid gap-4">
            <label className="space-y-2">
              <span className="label">{targetPriceLabel(property)}</span>
              <input
                className="field"
                type="number"
                min={100000}
                value={targetPriceDraft}
                onChange={(event) =>
                  setTargetPriceError(
                    updateNumberDraft(
                      event.target.value,
                      setTargetPriceDraft,
                      (nextValue) => setPlanInputs({ ...planInputs, targetPrice: nextValue }),
                      100_000,
                    ),
                  )
                }
                onBlur={() => setTargetPriceDraft(String(targetPrice))}
              />
              {targetPriceError ? (
                <p className="text-xs text-danger">{targetPriceError}</p>
              ) : (
                <p className="text-xs tabular-nums text-muted">= {formatCurrency(targetPrice)}</p>
              )}
            </label>
            <label className="space-y-2">
              <span className="label">Budget</span>
              <input
                className="field"
                type="number"
                min={1}
                value={budgetDraft}
                onChange={(event) =>
                  setBudgetError(
                    updateNumberDraft(event.target.value, setBudgetDraft, (nextValue) => setPlanInputs({ ...planInputs, budget: nextValue }), 1),
                  )
                }
                onBlur={() => setBudgetDraft(String(budget))}
              />
              {budgetError ? (
                <p className="text-xs text-danger">{budgetError}</p>
              ) : (
                <p className="text-xs tabular-nums text-muted">= {formatCurrency(budget)}</p>
              )}
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
                  setTimelineError(
                    updateNumberDraft(
                      event.target.value,
                      setTimelineDraft,
                      (nextValue) => setPlanInputs({ ...planInputs, timelineMonths: nextValue }),
                      3,
                      18,
                    ),
                  )
                }
                onBlur={() => setTimelineDraft(String(timelineMonths))}
              />
              {timelineError ? <p className="text-xs text-danger">{timelineError}</p> : null}
            </label>
          </div>

          <div className="mt-6 space-y-2">
            <div className="label">Committed from Improve</div>
            {plannedFlags.length ? (
              <div className="flex flex-wrap gap-2">
                {plannedFlags.map((flag) => (
                  <span key={flag} className="rounded-field bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 ring-1 ring-brand-200">
                    {improvementCatalog[flag].label}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">No improvements selected yet.</p>
            )}
            <NavLink to="/improve" className="text-sm font-semibold text-brand-700 hover:text-brand-600">
              Edit improvements on Improve →
            </NavLink>
          </div>
        </SectionCard>

        <div className="space-y-6">
          <MetricCard
            variant="hero"
            label="Achievable value"
            value={
              freshResult?.status === "ready" && freshResult.achievableValue != null
                ? formatCurrency(freshResult.achievableValue)
                : validationMessage
                  ? "Fix inputs"
                  : loading
                    ? "Updating"
                    : dataMissing
                      ? "Data needed"
                      : "Set goal"
            }
            hint={validationMessage ? "Plan results are paused until home details are valid" : dataMissing ? upliftUnavailableMessage() : "After the selected plan and local market guardrails"}
          />

          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard label="Current as-is value" value={asIsValue != null ? formatCurrency(asIsValue) : validationMessage ? "Fix inputs" : loading ? "Updating" : "Loading"} hint="The starting point" />
            <MetricCard
              label="Gap to target"
              tone={gapTone}
              value={
                freshResult?.status === "ready" && freshResult.gapToTarget != null
                  ? formatSignedCurrency(-freshResult.gapToTarget)
                  : validationMessage
                    ? "Fix inputs"
                    : loading
                      ? "Updating"
                      : dataMissing
                        ? "Pending data"
                        : "Set goal"
              }
              hint={dataMissing ? "No fake plan value is shown" : "Positive means the modeled plan reaches or beats the target"}
            />
            <MetricCard
              label="Planned spend"
              value={
                freshResult?.status === "ready" && freshResult.plannedSpend != null
                  ? formatCurrency(freshResult.plannedSpend)
                  : validationMessage
                    ? "Fix inputs"
                    : loading
                      ? "Updating"
                      : dataMissing
                        ? "Pending data"
                        : "Set goal"
              }
              hint={dataMissing ? "Plan waits for observed uplift data" : "Committed plus recommended work"}
            />
          </div>

          <SectionCard
            title="Plan scope and next steps"
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

            {freshResult?.status === "ready" && freshResult.provenance ? (
              <ProvenanceBadge provenance={freshResult.provenance} />
            ) : null}

            {freshResult?.status === "ready" ? (
              <div className="space-y-4">
                {estimate?.market === "halifax_maritimes" ? <HalifaxUpliftCaveat variant="plan" /> : null}
                {planUplift != null ? (
                  <CostVsValueNote
                    plannedFlags={freshResult?.items?.map((item) => item.flag) ?? debouncedFlags}
                    upliftValue={planUplift}
                    market={estimate?.market}
                    nonAdditiveUplift={estimate?.market === "halifax_maritimes"}
                  />
                ) : null}
                {(freshResult?.items ?? []).some((item) => item.valueRecoveryRate < 1) ? (
                  <InlineAlert>
                    One or more plan items show modeled uplift below assumed cost. That is a common screening outcome, not a calculation error.
                  </InlineAlert>
                ) : null}
                <div className="rounded-field border border-line bg-canvas p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    {freshResult.targetAssessment ? <StatusPill value={freshResult.targetAssessment} /> : null}
                    <span className="rounded-pill bg-surface px-3 py-1 text-xs font-semibold text-body ring-1 ring-line">
                      {freshResult.plannedMonths ?? 0} months
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-body">
                    This plan aims for {freshResult.achievableValue != null ? formatCurrency(freshResult.achievableValue) : "an achievable value"} against a target of{" "}
                    {freshResult.targetPrice != null ? formatCurrency(freshResult.targetPrice) : "your target"}.
                  </p>
                  <p className="mt-2 text-sm leading-6 text-muted">
                    {freshResult.methodNotes?.[0] ??
                      "The planner estimates renovation upside, applies local market guardrails, and keeps the plan inside your budget and timeline."}
                  </p>
                </div>

                <div className="space-y-3">
                  {(freshResult.items ?? []).length ? (
                    freshResult.items?.map((item, index) => (
                      <div key={item.flag} className="rounded-field border border-line bg-surface p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-pill bg-brand-50 text-xs font-extrabold text-brand-700 ring-1 ring-brand-200">
                              {index + 1}
                            </span>
                            <div>
                              <div className="text-sm font-semibold text-ink">{item.label}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted">
                                <span>{item.phase}</span>
                                {item.origin ? (
                                  <span className="rounded-pill bg-canvas px-2 py-0.5 text-[10px] font-bold tracking-[0.12em] ring-1 ring-line">
                                    {item.origin}
                                  </span>
                                ) : null}
                              </div>
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
            ) : loading && !freshResult ? (
              <ResultSkeleton rows={5} />
            ) : (
              <div className="space-y-4">
                <div className="rounded-field border border-warning/30 bg-warning/10 p-4 text-sm leading-6 text-body">
                  <div className="font-semibold text-ink">{dataMissing ? upliftUnavailableMessage() : "Enter a target, budget, and timeline."}</div>
                  <p className="mt-2">{freshResult?.message ?? "Enter a target, budget, and timeline to run the renovation screening planner."}</p>
                </div>

                {dataMissing ? (
                  <div className="rounded-field border border-line bg-surface p-4">
                    <div className="text-sm font-semibold text-ink">Files needed for recommendations</div>
                    <p className="mt-2 text-sm leading-6 text-muted">
                      The plan chooses actions by modeled renovation evidence. When that evidence is unavailable, the app abstains instead of guessing.
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
