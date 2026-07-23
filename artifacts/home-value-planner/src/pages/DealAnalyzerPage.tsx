import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Link } from "react-router-dom";
import { detectMarket, marketCatalog, type DealRiskFlag } from "@vvl/shared";

import { DealInputsForm } from "../components/deal/DealInputsForm";
import { DealRobustnessCard } from "../components/deal/DealRobustnessCard";
import { DealVerdictHero } from "../components/deal/DealVerdictHero";
import { InlineAlert } from "../components/InlineAlert";
import { MetricCard } from "../components/MetricCard";
import { ProvenanceBadge } from "../components/ProvenanceBadge";
import { ResultSkeleton } from "../components/ResultSkeleton";
import { SectionCard } from "../components/SectionCard";
import { usePropertySession } from "../context/PropertySessionContext";
import { useDealAnalyzeQuery } from "../hooks/useDealAnalyzeQuery";
import { chartBarSecondary, chartGridStroke, chartTickFill } from "../lib/chartTheme";
import { formatCurrency, formatPercent, formatSignedCurrency } from "../lib/format";
import { firstPropertyValidationMessage } from "../lib/propertyValidation";
import { createDealScenario } from "../lib/scenarios";

function riskTone(flag: DealRiskFlag): string {
  if (flag.level === "danger") {
    return "border-danger/30 bg-danger/10 text-danger";
  }
  if (flag.level === "warning") {
    return "border-warning/30 bg-warning/10 text-warning";
  }
  return "border-brand-200 bg-brand-50 text-brand-800";
}

export function DealAnalyzerPage() {
  const {
    property,
    setProperty,
    plannedFlags,
    setPlannedFlags,
    saveScenario,
    dealInputs,
    setDealInputs,
    markets,
    propertyValidation,
    setPropertyFormValidation,
  } = usePropertySession();

  const { result, loading, error, askingPrice, budget, timelineMonths } = useDealAnalyzeQuery({
    property,
    plannedFlags,
    dealInputs,
    propertyValidation,
  });

  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    setSavedMessage(null);
  }, [askingPrice, budget, plannedFlags, property, propertyValidation.valid, timelineMonths]);

  const chartData = useMemo(
    () =>
      result
        ? [
            { name: "Asking", value: askingPrice },
            { name: "As-is model", value: result.estimate.baseValue },
            { name: "After plan", value: result.afterPlanValue },
          ]
        : [],
    [askingPrice, result],
  );

  const validationMessage = propertyValidation.valid ? null : firstPropertyValidationMessage(propertyValidation);
  const canSaveScenario = Boolean(result && !validationMessage);
  const detectedMarket = detectMarket(property.postalCode);
  const currentMarketLabel = result?.estimate.marketLabel ?? (detectedMarket ? marketCatalog[detectedMarket].label : "supported-market");

  function handleSaveScenario() {
    if (!result) {
      return;
    }

    saveScenario(
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
        <h1 className="font-display text-3xl text-ink">Analyze one {currentMarketLabel} deal</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted">
          Compare asking price with the as-is estimate and renovation plan to see whether modeled net upside is worth review.
        </p>
      </div>

      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}

      <div className="grid gap-6 xl:grid-cols-[400px,minmax(0,1fr)]">
        <DealInputsForm
          property={property}
          onPropertyChange={setProperty}
          plannedFlags={plannedFlags}
          onPlannedFlagsChange={setPlannedFlags}
          dealInputs={dealInputs}
          onDealInputsChange={setDealInputs}
          markets={markets}
          onPropertyValidationChange={setPropertyFormValidation}
        />

        <div className="space-y-6" aria-busy={loading}>
          <DealVerdictHero
            variant="desktop"
            result={result}
            validationMessage={validationMessage}
            loading={loading}
            canSaveScenario={canSaveScenario}
            savedMessage={savedMessage}
            onSaveScenario={handleSaveScenario}
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <MetricCard
              label="Value gap"
              tone={result ? (result.modeledValueGap >= 0 ? "success" : "danger") : "neutral"}
              value={result ? formatSignedCurrency(result.modeledValueGap) : validationMessage ? "Fix inputs" : loading ? "Updating" : "Loading"}
              hint="As-is model minus asking"
            />
            <MetricCard
              label="Plan spend"
              value={result?.plan.plannedSpend != null ? formatCurrency(result.plan.plannedSpend) : validationMessage ? "Fix inputs" : loading ? "Updating" : "Loading"}
              hint="Committed plus recommended work"
            />
            <MetricCard
              label="Net upside"
              tone={result ? (result.estimatedNetUpside >= 0 ? "success" : "danger") : "neutral"}
              value={result ? formatSignedCurrency(result.estimatedNetUpside) : validationMessage ? "Fix inputs" : loading ? "Updating" : "Loading"}
              hint={result ? `${formatPercent(result.netUpsidePercent * 100, 1)} after renovation spend; before other costs` : "After renovation spend"}
            />
          </div>

          {validationMessage ? (
            <SectionCard title="Deal analysis paused">
              <div className="data-row text-sm text-muted">{validationMessage}</div>
            </SectionCard>
          ) : loading && !result ? (
            <SectionCard title="Analyzing deal">
              <ResultSkeleton rows={4} />
            </SectionCard>
          ) : result ? (
            <>
              {result.provenance ? <ProvenanceBadge provenance={result.provenance} /> : null}
              <SectionCard title="Price comparison">
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} vertical={false} />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: chartTickFill, fontSize: 12 }} />
                      <YAxis tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`} width={72} tickLine={false} axisLine={false} tick={{ fill: chartTickFill, fontSize: 12 }} />
                      <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                      <Bar dataKey="value" fill={chartBarSecondary} radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </SectionCard>

              {result.robustness ? <DealRobustnessCard robustness={result.robustness} /> : null}

              <div className="grid gap-6 lg:grid-cols-[1fr,0.9fr]">
                <SectionCard
                  title="Risk notes"
                  description="The dashboard flags when the thesis depends too heavily on price, renovation execution, or model uncertainty."
                >
                  <div className="space-y-3">
                    {(result.riskFlags ?? []).map((flag) => (
                      <div key={`${flag.label}-${flag.level}`} className={`rounded-field border px-4 py-3 ${riskTone(flag)}`}>
                        <div className="text-sm font-semibold">{flag.label}</div>
                        <div className="mt-1 text-sm leading-6 text-body">{flag.detail}</div>
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard
                  title="Next actions"
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
            </>
          ) : (
            <SectionCard title="Analyzing deal">
              <div className="data-row text-sm text-muted">Waiting for inputs</div>
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  );
}
