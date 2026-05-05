import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "react-router-dom";

import { postDealAnalyze } from "../api/client";
import { AssistantPanel } from "../components/AssistantPanel";
import { ImprovementFlagPicker } from "../components/ImprovementFlagPicker";
import { MetricCard } from "../components/MetricCard";
import { PropertyFormCard } from "../components/PropertyFormCard";
import { SectionCard } from "../components/SectionCard";
import { formatCurrency, formatPercent, formatSignedCurrency } from "../lib/format";
import type { DealAnalyzeResponse, DealRiskFlag, EstimateResponse, PlannedFlag, PropertyInput } from "../types";

interface DealAnalyzerPageProps {
  property: PropertyInput;
  estimate: EstimateResponse | null;
  plannedFlags: PlannedFlag[];
  onPropertyChange: (property: PropertyInput) => void;
  onPlannedFlagsChange: (flags: PlannedFlag[]) => void;
}

function riskTone(flag: DealRiskFlag): string {
  if (flag.level === "danger") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }
  if (flag.level === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-sound-200 bg-sound-50 text-sound-800";
}

function dealTone(label: string): string {
  if (label === "Strong lead") {
    return "bg-emerald-50 text-emerald-800 border-emerald-200";
  }
  if (label === "Worth review") {
    return "bg-sound-50 text-sound-800 border-sound-200";
  }
  if (label === "Pass for now") {
    return "bg-rose-50 text-rose-800 border-rose-200";
  }
  return "bg-amber-50 text-amber-800 border-amber-200";
}

export function DealAnalyzerPage({
  property,
  estimate,
  plannedFlags,
  onPropertyChange,
  onPlannedFlagsChange,
}: DealAnalyzerPageProps) {
  const [askingPrice, setAskingPrice] = useState(735_000);
  const [budget, setBudget] = useState(85_000);
  const [timelineMonths, setTimelineMonths] = useState(9);
  const [askingTouched, setAskingTouched] = useState(false);
  const [result, setResult] = useState<DealAnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (estimate?.baseValue && !askingTouched) {
      setAskingPrice(Math.round(estimate.baseValue * 0.97));
    }
  }, [askingTouched, estimate?.baseValue]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    postDealAnalyze({
      ...property,
      plannedFlags,
      askingPrice,
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
  }, [askingPrice, budget, plannedFlags, property, timelineMonths]);

  const chartData = useMemo(
    () => [
      { name: "Asking", value: askingPrice },
      { name: "As-is model", value: result?.estimate.baseValue ?? estimate?.baseValue ?? 0 },
      { name: "After plan", value: result?.afterPlanValue ?? 0 },
    ],
    [askingPrice, estimate?.baseValue, result],
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-sound-600">Investor dashboard</div>
        <h1 className="font-display text-3xl text-cedar">Analyze one Vancouver deal before deeper diligence</h1>
        <p className="max-w-3xl text-sm leading-6 text-slate-500">
          Enter a listing, compare the asking price with the as-is model estimate, add a realistic renovation budget, and see whether the
          modeled upside is worth reviewing.
        </p>
      </div>

      {error ? <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{error}</div> : null}

      <div className="grid gap-6 xl:grid-cols-[400px,minmax(0,1fr)]">
        <div className="space-y-6">
          <PropertyFormCard property={property} onChange={onPropertyChange} />

          <SectionCard title="Deal inputs" eyebrow="Investor thesis" description="Keep these numbers conservative; transaction costs are not included yet.">
            <div className="grid gap-4">
              <label className="space-y-2">
                <span className="label">Asking price</span>
                <input
                  className="field"
                  type="number"
                  min={100000}
                  value={askingPrice}
                  onChange={(event) => {
                    setAskingTouched(true);
                    setAskingPrice(Number(event.target.value));
                  }}
                />
              </label>
              <label className="space-y-2">
                <span className="label">Renovation budget</span>
                <input className="field" type="number" min={1000} value={budget} onChange={(event) => setBudget(Number(event.target.value))} />
              </label>
              <label className="space-y-2">
                <span className="label">Timeline months</span>
                <input
                  className="field"
                  type="number"
                  min={3}
                  max={18}
                  value={timelineMonths}
                  onChange={(event) => setTimelineMonths(Number(event.target.value))}
                />
              </label>
            </div>
          </SectionCard>

          <SectionCard title="Planned improvements" eyebrow="Renovation scope" description="Select the work that could realistically finish before resale.">
            <ImprovementFlagPicker plannedFlags={plannedFlags} onChange={onPlannedFlagsChange} />
          </SectionCard>
        </div>

        <div className="space-y-6">
          <section className="rounded-[28px] border border-slate-200 bg-gradient-to-br from-white via-white to-sound-50/40 p-6 shadow-soft">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-sound-600">Deal verdict</div>
                <div className="mt-2 font-display text-5xl leading-none text-cedar">
                  {result ? result.dealLabel : loading ? "Analyzing" : "Loading"}
                </div>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
                  {result
                    ? `Modeled after-plan value is ${formatCurrency(result.afterPlanValue)}, giving ${formatSignedCurrency(result.estimatedGrossUpside)} gross upside before costs.`
                    : "The API combines base value, asking price, renovation rules, local ceiling, and model-trust notes."}
                </p>
              </div>
              {result ? (
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${dealTone(result.dealLabel)}`}>{result.dealLabel}</span>
              ) : null}
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-4">
              <MetricCard label="Value gap" value={result ? formatSignedCurrency(result.modeledValueGap) : "Loading"} hint="As-is model minus asking" />
              <MetricCard
                label="Gross upside"
                value={result ? formatSignedCurrency(result.estimatedGrossUpside) : "Loading"}
                hint="After-plan value minus asking"
              />
              <MetricCard
                label="Upside %"
                value={result ? formatPercent(result.grossUpsidePercent * 100, 1) : "Loading"}
                hint="Before closing and carry costs"
              />
              <MetricCard label="Plan spend" value={result?.plan.plannedSpend != null ? formatCurrency(result.plan.plannedSpend) : "Loading"} hint="Recommended work" />
            </div>
          </section>

          <SectionCard
            title="Price comparison"
            eyebrow="Deal math"
            description="This chart keeps the investor question simple: asking price, modeled as-is value, and guardrailed after-plan value."
          >
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`} width={72} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Bar dataKey="value" fill="#128284" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>

          <div className="grid gap-6 lg:grid-cols-[1fr,0.9fr]">
            <SectionCard
              title="Risk notes"
              eyebrow="Trust layer"
              description="The dashboard flags when the thesis depends too heavily on price, renovation execution, or model uncertainty."
            >
              <div className="space-y-3">
                {(result?.riskFlags ?? []).map((flag) => (
                  <div key={`${flag.label}-${flag.level}`} className={`rounded-2xl border px-4 py-3 ${riskTone(flag)}`}>
                    <div className="text-sm font-semibold">{flag.label}</div>
                    <div className="mt-1 text-sm leading-6 opacity-90">{flag.detail}</div>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard
              title="Next actions"
              eyebrow="Deep dives"
              description="Use these screens to inspect the model and renovation assumptions behind the verdict."
            >
              <div className="grid gap-3">
                {[
                  ["/estimate", "Inspect base estimate"],
                  ["/simulate", "Stress-test renovations"],
                  ["/plan", "Tune the sale plan"],
                  ["/model-story", "Read project story"],
                ].map(([href, label]) => (
                  <Link key={href} to={href} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-cedar transition hover:border-sound-300">
                    {label}
                  </Link>
                ))}
              </div>
            </SectionCard>
          </div>

          <AssistantPanel />
        </div>
      </div>
    </div>
  );
}
