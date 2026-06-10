import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { NavLink } from "react-router-dom";

import { postImproveValue } from "../api/client";
import { ImprovementFlagPicker } from "../components/ImprovementFlagPicker";
import { MetricCard } from "../components/MetricCard";
import { SectionCard } from "../components/SectionCard";
import { formatCurrency, formatPercent } from "../lib/format";
import type { EstimateResponse, ImproveValueResponse, PlannedFlag, PropertyInput } from "../types";

interface ImproveValuePageProps {
  property: PropertyInput;
  estimate: EstimateResponse | null;
  plannedFlags: PlannedFlag[];
  onPlannedFlagsChange: (flags: PlannedFlag[]) => void;
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
  const dataMissing = result?.status === "data-missing";
  const dataSources = Object.entries(result?.dataSources ?? {});

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="eyebrow">2. Improve value</div>
        <h1 className="font-display text-3xl text-ink">What can I do to improve value?</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted">
          Pick realistic improvements and see the estimated value impact on top of the current price estimate.
        </p>
      </div>

      {error ? (
        <div className="rounded-card border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">{error}</div>
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
          <MetricCard
            variant="hero"
            tone="success"
            label="Added value"
            value={hasResult && result.upliftValue != null ? formatCurrency(result.upliftValue) : loading ? "Updating" : dataMissing ? "Data needed" : "Choose work"}
            hint={
              hasResult && result.upliftPercent != null
                ? `${formatPercent(result.upliftPercent * 100)} estimated uplift on top of the current price estimate`
                : dataMissing
                  ? "Waiting for real Seattle/King County CSVs"
                  : "Estimated value from selected work"
            }
          />

          <div className="grid gap-4 md:grid-cols-2">
            <MetricCard label="Current as-is value" value={estimate ? formatCurrency(estimate.baseValue) : "Loading"} hint="From the live base model" />
            <MetricCard
              label="After improvements"
              value={
                hasResult && result.finalValueGuardrailed != null
                  ? formatCurrency(result.finalValueGuardrailed)
                  : loading
                    ? "Updating"
                    : dataMissing
                      ? "Pending data"
                      : "Choose work"
              }
              hint={dataMissing ? "No fake uplift is shown" : "Capped by local market headroom"}
            />
          </div>

          <SectionCard
            title="Highest-impact changes"
            eyebrow="Result"
            description="The list shows which selected improvements are doing the most work."
          >
            {hasResult ? (
              <div className="space-y-4">
                <p className="rounded-field border border-brand-200 bg-brand-50 px-4 py-3 text-sm leading-6 text-brand-800">
                  {result.evidenceSummary ??
                    `Uplift uses available observed renovation patterns when data exists, then applies the estimated percentage to this ${estimate?.marketLabel ?? "Vancouver"} value estimate.`}
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
            ) : (
              <div className="space-y-4">
                <div className="rounded-field border border-warning/30 bg-warning/10 p-4 text-sm leading-6 text-body">
                  <div className="font-semibold text-ink">{dataMissing ? "Real uplift data is not loaded yet." : "Choose improvements to estimate value impact."}</div>
                  <p className="mt-2">
                    {result?.message ?? "Select improvements to estimate value impact from the Seattle observed uplift model."}
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
                    <p className="mt-4 text-sm leading-6 text-muted">
                      This is intentional: the project now uses observed repeat-sale uplift only, so it shows no added value until the real
                      Seattle/King County data exists locally.
                    </p>
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
