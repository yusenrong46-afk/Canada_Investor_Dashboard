import { useEffect, useState } from "react";
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
              value={hasResult && result.upliftValue != null ? formatCurrency(result.upliftValue) : loading ? "Updating" : dataMissing ? "Data needed" : "Choose work"}
              hint={
                hasResult && result.upliftPercent != null
                  ? `${formatPercent(result.upliftPercent * 100)} estimated uplift`
                  : dataMissing
                    ? "Waiting for real Seattle/King County CSVs"
                    : "Estimated value from selected work"
              }
            />
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
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                  Uplift is trained from real Seattle permit and repeat-sale records, then applied as a percentage to this Vancouver estimate.
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
                          <div className="text-right text-sm font-semibold text-sound-700">
                            <div>{formatCurrency(driver.value)}</div>
                            {driver.upliftPercent != null ? <div className="mt-1 text-xs text-slate-500">{formatPercent(driver.upliftPercent * 100)}</div> : null}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-500">Choose improvements to see value drivers.</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
                  <div className="font-semibold">{dataMissing ? "Real uplift data is not loaded yet." : "Choose improvements to estimate value impact."}</div>
                  <p className="mt-2">
                    {result?.message ?? "Select improvements to estimate value impact from the Seattle observed uplift model."}
                  </p>
                </div>

                {dataMissing ? (
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="text-sm font-semibold text-cedar">Files needed for added value</div>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      The base price estimate still works. The added-value model needs these real local files before it can calculate uplift.
                    </p>
                    <div className="mt-4 space-y-2">
                      {dataSources.map(([key, path]) => (
                        <div key={key} className="rounded-lg bg-slate-50 px-3 py-2">
                          <div className="text-sm font-medium text-slate-700">{dataSourceLabels[key] ?? key}</div>
                          <div className="mt-1 font-mono text-xs text-slate-500">{shortDataPath(path)}</div>
                        </div>
                      ))}
                    </div>
                    <p className="mt-4 text-sm leading-6 text-slate-500">
                      This is intentional: the project now uses observed repeat-sale uplift only, so it shows no added value until the real
                      Seattle/King County data exists locally.
                    </p>
                  </div>
                ) : null}
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
