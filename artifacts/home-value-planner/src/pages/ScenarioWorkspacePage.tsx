import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { MetricCard } from "../components/MetricCard";
import { SectionCard } from "../components/SectionCard";
import { usePropertySession } from "../context/PropertySessionContext";
import { chartBarPrimary, chartBarSecondary, chartGridStroke, chartTickFill } from "../lib/chartTheme";
import { formatCurrency, formatPercent, formatSignedCurrency } from "../lib/format";
import { scenarioKeyDetails, summarizeScenarios, type ScenarioRecord, type ScenarioTag } from "../lib/scenarios";

interface ScenarioWorkspacePageProps {
  scenarios?: ScenarioRecord[];
  onUseScenario?: (scenario: ScenarioRecord) => void;
  onUpdateScenario?: (scenario: ScenarioRecord) => void;
  onDeleteScenario?: (scenarioId: string) => void;
  onClearScenarios?: () => void;
}

const scenarioTags: ScenarioTag[] = ["Shortlist", "Watch", "Pass", "Needs review"];

function riskTone(riskLevel: ScenarioRecord["riskLevel"]): string {
  if (riskLevel === "High") {
    return "border-danger/30 bg-danger/10 text-danger";
  }
  if (riskLevel === "Medium") {
    return "border-warning/30 bg-warning/10 text-warning";
  }
  return "border-success/30 bg-success/10 text-success";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function scenarioUseRoute(scenario: ScenarioRecord): string {
  return scenario.source === "deal-analyzer" ? "/deal-analyzer" : "/plan";
}

function ScenarioNoteField({ scenario, onUpdateScenario }: { scenario: ScenarioRecord; onUpdateScenario: (scenario: ScenarioRecord) => void }) {
  const [draft, setDraft] = useState(scenario.note);

  useEffect(() => {
    setDraft(scenario.note);
  }, [scenario.id, scenario.note]);

  useEffect(() => {
    if (draft === scenario.note) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      onUpdateScenario({ ...scenario, note: draft });
    }, 600);

    return () => window.clearTimeout(timer);
  }, [draft, onUpdateScenario, scenario]);

  return (
    <textarea
      value={draft}
      rows={2}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== scenario.note) {
          onUpdateScenario({ ...scenario, note: draft });
        }
      }}
      className="w-full rounded-field border border-line bg-surface px-3 py-2 text-xs text-body"
      placeholder="Add a short investment note"
      aria-describedby={`scenario-note-hint-${scenario.id}`}
    />
  );
}

export function ScenarioWorkspacePage(props: ScenarioWorkspacePageProps = {}) {
  const session = usePropertySession();
  const scenarios = props.scenarios ?? session.scenarios;
  const onUseScenario = props.onUseScenario ?? session.useScenario;
  const onUpdateScenario = props.onUpdateScenario ?? session.updateScenario;
  const onDeleteScenario = props.onDeleteScenario ?? session.deleteScenario;
  const onClearScenarios = props.onClearScenarios ?? session.clearScenarios;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const summary = useMemo(() => summarizeScenarios(scenarios), [scenarios]);
  const latestScenario = scenarios[0];
  const selectedScenarios = scenarios.filter((scenario) => selectedIds.includes(scenario.id));
  const chartRows = scenarios.slice(0, 8).map((scenario) => ({
    title: scenario.title.replace(" plan", "").replace(" deal", ""),
    estimatedValue: scenario.estimatedValue,
    achievableValue: scenario.achievableValue,
  }));

  function toggleSelected(scenarioId: string) {
    setSelectedIds((currentIds) => {
      if (currentIds.includes(scenarioId)) {
        return currentIds.filter((id) => id !== scenarioId);
      }
      return [...currentIds, scenarioId].slice(-4);
    });
  }

  if (!scenarios.length) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="eyebrow">Scenario Workspace</div>
          <h1 className="font-display text-3xl text-ink">Save deals and compare them side by side</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted">
            Run a plan or deal analysis, then save it here. The workspace will build a personal comparison table from your own scenarios.
          </p>
        </div>

        <section className="hero-panel">
          <div className="max-w-2xl">
            <div className="eyebrow">No saved scenarios yet</div>
            <h2 className="mt-2 font-display text-2xl text-ink">Start with a real user run</h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              Go to Plan or Deal Analyzer, adjust the inputs, and use Save scenario. This turns the dashboard from a single result into a reusable
              investment workspace.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link to="/plan" className="btn-primary">
                Open Plan
              </Link>
              <Link to="/deal-analyzer" className="btn-ghost">
                Open Deal Analyzer
              </Link>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="eyebrow">Scenario Workspace</div>
          <h1 className="font-display text-3xl text-ink">Compare your saved investment scenarios</h1>
          <p className="max-w-3xl text-sm leading-6 text-muted">
            Saved scenarios come from your own Plan and Deal Analyzer runs. Use this page to compare value, upside, spend, risk, and verdicts.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Clear all saved scenarios? This cannot be undone.")) {
              onClearScenarios();
            }
          }}
          className="inline-flex items-center justify-center gap-2 rounded-field border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-muted transition hover:border-danger/30 hover:text-danger"
        >
          Clear all
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Saved scenarios" value={String(summary.samplePropertyCount)} hint="User-created runs" />
        <MetricCard label="Average estimate" value={formatCurrency(summary.averageEstimatedValue)} hint="Average as-is value" />
        <MetricCard label="Median estimate" value={formatCurrency(summary.medianEstimatedValue)} hint="Middle saved scenario" />
        <MetricCard label="Average upside" value={formatSignedCurrency(summary.averageUpside)} hint="After-plan value movement" />
        <MetricCard label="Warnings" value={String(summary.warningCount)} hint="Risk and model review notes" />
      </div>

      <SectionCard
        title="Latest saved scenario"
        eyebrow="Most recent"
        description="The newest saved run is surfaced here so it is visible before the comparison chart."
        aside={
          <Link
            to={scenarioUseRoute(latestScenario)}
            onClick={() => onUseScenario(latestScenario)}
            className="rounded-field border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 transition hover:border-brand-300"
          >
            Use scenario
          </Link>
        }
      >
        <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr),repeat(3,minmax(0,1fr))]">
          <div className="rounded-field bg-canvas px-4 py-3">
            <div className="text-sm font-semibold text-ink">{latestScenario.title}</div>
            <div className="mt-1 text-xs text-muted">{formatDate(latestScenario.createdAt)}</div>
            <div className="mt-1 text-xs text-muted">{scenarioKeyDetails(latestScenario)}</div>
          </div>
          <div className="rounded-field bg-canvas px-4 py-3">
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Estimate</div>
            <div className="mt-1 whitespace-nowrap font-semibold tabular-nums text-ink">{formatCurrency(latestScenario.estimatedValue)}</div>
          </div>
          <div className="rounded-field bg-canvas px-4 py-3">
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Upside</div>
            <div className="mt-1 whitespace-nowrap font-semibold tabular-nums text-ink">{formatSignedCurrency(latestScenario.estimatedUpside)}</div>
          </div>
          <div className="rounded-field bg-canvas px-4 py-3">
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Verdict</div>
            <div className="mt-1 font-semibold text-ink">{latestScenario.verdict}</div>
          </div>
        </div>
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr),minmax(340px,1fr)]">
        <SectionCard
          title="Scenario value comparison"
          eyebrow="Saved runs"
          description="The chart compares the current estimate against the achievable value from each saved scenario."
        >
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartGridStroke} vertical={false} />
                <XAxis dataKey="title" tickLine={false} axisLine={false} tick={{ fill: chartTickFill, fontSize: 12 }} />
                <YAxis tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`} width={72} tickLine={false} axisLine={false} tick={{ fill: chartTickFill, fontSize: 12 }} />
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                <Bar dataKey="estimatedValue" name="As-is estimate" fill={chartBarPrimary} radius={[8, 8, 0, 0]} />
                <Bar dataKey="achievableValue" name="Achievable value" fill={chartBarSecondary} radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard
          title="Compare selected"
          eyebrow="Shortlist"
          description="Select up to four rows from the table to build a smaller working comparison."
        >
          <div className="space-y-3">
            {selectedScenarios.length ? (
              selectedScenarios.map((scenario) => (
                <div key={scenario.id} className="rounded-field border border-line bg-canvas p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-ink">{scenario.title}</div>
                      <div className="mt-1 text-xs text-muted">{scenarioKeyDetails(scenario)}</div>
                    </div>
                    <span className={`rounded-pill border px-2 py-1 text-xs font-semibold ${riskTone(scenario.riskLevel)}`}>{scenario.riskLevel}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div className="text-xs uppercase tracking-[0.14em] text-muted">Upside</div>
                      <div className="font-semibold tabular-nums text-ink">{formatSignedCurrency(scenario.estimatedUpside)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.14em] text-muted">Verdict</div>
                      <div className="font-semibold text-ink">{scenario.verdict}</div>
                    </div>
                  </div>
                  <div className="mt-2 rounded-md bg-surface px-2 py-1 text-xs text-muted">{scenario.note}</div>
                </div>
              ))
            ) : (
              <div className="data-row text-sm text-muted">Select scenarios from the table below.</div>
            )}
          </div>

          {selectedScenarios.length ? (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-line uppercase tracking-[0.12em] text-muted">
                    <th className="py-2 pr-3 font-bold">Scenario</th>
                    <th className="py-2 pr-3 font-bold">Estimate</th>
                    <th className="py-2 pr-3 font-bold">Achievable</th>
                    <th className="py-2 pr-3 font-bold">Spend</th>
                    <th className="py-2 pr-3 font-bold">Tag</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedScenarios.map((scenario) => (
                    <tr key={`compare-${scenario.id}`} className="border-b border-line/60">
                      <td className="py-2 pr-3 font-semibold text-ink">{scenario.title}</td>
                      <td className="py-2 pr-3 tabular-nums">{formatCurrency(scenario.estimatedValue)}</td>
                      <td className="py-2 pr-3 tabular-nums">{formatCurrency(scenario.achievableValue)}</td>
                      <td className="py-2 pr-3 tabular-nums">{formatCurrency(scenario.plannedSpend)}</td>
                      <td className="py-2 pr-3">{scenario.tag}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </SectionCard>
      </div>

      <SectionCard
        title="Saved scenarios"
        eyebrow="Workspace table"
        description="Each row is a user-created scenario. Use scenario reloads the property, improvements, budget, timeline, and target or asking price."
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[11px] uppercase tracking-[0.14em] text-muted">
                <th className="bg-surface py-3 pr-4 font-bold">Compare</th>
                <th className="bg-surface py-3 pr-4 font-bold">Scenario</th>
                <th className="bg-surface py-3 pr-4 font-bold">Estimate</th>
                <th className="bg-surface py-3 pr-4 font-bold">Achievable</th>
                <th className="bg-surface py-3 pr-4 font-bold">Upside</th>
                <th className="bg-surface py-3 pr-4 font-bold">Budget</th>
                <th className="bg-surface py-3 pr-4 font-bold">Spend</th>
                <th className="bg-surface py-3 pr-4 font-bold">Risk</th>
                <th className="bg-surface py-3 pr-4 font-bold">Tag</th>
                <th className="bg-surface py-3 pr-4 font-bold">Note</th>
                <th className="bg-surface py-3 pr-4 font-bold">Verdict</th>
                <th className="bg-surface py-3 font-bold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((scenario) => (
                <tr key={scenario.id} className="border-b border-line/60 align-top even:bg-canvas">
                  <td className="py-3 pr-4">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(scenario.id)}
                      aria-label={`Compare ${scenario.title}`}
                      onChange={() => toggleSelected(scenario.id)}
                      className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-200"
                    />
                  </td>
                  <td className="py-3 pr-4">
                    <div className="font-semibold text-ink">{scenario.title}</div>
                    <div className="mt-1 text-xs text-muted">{formatDate(scenario.createdAt)}</div>
                    <div className="mt-1 text-xs text-muted">{scenarioKeyDetails(scenario)}</div>
                  </td>
                  <td className="py-3 pr-4 tabular-nums">{formatCurrency(scenario.estimatedValue)}</td>
                  <td className="py-3 pr-4 tabular-nums">{formatCurrency(scenario.achievableValue)}</td>
                  <td className="py-3 pr-4">
                    <div className="tabular-nums">{formatSignedCurrency(scenario.estimatedUpside)}</div>
                    <div className="mt-1 text-xs text-muted">{formatPercent(scenario.upsidePercent * 100)}</div>
                  </td>
                  <td className="py-3 pr-4 tabular-nums">{formatCurrency(scenario.budget)}</td>
                  <td className="py-3 pr-4 tabular-nums">{formatCurrency(scenario.plannedSpend)}</td>
                  <td className="py-3 pr-4">
                    <span className={`rounded-pill border px-2 py-1 text-xs font-semibold ${riskTone(scenario.riskLevel)}`}>{scenario.riskLevel}</span>
                  </td>
                  <td className="py-3 pr-4">
                    <select
                      value={scenario.tag}
                      onChange={(event) => onUpdateScenario({ ...scenario, tag: event.target.value as ScenarioTag })}
                      className="rounded-field border border-line bg-surface px-2 py-1.5 text-xs font-semibold text-body"
                    >
                      {scenarioTags.map((tag) => (
                        <option key={tag} value={tag}>
                          {tag}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="min-w-56 py-3 pr-4">
                    <ScenarioNoteField scenario={scenario} onUpdateScenario={onUpdateScenario} />
                    <p id={`scenario-note-hint-${scenario.id}`} className="mt-1 text-[11px] text-muted">
                      Notes save on blur or after 600ms without typing.
                    </p>
                  </td>
                  <td className="py-3 pr-4">{scenario.verdict}</td>
                  <td className="py-3">
                    <div className="flex flex-wrap gap-2">
                      <Link
                        to={scenarioUseRoute(scenario)}
                        onClick={() => onUseScenario(scenario)}
                        className="rounded-field border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 transition hover:border-brand-300"
                      >
                        Use scenario
                      </Link>
                      <button
                        type="button"
                        onClick={() => onDeleteScenario(scenario.id)}
                        className="rounded-field border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-muted transition hover:border-danger/30 hover:text-danger"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
