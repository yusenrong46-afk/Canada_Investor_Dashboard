import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { MetricCard } from "../components/MetricCard";
import { SectionCard } from "../components/SectionCard";
import { formatCurrency, formatPercent, formatSignedCurrency } from "../lib/format";
import { scenarioKeyDetails, summarizeScenarios, type ScenarioRecord } from "../lib/scenarios";

interface ScenarioWorkspacePageProps {
  scenarios: ScenarioRecord[];
  onUseScenario: (scenario: ScenarioRecord) => void;
  onDeleteScenario: (scenarioId: string) => void;
  onClearScenarios: () => void;
}

function riskTone(riskLevel: ScenarioRecord["riskLevel"]): string {
  if (riskLevel === "High") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }
  if (riskLevel === "Medium") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ScenarioWorkspacePage({ scenarios, onUseScenario, onDeleteScenario, onClearScenarios }: ScenarioWorkspacePageProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const summary = useMemo(() => summarizeScenarios(scenarios), [scenarios]);
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
          <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-sound-600">Scenario Workspace</div>
          <h1 className="font-display text-3xl text-cedar">Save deals and compare them side by side</h1>
          <p className="max-w-3xl text-sm leading-6 text-slate-500">
            Run a plan or deal analysis, then save it here. The workspace will build a personal comparison table from your own scenarios.
          </p>
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-8 shadow-soft">
          <div className="max-w-2xl">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-sound-600">No saved scenarios yet</div>
            <h2 className="mt-2 font-display text-2xl text-cedar">Start with a real user run</h2>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Go to Plan or Deal Analyzer, adjust the inputs, and use Save scenario. This turns the dashboard from a single result into a reusable
              investment workspace.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link to="/plan" className="rounded-lg bg-cedar px-4 py-2 text-sm font-semibold text-white transition hover:bg-slateblue">
                Open Plan
              </Link>
              <Link
                to="/deal-analyzer"
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-sound-300 hover:text-cedar"
              >
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
          <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-sound-600">Scenario Workspace</div>
          <h1 className="font-display text-3xl text-cedar">Compare your saved investment scenarios</h1>
          <p className="max-w-3xl text-sm leading-6 text-slate-500">
            Saved scenarios come from your own Plan and Deal Analyzer runs. Use this page to compare value, upside, spend, risk, and verdicts.
          </p>
        </div>
        <button
          type="button"
          onClick={onClearScenarios}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-500 transition hover:border-rose-200 hover:text-rose-700"
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr),minmax(340px,1fr)]">
        <SectionCard
          title="Scenario value comparison"
          eyebrow="Saved runs"
          description="The chart compares the current estimate against the achievable value from each saved scenario."
        >
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="title" tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`} width={72} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                <Bar dataKey="estimatedValue" name="As-is estimate" fill="#345c72" radius={[8, 8, 0, 0]} />
                <Bar dataKey="achievableValue" name="Achievable value" fill="#128284" radius={[8, 8, 0, 0]} />
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
                <div key={scenario.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-cedar">{scenario.title}</div>
                      <div className="mt-1 text-xs text-slate-500">{scenarioKeyDetails(scenario)}</div>
                    </div>
                    <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${riskTone(scenario.riskLevel)}`}>{scenario.riskLevel}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div className="text-xs uppercase tracking-[0.14em] text-slate-500">Upside</div>
                      <div className="font-semibold text-slate-700">{formatSignedCurrency(scenario.estimatedUpside)}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.14em] text-slate-500">Verdict</div>
                      <div className="font-semibold text-slate-700">{scenario.verdict}</div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-500">Select scenarios from the table below.</div>
            )}
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Saved scenarios"
        eyebrow="Workspace table"
        description="Each row is a user-created scenario. Use scenario copies the property and improvements back into the active workflow."
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] uppercase tracking-[0.14em] text-slate-500">
                <th className="py-3 pr-4 font-bold">Compare</th>
                <th className="py-3 pr-4 font-bold">Scenario</th>
                <th className="py-3 pr-4 font-bold">Estimate</th>
                <th className="py-3 pr-4 font-bold">Achievable</th>
                <th className="py-3 pr-4 font-bold">Upside</th>
                <th className="py-3 pr-4 font-bold">Budget</th>
                <th className="py-3 pr-4 font-bold">Spend</th>
                <th className="py-3 pr-4 font-bold">Risk</th>
                <th className="py-3 pr-4 font-bold">Verdict</th>
                <th className="py-3 font-bold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((scenario) => (
                <tr key={scenario.id} className="border-b border-slate-100 align-top">
                  <td className="py-3 pr-4">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(scenario.id)}
                      onChange={() => toggleSelected(scenario.id)}
                      className="h-4 w-4 rounded border-slate-300 text-sound-700"
                    />
                  </td>
                  <td className="py-3 pr-4">
                    <div className="font-semibold text-cedar">{scenario.title}</div>
                    <div className="mt-1 text-xs text-slate-500">{formatDate(scenario.createdAt)}</div>
                    <div className="mt-1 text-xs text-slate-500">{scenarioKeyDetails(scenario)}</div>
                  </td>
                  <td className="py-3 pr-4">{formatCurrency(scenario.estimatedValue)}</td>
                  <td className="py-3 pr-4">{formatCurrency(scenario.achievableValue)}</td>
                  <td className="py-3 pr-4">
                    <div>{formatSignedCurrency(scenario.estimatedUpside)}</div>
                    <div className="mt-1 text-xs text-slate-500">{formatPercent(scenario.upsidePercent * 100)}</div>
                  </td>
                  <td className="py-3 pr-4">{formatCurrency(scenario.budget)}</td>
                  <td className="py-3 pr-4">{formatCurrency(scenario.plannedSpend)}</td>
                  <td className="py-3 pr-4">
                    <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${riskTone(scenario.riskLevel)}`}>{scenario.riskLevel}</span>
                  </td>
                  <td className="py-3 pr-4">{scenario.verdict}</td>
                  <td className="py-3">
                    <div className="flex flex-wrap gap-2">
                      <Link
                        to="/plan"
                        onClick={() => onUseScenario(scenario)}
                        className="rounded-lg border border-sound-200 bg-sound-50 px-3 py-1.5 text-xs font-semibold text-cedar transition hover:border-sound-300"
                      >
                        Use scenario
                      </Link>
                      <button
                        type="button"
                        onClick={() => onDeleteScenario(scenario.id)}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:border-rose-200 hover:text-rose-700"
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
