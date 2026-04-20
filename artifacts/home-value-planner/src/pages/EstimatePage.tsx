import { PropertyFormCard } from "../components/PropertyFormCard";
import { SectionCard } from "../components/SectionCard";
import { formatCurrency, formatPercent, formatSignedCurrency } from "../lib/format";
import type { EstimateResponse, PropertyInput } from "../types";

interface EstimatePageProps {
  property: PropertyInput;
  estimate: EstimateResponse | null;
  onPropertyChange: (property: PropertyInput) => void;
  loading: boolean;
}

function positionOnRange(value: number, minimum: number, maximum: number): string {
  const span = maximum - minimum;
  if (!Number.isFinite(span) || span <= 0) {
    return "50%";
  }

  const percent = ((value - minimum) / span) * 100;
  return `${Math.min(100, Math.max(0, percent))}%`;
}

export function EstimatePage({ property, estimate, onPropertyChange, loading }: EstimatePageProps) {
  const anchorDelta =
    estimate && property.knownCurrentValue != null ? Math.round(estimate.anchorValue - estimate.baseValue) : null;

  const positiveDrivers = (estimate?.drivers ?? []).filter((driver) => driver.value > 0).slice(0, 3);
  const negativeDrivers = (estimate?.drivers ?? []).filter((driver) => driver.value < 0).slice(0, 3);

  const rangeValues = estimate
    ? [estimate.marketContext.localMedianValue, estimate.baseValue, estimate.marketContext.practicalCeiling]
    : [0, 1];
  const rangeMinimum = Math.min(...rangeValues) * 0.85;
  const rangeMaximum = Math.max(...rangeValues) * 1.05;

  const bootstrap = estimate?.modelQuality.validationSummary.bootstrapRanges;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-sound-600">Estimate</div>
        <h1 className="font-display text-3xl text-cedar">Estimate the current list value for a Vancouver home</h1>
        <p className="max-w-2xl text-sm leading-6 text-slate-500">
          Enter the home as it exists today and we will anchor it with the strongest Vancouver base-price model currently in the product.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[380px,minmax(0,1fr)]">
        <PropertyFormCard property={property} onChange={onPropertyChange} />

        <div className="space-y-6">
          <section className="rounded-[28px] border border-slate-200 bg-gradient-to-br from-white via-white to-sound-50/40 p-6 shadow-soft">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-3">
                <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-sound-600">Primary estimate</div>
                <div className="font-display text-5xl leading-none text-cedar">
                  {estimate ? formatCurrency(estimate.baseValue) : "Loading"}
                </div>
                <p className="max-w-xl text-sm leading-6 text-slate-500">
                  {estimate
                    ? `Current modeled list value for a Vancouver ${estimate.modelScope.toLowerCase()} around ${estimate.marketContext.localAreaLabel}.`
                    : "Calculating the current modeled list value from Vancouver listing patterns."}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {estimate ? (
                  <span className="rounded-full border border-sound-200 bg-sound-50 px-3 py-1 text-xs font-semibold text-sound-700">
                    Using the {estimate.modelScope} {estimate.modelFamily} model
                  </span>
                ) : null}
                {loading ? (
                  <span className="rounded-full bg-sound-50 px-3 py-1 text-xs font-semibold text-sound-700">Updating</span>
                ) : null}
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4">
                <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-slate-500">Confidence range</div>
                <div className="mt-2 text-lg font-semibold text-cedar">
                  {estimate ? `${formatCurrency(estimate.confidenceLow)} to ${formatCurrency(estimate.confidenceHigh)}` : "Loading"}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4">
                <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-slate-500">Local area</div>
                <div className="mt-2 text-lg font-semibold text-cedar">
                  {estimate?.marketContext.localAreaLabel ?? "Loading"}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200/80 bg-white/80 p-4">
                <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-slate-500">Anchor delta</div>
                <div className="mt-2 text-lg font-semibold text-cedar">
                  {anchorDelta != null ? formatSignedCurrency(anchorDelta) : "Not set"}
                </div>
                <div className="mt-1 text-xs leading-5 text-slate-500">
                  {anchorDelta != null
                    ? "Difference between your own current value and the model."
                    : "Add a known current value if you want a direct comparison."}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
            <details>
              <summary className="flex cursor-pointer list-none flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-sound-600">Trust</div>
                  <h2 className="mt-1 font-display text-xl text-cedar">Why trust this estimate?</h2>
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                    A short trust summary for homeowners, with the technical validation details tucked underneath.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-500">Model</div>
                    <div className="mt-1 font-semibold text-cedar">{estimate ? estimate.modelFamily : "Loading"}</div>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-500">Training rows</div>
                    <div className="mt-1 font-semibold text-cedar">
                      {estimate ? estimate.modelQuality.trainingRows.toLocaleString() : "Loading"}
                    </div>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-500">CV MAPE</div>
                    <div className="mt-1 font-semibold text-cedar">
                      {estimate ? formatPercent(estimate.modelQuality.cvMape * 100, 1) : "Loading"}
                    </div>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-500">Holdout R²</div>
                    <div className="mt-1 font-semibold text-cedar">
                      {estimate ? estimate.modelQuality.holdoutR2.toFixed(2) : "Loading"}
                    </div>
                  </div>
                </div>
              </summary>

              <div className="mt-5 grid gap-5 lg:grid-cols-[1.05fr,0.95fr]">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-slate-500">Validation process</div>
                  <div className="mt-3 space-y-3 text-sm leading-6 text-slate-600">
                    <p>{estimate?.modelQuality.validationSummary.trainHoldoutSplit ?? "Loading"}</p>
                    <p>{estimate?.modelQuality.validationSummary.crossValidation ?? "Loading"}</p>
                    <p>{estimate?.modelQuality.validationSummary.bootstrap ?? "Loading"}</p>
                    <p>{estimate?.modelQuality.validationSummary.locationFeatures ?? "Loading"}</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-slate-500">Observed ranges</div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-white px-4 py-3">
                      <div className="text-xs font-semibold text-slate-500">Bootstrap MAE</div>
                      <div className="mt-1 font-semibold text-cedar">
                        {bootstrap ? `${formatCurrency(bootstrap.mae.p05)} to ${formatCurrency(bootstrap.mae.p95)}` : "Loading"}
                      </div>
                    </div>
                    <div className="rounded-xl bg-white px-4 py-3">
                      <div className="text-xs font-semibold text-slate-500">Bootstrap R²</div>
                      <div className="mt-1 font-semibold text-cedar">
                        {bootstrap ? `${bootstrap.r2.p05.toFixed(2)} to ${bootstrap.r2.p95.toFixed(2)}` : "Loading"}
                      </div>
                    </div>
                    <div className="rounded-xl bg-white px-4 py-3">
                      <div className="text-xs font-semibold text-slate-500">Outliers removed</div>
                      <div className="mt-1 font-semibold text-cedar">
                        {estimate ? formatPercent(estimate.modelQuality.outlierRemovedRate * 100, 1) : "Loading"}
                      </div>
                    </div>
                    <div className="rounded-xl bg-white px-4 py-3">
                      <div className="text-xs font-semibold text-slate-500">Property tax note</div>
                      <div className="mt-1 text-sm leading-6 text-slate-600">
                        {estimate?.modelQuality.validationSummary.missingnessNotes[0] ?? "Loading"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </details>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <SectionCard
              title="Local price position"
              eyebrow="Supporting view"
              description="Compare the modeled value against the local median and the practical ceiling on one shared scale."
            >
              {estimate ? (
                <div className="space-y-6">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-6">
                    <div className="relative h-2 rounded-full bg-slate-200">
                      {[
                        { label: "Local median", value: estimate.marketContext.localMedianValue, tone: "bg-slate-500" },
                        { label: "Modeled value", value: estimate.baseValue, tone: "bg-sound-600" },
                        { label: "Practical ceiling", value: estimate.marketContext.practicalCeiling, tone: "bg-cedar" },
                      ].map((marker) => (
                        <div
                          key={marker.label}
                          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                          style={{ left: positionOnRange(marker.value, rangeMinimum, rangeMaximum) }}
                        >
                          <div className={`h-4 w-4 rounded-full border-4 border-white shadow ${marker.tone}`} />
                          <div className="absolute left-1/2 top-6 -translate-x-1/2 whitespace-nowrap text-xs font-semibold text-slate-600">
                            {marker.label}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-12 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                      <span>{formatCurrency(rangeMinimum)}</span>
                      <span>{formatCurrency(rangeMaximum)}</span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {[
                      { label: "Local median", value: estimate.marketContext.localMedianValue },
                      { label: "Modeled value", value: estimate.baseValue },
                      { label: "Practical ceiling", value: estimate.marketContext.practicalCeiling },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                        <span className="text-sm font-medium text-slate-600">{item.label}</span>
                        <span className="text-sm font-semibold text-cedar">{formatCurrency(item.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">Loading price position...</div>
              )}
            </SectionCard>

            <SectionCard
              title="Value drivers"
              eyebrow="What is pushing this"
              description="Only the strongest directional signals are shown so the explanation stays readable."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-emerald-700">Pushing up</div>
                  {positiveDrivers.length ? (
                    positiveDrivers.map((driver) => (
                      <div key={driver.label} className="rounded-xl bg-emerald-50 px-4 py-3">
                        <div className="text-sm font-medium text-slate-700">{driver.label}</div>
                        <div className="mt-1 text-sm font-semibold text-emerald-700">{formatSignedCurrency(driver.value)}</div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">No strong positive drivers surfaced yet.</div>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-rose-700">Holding back</div>
                  {negativeDrivers.length ? (
                    negativeDrivers.map((driver) => (
                      <div key={driver.label} className="rounded-xl bg-rose-50 px-4 py-3">
                        <div className="text-sm font-medium text-slate-700">{driver.label}</div>
                        <div className="mt-1 text-sm font-semibold text-rose-700">{formatSignedCurrency(driver.value)}</div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">No strong negative drivers surfaced yet.</div>
                  )}
                </div>
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
    </div>
  );
}
