import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ModelExperimentsResponse } from "@vvl/shared";

import { getModelExperiments } from "../api/client";
import { SectionCard } from "../components/SectionCard";
import { formatCurrency, formatPercent } from "../lib/format";

const experimentLabels: Record<string, string> = {
  local: "Local (per market)",
  pooled: "Pooled (both markets)",
  hybrid: "Hybrid (pooled + market features)",
};

export function ModelStoryPage() {
  const [experiments, setExperiments] = useState<ModelExperimentsResponse | null>(null);

  useEffect(() => {
    let active = true;

    getModelExperiments()
      .then((response) => {
        if (active) {
          setExperiments(response);
        }
      })
      .catch(() => {
        // The model lab section simply stays hidden when the endpoint is unreachable.
      });

    return () => {
      active = false;
    };
  }, []);

  const experimentsReady = experiments?.status === "ready" ? experiments : null;
  const leaderboardRows = experimentsReady ? experimentsReady.rows.filter((row) => row.propertyType === "All") : [];

  function modelRowMetric(market: "vancouver" | "halifax_maritimes", fallback: string): string {
    const row = experimentsReady?.rows.find((entry) => entry.experiment === "local" && entry.market === market && entry.propertyType === "All");
    if (!row) {
      return fallback;
    }
    return `${(row.trainingRows + row.holdoutRows).toLocaleString("en-CA")} model rows`;
  }

  const modelRows = [
    ["Vancouver base", "Real listing data", modelRowMetric("vancouver", "as of 2026-07 build"), "Listing value only. Available raw files have empty listing dates, so temporal holdout fails closed; shipped Vancouver metrics stay pre–Phase-E / random-split until dated listings exist."],
    ["Halifax base", "PVSC real sales", modelRowMetric("halifax_maritimes", "as of 2026-07 build"), "Time-adjusted sale value for Detached, Townhouse, and Duplex. Primary metrics are temporal (last 6 months of saleDate); random 80/20 is secondary only."],
    ["Renovation evidence", "Seattle and Halifax repeat sales", "as of 2026-07 build", "Halifax currently supports one broad permitted-renovation effect, not category-level effects. Co-occurrence is not summed; permit geo-match is incomplete."],
    ["Reliability", "Holdout, spatial CV, conformal, SHAP", "Public ≠ live pickles", "Public Vercel uses the TypeScript rules engine. Live fitted models and conformal bands run only in local Express+Flask mode."],
  ];

  const nextDataRows = [
    ["BC Assessment custom extract", "The biggest upgrade: real BC sales, assessment inventory, permits, and property attributes."],
    ["City of Vancouver permits", "Local renovation signal that can replace the Seattle bridge once joined to actual Vancouver sales."],
    ["Property tax, parcels, zoning", "Better location, age, land value, improvement value, and zoning features."],
    ["Census, CMHC, TransLink", "Neighbourhood demand, income, rental market, and transit-access features."],
  ];

  return (
    <div className="space-y-6">
      <section className="hero-panel">
        <div className="max-w-3xl">
          <div className="eyebrow">Model &amp; data story</div>
          <h1 className="mt-2 font-display text-4xl leading-tight text-ink">How I built the deal analyzer, and where I would improve it next</h1>
          <p className="mt-3 text-base leading-7 text-body">
            This project answers one practical question across Vancouver and Halifax: is this property or deal worth deeper review? Live models,
            observed renovation evidence, explicit provenance, and cost-aware deal math support screening without pretending to be an appraisal.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/" className="btn-primary">
              Open workflow
            </Link>
            <Link to="/deal-analyzer" className="btn-ghost">
              Open deal analyzer
            </Link>
          </div>
        </div>
      </section>

      <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {modelRows.map(([title, source, metric, body]) => (
          <div key={title} className="card-pad min-w-0">
            <div className="font-display text-xl text-ink">{title}</div>
            <div className="eyebrow mt-3">{source}</div>
            <div className="mt-1 text-sm font-semibold text-body">{metric}</div>
            <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
          </div>
        ))}
      </div>

      <SectionCard
        title="How to explain it in an interview"
        eyebrow="Resume narrative"
        description="The strongest story is not that the model is perfect. The strongest story is that the product tells the user what the model can and cannot know."
      >
        <div className="space-y-3 text-sm leading-6 text-body">
          <p>
            I built this as a full-stack data science project, not just a notebook. The React app gives the investor workflow, the Express API
            keeps validation and deal math in one place, while the Python service separates offline training from artifact-backed inference.
          </p>
          <p>
            The important judgment call was separating target semantics and evidence. Vancouver estimates listing value and transfers uplift from
            Seattle; Halifax estimates time-adjusted sale value and uses local HRM permit-linked repeat sales. The product labels those differences.
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title="Halifax / Maritimes expansion"
        eyebrow="Second market"
        description="The same workflow now runs on a second market, trained on real sale prices instead of listings."
      >
        <div className="space-y-3 text-sm leading-6 text-body">
          <p>
            The Halifax / Maritimes model trains on real PVSC parcel sale prices, time-adjusted to a common reference period so older
            sales do not drag the estimate down. A civic-address bridge attaches postal codes to each parcel, which gives Halifax FSA
            and train-fold-only submarket-cluster location features (extract CSVs do not bake full-data clusters).
          </p>
          <p>
            When the full model service is running, estimates also report a split conformal confidence interval (an 80% target checked
            against held-out sales), explain each value with SHAP attributions, and are validated with spatial cross-validation so nearby
            parcels cannot leak between train and test folds. Public mode uses a separate rules estimator with an uncalibrated heuristic band;
            live-model validation metrics are never presented as validation of those rules.
          </p>
          <p>
            Vancouver cannot retrain on a temporal holdout yet: available BC listing files have empty Date Listed / Last Updated fields,
            and training fails closed unless ALLOW_RANDOM_HOLDOUT=1. Dates are never invented. Halifax already publishes temporal holdout as
            the headline metric; random 80/20 is secondary. Public deployment is not the live pickle artifacts.
          </p>
          <p>
            The current product does not use an LLM or RAG system. Explanations are SHAP attributions or labeled deterministic rules, which keeps
            free-form hallucination out of the decision path. Any future assistant must cite retrieved evidence and remain advisory.
          </p>
        </div>
      </SectionCard>

      {experimentsReady && leaderboardRows.length ? (
        <SectionCard
          title="Model lab: local vs pooled vs hybrid"
          eyebrow="Experiments"
          description="The same holdout protocol run across training strategies, so the architecture choice is backed by numbers instead of preference."
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-[0.14em] text-muted">
                  <th className="py-3 pr-4 font-bold">Experiment</th>
                  <th className="py-3 pr-4 font-bold">Market</th>
                  <th className="py-3 pr-4 font-bold">Family</th>
                  <th className="py-3 pr-4 font-bold">Holdout MAE</th>
                  <th className="py-3 pr-4 font-bold">Holdout MAPE</th>
                  <th className="py-3 font-bold">Spatial CV MAE</th>
                </tr>
              </thead>
              <tbody>
                {leaderboardRows.map((row) => (
                  <tr key={`${row.experiment}-${row.market}`} className="border-b border-line/60 even:bg-canvas">
                    <td className="py-3 pr-4 font-semibold text-ink">{experimentLabels[row.experiment] ?? row.experiment}</td>
                    <td className="py-3 pr-4">{row.market}</td>
                    <td className="py-3 pr-4">{row.family}</td>
                    <td className="py-3 pr-4 tabular-nums">{formatCurrency(row.holdoutMae)}</td>
                    <td className="py-3 pr-4 tabular-nums">{formatPercent(row.holdoutMape * 100, 1)}</td>
                    <td className="py-3 tabular-nums">{row.spatialCvMae != null ? formatCurrency(row.spatialCvMae) : "not run"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-5 list-disc space-y-2 pl-5 text-sm leading-6 text-body">
            {experimentsReady.conclusions.map((conclusion) => (
              <li key={conclusion}>{conclusion}</li>
            ))}
          </ul>
          <p className="mt-4 text-xs leading-5 text-muted">
            Source: {experimentsReady.source} · Generated {new Date(experimentsReady.generatedAt).toLocaleDateString("en-CA")}
          </p>
        </SectionCard>
      ) : null}

      <SectionCard
        title="Data I would add next"
        eyebrow="Model quality"
        description="The next jump is not a fancier algorithm first. It is better joined data."
      >
        <div className="grid gap-3 md:grid-cols-2">
          {nextDataRows.map(([title, body]) => (
            <div key={title} className="rounded-field bg-canvas px-4 py-3">
              <div className="text-sm font-semibold text-ink">{title}</div>
              <div className="mt-1 text-sm leading-6 text-muted">{body}</div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
