import { Bookmark } from "lucide-react";
import type { DealAnalyzeResponse } from "@vvl/shared";

import { formatCurrency, formatSignedCurrency } from "../../lib/format";

function dealTone(label: string): string {
  if (label === "Worth review") {
    return "bg-brand-50 text-brand-700 ring-brand-200";
  }
  if (label === "Pass for now") {
    return "bg-danger/10 text-danger ring-danger/20";
  }
  return "bg-warning/10 text-warning ring-warning/20";
}

interface DealVerdictHeroProps {
  result: DealAnalyzeResponse | null;
  validationMessage: string | null;
  loading: boolean;
  variant: "mobile" | "desktop";
  canSaveScenario: boolean;
  savedMessage: string | null;
  onSaveScenario: () => void;
}

export function DealVerdictHero({
  result,
  validationMessage,
  loading,
  variant,
  canSaveScenario,
  savedMessage,
  onSaveScenario,
}: DealVerdictHeroProps) {
  const verdictLabel = result ? result.dealLabel : validationMessage ? "Paused" : loading ? "Analyzing" : "Loading";

  if (variant === "mobile") {
    return (
      <section className="hero-panel xl:hidden" aria-live="polite" aria-atomic="true">
        <div className="eyebrow">Current deal verdict</div>
        <div className="metric-num mt-2 text-4xl leading-none">{verdictLabel}</div>
        <p className="mt-3 text-sm leading-6 text-muted">
          {result
            ? `${formatSignedCurrency(result.estimatedNetUpside)} modeled net upside after ${formatCurrency(result.plan.plannedSpend ?? 0)} of planned work, before other costs.`
            : "The verdict updates after the property and deal inputs are valid."}
        </p>
      </section>
    );
  }

  return (
    <section className="hero-panel" aria-live="polite" aria-atomic="true">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="eyebrow">Deal verdict</div>
          <div className="metric-num mt-2 text-4xl leading-none sm:text-5xl">{verdictLabel}</div>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
            {result
              ? `After-plan value is ${formatCurrency(result.afterPlanValue)}. After ${formatCurrency(result.plan.plannedSpend ?? 0)} of planned work, modeled net upside is ${formatSignedCurrency(result.estimatedNetUpside)} before transaction, financing, tax, and carrying costs.`
              : validationMessage
                ? "Fix the highlighted home details before the dashboard analyzes this deal."
                : "The API combines base value, asking price, renovation rules, local ceiling, and model-trust notes."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {result ? (
            <span className={`rounded-pill px-3 py-1 text-xs font-semibold ring-1 ${dealTone(result.dealLabel)}`}>{result.dealLabel}</span>
          ) : null}
          <button type="button" disabled={!canSaveScenario} onClick={onSaveScenario} className="btn-ghost">
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
  );
}
