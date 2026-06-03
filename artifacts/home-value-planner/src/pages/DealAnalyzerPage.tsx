import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Bookmark } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "react-router-dom";
import type { DealAnalyzeResponse, DealRiskFlag, PlannedFlag, PropertyInput } from "@vvl/shared";

import { postDealAnalyze } from "../api/client";
import { ImprovementFlagPicker } from "../components/ImprovementFlagPicker";
import { MetricCard } from "../components/MetricCard";
import { PropertyFormCard } from "../components/PropertyFormCard";
import { SectionCard } from "../components/SectionCard";
import { formatCurrency, formatPercent, formatSignedCurrency } from "../lib/format";
import { createDealScenario, type DealInputState, type ScenarioRecord } from "../lib/scenarios";

interface DealAnalyzerPageProps {
  property: PropertyInput;
  plannedFlags: PlannedFlag[];
  onPropertyChange: (property: PropertyInput) => void;
  onPlannedFlagsChange: (flags: PlannedFlag[]) => void;
  onSaveScenario?: (scenario: ScenarioRecord) => void;
  dealInputs: DealInputState;
  onDealInputsChange: (inputs: DealInputState) => void;
}

function riskTone(flag: DealRiskFlag): string {
  if (flag.level === "danger") {
    return "border-danger/30 bg-danger/10 text-danger";
  }
  if (flag.level === "warning") {
    return "border-warning/30 bg-warning/10 text-warning";
  }
  return "border-brand-200 bg-brand-50 text-brand-800";
}

function dealTone(label: string): string {
  if (label === "Strong lead") {
    return "bg-success/10 text-success ring-success/20";
  }
  if (label === "Worth review") {
    return "bg-brand-50 text-brand-700 ring-brand-200";
  }
  if (label === "Pass for now") {
    return "bg-danger/10 text-danger ring-danger/20";
  }
  return "bg-warning/10 text-warning ring-warning/20";
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

export function DealAnalyzerPage({
  property,
  plannedFlags,
  onPropertyChange,
  onPlannedFlagsChange,
  onSaveScenario,
  dealInputs,
  onDealInputsChange,
}: DealAnalyzerPageProps) {
  const { askingPrice, budget, timelineMonths } = dealInputs;
  const [askingPriceDraft, setAskingPriceDraft] = useState(String(dealInputs.askingPrice));
  const [budgetDraft, setBudgetDraft] = useState(String(dealInputs.budget));
  const [timelineDraft, setTimelineDraft] = useState(String(dealInputs.timelineMonths));
  const [result, setResult] = useState<DealAnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    setAskingPriceDraft(String(askingPrice));
  }, [askingPrice]);

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

  useEffect(() => {
    setSavedMessage(null);
  }, [askingPrice, budget, plannedFlags, property, timelineMonths]);

  const chartData = useMemo(
    () => [
      { name: "Asking", value: askingPrice },
      { name: "As-is model", value: result?.estimate.baseValue ?? 0 },
      { name: "After plan", value: result?.afterPlanValue ?? 0 },
    ],
    [askingPrice, result],
  );
  const canSaveScenario = Boolean(onSaveScenario && result);

  function handleSaveScenario() {
    if (!onSaveScenario || !result) {
      return;
    }

    onSaveScenario(
      createDealScenario({
        property,
        plannedFlags,
        askingPrice,
        budget,
        timelineMonths,
        deal: result,
      }),
    );
    setSavedMessage("Saved to Scenario Workspace");
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="eyebrow">Investor dashboard</div>
        <h1 className="font-display text-3xl text-ink">Analyze one Vancouver deal before deeper diligence</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted">
          Enter a listing, compare the asking price with the as-is model estimate, add a realistic renovation budget, and see whether the
          modeled upside is worth reviewing.
        </p>
      </div>

      {error ? <div className="rounded-card border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">{error}</div> : null}

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
                  value={askingPriceDraft}
                  onChange={(event) => {
                    updateNumberDraft(
                      event.target.value,
                      setAskingPriceDraft,
                      (nextValue) => onDealInputsChange({ ...dealInputs, askingPrice: nextValue }),
                      100_000,
                    );
                  }}
                  onBlur={() => setAskingPriceDraft(String(askingPrice))}
                />
              </label>
              <label className="space-y-2">
                <span className="label">Renovation budget</span>
                <input
                  className="field"
                  type="number"
                  min={1}
                  value={budgetDraft}
                  onChange={(event) =>
                    updateNumberDraft(event.target.value, setBudgetDraft, (nextValue) => onDealInputsChange({ ...dealInputs, budget: nextValue }), 1)
                  }
                  onBlur={() => setBudgetDraft(String(budget))}
                />
              </label>
              <label className="space-y-2">
                <span className="label">Timeline months</span>
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
                      (nextValue) => onDealInputsChange({ ...dealInputs, timelineMonths: nextValue }),
                      3,
                      18,
                    )
                  }
                  onBlur={() => setTimelineDraft(String(timelineMonths))}
                />
              </label>
            </div>
          </SectionCard>

          <SectionCard title="Planned improvements" eyebrow="Renovation scope" description="Select the work that could realistically finish before resale.">
            <ImprovementFlagPicker plannedFlags={plannedFlags} onChange={onPlannedFlagsChange} />
          </SectionCard>
        </div>

        <div className="space-y-6">
          <section className="hero-panel bg-gradient-to-br from-surface to-brand-50/40">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="eyebrow">Deal verdict</div>
                <div className="metric-num mt-2 text-4xl leading-none sm:text-5xl">
                  {result ? result.dealLabel : loading ? "Analyzing" : "Loading"}
                </div>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
                  {result
                    ? `Modeled after-plan value is ${formatCurrency(result.afterPlanValue)}, giving ${formatSignedCurrency(result.estimatedGrossUpside)} gross upside before costs.`
                    : "The API combines base value, asking price, renovation rules, local ceiling, and model-trust notes."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {result ? (
                  <span className={`rounded-pill px-3 py-1 text-xs font-semibold ring-1 ${dealTone(result.dealLabel)}`}>{result.dealLabel}</span>
                ) : null}
                <button type="button" disabled={!canSaveScenario} onClick={handleSaveScenario} className="btn-ghost">
                  <Bookmark className="h-4 w-4" />
                  Save scenario
                </button>
              </div>
            </div>

            {savedMessage ? (
              <div className="mt-4 rounded-field border border-success/30 bg-success/10 px-4 py-3 text-sm font-semibold text-success">
                {savedMessage}
              </div>
            ) : null}
          </section>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Value gap"
              tone={result ? (result.modeledValueGap >= 0 ? "success" : "danger") : "neutral"}
              value={result ? formatSignedCurrency(result.modeledValueGap) : "Loading"}
              hint="As-is model minus asking"
            />
            <MetricCard
              label="Gross upside"
              tone={result ? (result.estimatedGrossUpside >= 0 ? "success" : "danger") : "neutral"}
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

          <SectionCard
            title="Price comparison"
            eyebrow="Deal math"
            description="This chart keeps the investor question simple: asking price, modeled as-is value, and guardrailed after-plan value."
          >
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "#94a3b8", fontSize: 12 }} />
                  <YAxis tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`} width={72} tickLine={false} axisLine={false} tick={{ fill: "#94a3b8", fontSize: 12 }} />
                  <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                  <Bar dataKey="value" fill="#0d9488" radius={[8, 8, 0, 0]} />
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
                  <div key={`${flag.label}-${flag.level}`} className={`rounded-field border px-4 py-3 ${riskTone(flag)}`}>
                    <div className="text-sm font-semibold">{flag.label}</div>
                    <div className="mt-1 text-sm leading-6 text-body">{flag.detail}</div>
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
                  ["/model-data-story", "Read model & data story"],
                  ["/insights", "Review market & investment insights"],
                ].map(([href, label]) => (
                  <Link
                    key={label}
                    to={href}
                    className="flex items-center justify-between gap-2 rounded-field border border-line px-4 py-3 text-sm font-semibold text-ink transition hover:border-brand-300 hover:bg-brand-50/40"
                  >
                    {label}
                    <ArrowRight className="h-4 w-4 text-brand-600" />
                  </Link>
                ))}
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
    </div>
  );
}
