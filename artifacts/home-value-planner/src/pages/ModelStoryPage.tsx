import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ModelExperimentsResponse, ModelRegistryResponse } from "@vvl/shared";

import { getModelExperiments, getModelRegistry } from "../api/client";
import { SectionCard } from "../components/SectionCard";
import { formatCurrency, formatPercent } from "../lib/format";

const experimentLabels: Record<string, string> = {
  local: "Local (per market)",
  pooled: "Pooled (both markets)",
  hybrid: "Hybrid (pooled + market features)",
};

export function ModelStoryPage() {
  const [experiments, setExperiments] = useState<ModelExperimentsResponse | null>(null);
  const [registry, setRegistry] = useState<ModelRegistryResponse | null>(null);

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

    getModelRegistry()
      .then((response) => {
        if (active) {
          setRegistry(response);
        }
      })
      .catch(() => {
        // The registry section stays hidden when the endpoint is unreachable.
      });

    return () => {
      active = false;
    };
  }, []);

  const experimentsReady = experiments?.status === "ready" ? experiments : null;
  const registryReady = registry?.status === "ready" ? registry : null;
  const leaderboardRows = experimentsReady ? experimentsReady.rows.filter((row) => row.propertyType === "All") : [];
  const modelRows = [
    ["Base model", "Vancouver listing data", "3,518 usable rows", "As-is listing value by property type."],
    ["Uplift model", "Seattle/King County observed repeat sales", "633 repeat-sale rows", "Renovation uplift percentage, transferred carefully to Vancouver."],
    ["Validation", "Train/holdout, cross-validation, bootstrap", "12.6% overall holdout MAPE", "Enough to screen deals, not enough to replace appraisal work."],
  ];

  const nextDataRows = [
    ["BC Assessment custom extract", "The biggest upgrade: real BC sales, assessment inventory, permits, and property attributes."],
    ["City of Vancouver permits", "Local renovation signal that can replace the Seattle bridge once joined to actual Vancouver sales."],
    ["Property tax, parcels, zoning", "Better location, age, land value, improvement value, and zoning features."],
    ["Census, CMHC, TransLink", "Neighbourhood demand, income, rental market, and transit-access features."],
  ];

  return (
    <div className="space-y-6">
      <section className="hero-panel bg-gradient-to-br from-surface to-brand-50/40">
        <div className="max-w-3xl">
          <div className="eyebrow">Model &amp; data story</div>
          <h1 className="mt-2 font-display text-4xl leading-tight text-ink">How I built the deal analyzer, and where I would improve it next</h1>
          <p className="mt-3 text-base leading-7 text-body">
            I kept this project focused on one practical question: is this Vancouver deal worth deeper review? The model helps with screening,
            but I also show the data limits clearly because real estate models can become misleading fast.
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

      <div className="grid gap-4 lg:grid-cols-3">
        {modelRows.map(([title, source, metric, body]) => (
          <div key={title} className="card-pad">
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
            keeps validation and deal math in one place, and the Python service owns the model training and inference.
          </p>
          <p>
            The important judgment call was not pretending the Vancouver listing data had renovation labels. The base model stays Vancouver-specific,
            while the uplift layer uses observed Seattle repeat-sale percentages until I can get local transaction data.
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
            sales do not drag the estimate down. A civic-address bridge attaches postal codes to each parcel, which gives Halifax the
            same FSA and submarket-cluster location features the Vancouver model uses.
          </p>
          <p>
            When the full model service is running, estimates also report a split conformal confidence interval (an 80% target checked
            against held-out sales), explain each value with SHAP attributions, and are validated with spatial cross-validation so nearby
            parcels cannot leak between train and test folds. The public demo falls back to a heuristic error-ratio band and labels it
            as such.
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

      {registryReady && registryReady.models.length ? (
        <SectionCard
          title="Model registry: what is in production"
          eyebrow="MLflow"
          description="Production bundles are tracked and versioned in an MLflow registry. A promotion policy selects the architecture that wins on spatial generalization, so the served model is a data-driven choice, not a hardcoded one."
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-[0.14em] text-muted">
                  <th className="py-3 pr-4 font-bold">Model</th>
                  <th className="py-3 pr-4 font-bold">Production</th>
                  <th className="py-3 pr-4 font-bold">Architecture</th>
                  <th className="py-3 pr-4 font-bold">Spatial CV MAE</th>
                  <th className="py-3 font-bold">Holdout MAPE</th>
                </tr>
              </thead>
              <tbody>
                {registryReady.models.map((model) => (
                  <tr key={model.name} className="border-b border-line/60 even:bg-canvas">
                    <td className="py-3 pr-4 font-semibold text-ink">{model.market}</td>
                    <td className="py-3 pr-4 tabular-nums">
                      v{model.productionVersion}
                      <span className="ml-1 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-700">
                        {model.stage}
                      </span>
                    </td>
                    <td className="py-3 pr-4">{model.modelArchitecture ?? "—"}</td>
                    <td className="py-3 pr-4 tabular-nums">{model.spatialCvMae != null ? formatCurrency(model.spatialCvMae) : "—"}</td>
                    <td className="py-3 tabular-nums">{model.holdoutMape != null ? formatPercent(model.holdoutMape * 100, 1) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs leading-5 text-muted">
            Promotion policy: lowest {registryReady.policy.primaryMetric} ({registryReady.policy.direction}); guardrail —{" "}
            {registryReady.policy.guardrail}. Generated {new Date(registryReady.generatedAt).toLocaleDateString("en-CA")}.
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
