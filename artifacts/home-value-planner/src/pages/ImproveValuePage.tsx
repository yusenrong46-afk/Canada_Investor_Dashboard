import { useCallback } from "react";
import { ArrowRight } from "lucide-react";
import { NavLink } from "react-router-dom";
import { detectMarket } from "@vvl/shared";

import { postImproveValue } from "../api/client";
import { CostVsValueNote } from "../components/CostVsValueNote";
import { HalifaxUpliftCaveat } from "../components/HalifaxUpliftCaveat";
import { ImprovementFlagPicker } from "../components/ImprovementFlagPicker";
import { InlineAlert } from "../components/InlineAlert";
import { MetricCard } from "../components/MetricCard";
import { ProvenanceBadge } from "../components/ProvenanceBadge";
import { ResultSkeleton } from "../components/ResultSkeleton";
import { SectionCard } from "../components/SectionCard";
import { usePropertySession } from "../context/PropertySessionContext";
import { dataSourceLabels, shortDataPath } from "../lib/dataSources";
import { formatCurrency, formatPercent } from "../lib/format";
import { firstPropertyValidationMessage } from "../lib/propertyValidation";
import { upliftUnavailableMessage } from "../lib/marketLabels";
import { buildRequestKey } from "../lib/requestKey";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { useLatestRequest } from "../lib/useLatestRequest";
import type { ImproveValueResponse } from "../types";

export function ImproveValuePage() {
  const { property, estimate, plannedFlags, setPlannedFlags, propertyValidation, apiMode } = usePropertySession();
  const debouncedProperty = useDebouncedValue(property, 400);
  const debouncedFlags = useDebouncedValue(plannedFlags, 400);

  const visibleKey = buildRequestKey({ property, plannedFlags });
  const fetchKey = buildRequestKey({ property: debouncedProperty, plannedFlags: debouncedFlags });
  const fetchImprove = useCallback(
    (signal: AbortSignal) =>
      postImproveValue(
        {
          ...debouncedProperty,
          plannedFlags: debouncedFlags,
          horizonMonths: 9,
        },
        signal,
      ),
    [debouncedFlags, debouncedProperty],
  );

  const { data: freshResult, loading, error } = useLatestRequest<ImproveValueResponse>(
    visibleKey,
    fetchKey,
    propertyValidation.valid,
    fetchImprove,
  );
  const drivers = freshResult?.topUpliftDrivers ?? [];
  const hasResult = freshResult?.status === "ready";
  const dataMissing = freshResult?.status === "data-missing";
  const dataSources = Object.entries(freshResult?.dataSources ?? {});
  const validationMessage = propertyValidation.valid ? null : firstPropertyValidationMessage(propertyValidation);
  const asIsValue = freshResult?.baseValue ?? estimate?.baseValue;
  const market = estimate?.market ?? detectMarket(property.postalCode);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-3xl text-ink">What can I do to improve value?</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted">Pick realistic improvements and see modeled sale-price impact.</p>
      </div>

      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}

      {validationMessage ? (
        <InlineAlert>{`Fix the home details on Estimate before calculating improvements. ${validationMessage}`}</InlineAlert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[380px,minmax(0,1fr)]">
        <SectionCard title="Choose improvements">
          <ImprovementFlagPicker plannedFlags={plannedFlags} onChange={setPlannedFlags} />
          {market === "halifax_maritimes" ? <HalifaxUpliftCaveat variant="improve" /> : null}
        </SectionCard>

        <div className="space-y-6" aria-busy={loading}>
          <MetricCard
            variant="hero"
            tone="success"
            label="Added value"
            value={
              hasResult && freshResult.upliftValue != null
                ? formatCurrency(freshResult.upliftValue)
                : validationMessage
                  ? "Fix inputs"
                  : loading
                    ? "Updating…"
                    : dataMissing
                      ? "Data needed"
                      : "Choose work"
            }
            hint={
              hasResult && freshResult.upliftPercent != null
                ? `${formatPercent(freshResult.upliftPercent * 100)} estimated uplift on top of the current price estimate`
                : validationMessage
                  ? "Improvement results are paused until home details are valid"
                  : dataMissing
                    ? "Waiting for the market's real observed-uplift data"
                    : "Estimated value from selected work"
            }
          />

          {hasResult ? (
            <CostVsValueNote
              plannedFlags={debouncedFlags}
              upliftValue={freshResult.upliftValue}
              market={market}
              nonAdditiveUplift={market === "halifax_maritimes"}
            />
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <MetricCard
              label="After improvements"
              value={
                hasResult && freshResult.finalValueGuardrailed != null
                  ? formatCurrency(freshResult.finalValueGuardrailed)
                  : validationMessage
                    ? "Fix inputs"
                    : loading
                      ? "Updating"
                      : dataMissing
                        ? "Pending data"
                        : "Choose work"
              }
              hint={dataMissing ? "No fake uplift is shown" : "Capped by local market headroom"}
            />
            <MetricCard
              label="As-is value"
              value={asIsValue != null ? formatCurrency(asIsValue) : validationMessage ? "Fix inputs" : "Loading"}
              hint={apiMode === "live-model" ? "From the live base model" : "From the current screening estimate"}
            />
          </div>

          {hasResult && freshResult.provenance ? <ProvenanceBadge provenance={freshResult.provenance} /> : null}

          <SectionCard title={market === "halifax_maritimes" ? "Observed renovation evidence" : "Highest-impact changes"}>
            {hasResult ? (
              <div className="space-y-4">
                <p className="rounded-field border border-brand-200 bg-brand-50 px-4 py-3 text-sm leading-6 text-brand-800">
                  {freshResult.evidenceSummary ??
                    "Uplift is a screening estimate applied to the current property value. Assumed costs are defaults, not quotes."}
                </p>
                <div className="grid gap-3">
                  {drivers.length ? (
                    drivers.map((driver) => (
                      <div key={driver.flag} className="rounded-field border border-line bg-surface px-4 py-3">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-sm font-semibold text-ink">{driver.label}</div>
                            {driver.rationale ? <div className="mt-1 text-xs leading-5 text-muted">{driver.rationale}</div> : null}
                          </div>
                          <div className="text-right text-sm font-semibold tabular-nums text-success">
                            <div>{formatCurrency(driver.value)}</div>
                            {driver.upliftPercent != null ? <div className="mt-1 text-xs text-muted">{formatPercent(driver.upliftPercent * 100)}</div> : null}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="data-row text-sm text-muted">Choose improvements to see value drivers.</div>
                  )}
                </div>
              </div>
            ) : loading ? (
              <ResultSkeleton rows={4} />
            ) : (
              <div className="space-y-4">
                <div className="rounded-field border border-warning/30 bg-warning/10 p-4 text-sm leading-6 text-body">
                  <div className="font-semibold text-ink">{dataMissing ? "Real uplift data is not loaded yet." : "Choose improvements to estimate value impact."}</div>
                  <p className="mt-2">
                    {freshResult?.message ?? "Select improvements to estimate value impact from the observed uplift model."}
                  </p>
                </div>

                {dataMissing ? (
                  <div className="rounded-field border border-line bg-surface p-4">
                    <div className="text-sm font-semibold text-ink">Files needed for added value</div>
                    <p className="mt-2 text-sm leading-6 text-muted">
                      The base price estimate still works. The added-value model needs these real local files before it can calculate uplift.
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

          <div className="flex justify-end">
            <NavLink to="/plan" className="btn-primary">
              Next: make a plan
              <ArrowRight className="h-4 w-4" />
            </NavLink>
          </div>
        </div>
      </div>
    </div>
  );
}
