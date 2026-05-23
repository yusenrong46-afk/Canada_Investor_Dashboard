import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import type { DemoMetricsResponse } from "@vvl/shared";

import { getInsights } from "../api/client";
import { DataQualityPanel } from "../components/DataQualityPanel";
import { MetricCard } from "../components/MetricCard";
import { ModelTrustSummary } from "../components/ModelTrustSummary";
import { SectionCard } from "../components/SectionCard";
import { formatCurrency, formatSignedCurrency } from "../lib/format";
import { summarizeScenarios, type ScenarioRecord } from "../lib/scenarios";

interface InsightRow {
  id: string;
  propertyType: string;
  livingAreaSqft: number;
  bedrooms: number;
  bathrooms: number;
  estimatedValue: number;
  pricePerSqft: number;
  budget: number;
  targetPrice: number;
  estimatedUpside: number;
  riskLevel: string;
  verdict: string;
  warnings: string[];
}

interface InsightData {
  note: string;
  summary: DemoMetricsResponse["summary"];
  rows: InsightRow[];
  dataQualityNotes: string[];
}

interface InsightsPageProps {
  scenarios: ScenarioRecord[];
}

function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildTypeRows(data: InsightData) {
  const groups = new Map<string, number[]>();

  for (const row of data.rows) {
    groups.set(row.propertyType, [...(groups.get(row.propertyType) ?? []), row.estimatedValue]);
  }

  return Array.from(groups.entries()).map(([propertyType, values]) => ({
    propertyType,
    estimatedValue: Math.round(average(values)),
  }));
}

function buildPricePerSqftRows(data: InsightData) {
  return data.rows.map((row) => ({
    propertyType: row.propertyType,
    pricePerSqft: row.pricePerSqft,
  }));
}

function buildScenarioInsightData(scenarios: ScenarioRecord[]): InsightData {
  const summary = summarizeScenarios(scenarios);

  return {
    note: "This view is built from scenarios saved in the local workspace.",
    summary: {
      averageEstimatedValue: summary.averageEstimatedValue,
      medianEstimatedValue: summary.medianEstimatedValue,
      averagePricePerSqft: summary.averagePricePerSqft,
      samplePropertyCount: summary.samplePropertyCount,
      warningCount: summary.warningCount,
    },
    rows: scenarios.map((scenario) => ({
      id: scenario.id,
      propertyType: scenario.property.propertyType,
      livingAreaSqft: scenario.property.livingAreaSqft,
      bedrooms: scenario.property.bedrooms,
      bathrooms: scenario.property.bathrooms,
      estimatedValue: scenario.estimatedValue,
      pricePerSqft: scenario.pricePerSqft,
      budget: scenario.budget,
      targetPrice: scenario.targetPrice ?? scenario.askingPrice ?? scenario.achievableValue,
      estimatedUpside: scenario.estimatedUpside,
      riskLevel: scenario.riskLevel,
      verdict: scenario.verdict,
      warnings: scenario.warnings,
    })),
    dataQualityNotes: [
      "Insights are calculated from saved user scenarios in this browser.",
      "The base model estimates listing value, not final sale price.",
      "Saved scenarios still need comparable-sale review and transaction-cost checks.",
    ],
  };
}

export function InsightsPage({ scenarios }: InsightsPageProps) {
  const [data, setData] = useState<DemoMetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    getInsights()
      .then((response) => {
        if (active) {
          setData(response);
        }
      })
      .catch((caughtError: Error) => {
        if (active) {
          setError(caughtError.message);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const displayData = useMemo<InsightData | null>(() => {
    if (scenarios.length) {
      return buildScenarioInsightData(scenarios);
    }
    return data;
  }, [data, scenarios]);
  const typeRows = useMemo(() => (displayData ? buildTypeRows(displayData) : []), [displayData]);
  const pricePerSqftRows = useMemo(() => (displayData ? buildPricePerSqftRows(displayData) : []), [displayData]);

  if (error) {
    return <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{error}</div>;
  }

  if (!displayData) {
    return <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-soft">Loading insights...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-sound-600">Market & Investment Insights</div>
        <h1 className="font-display text-3xl text-cedar">{scenarios.length ? "What do my saved scenarios say?" : "What do the sample deals say?"}</h1>
        <p className="max-w-3xl text-sm leading-6 text-slate-500">
          This page turns saved scenario outputs into a simple analyst view: value levels, price-per-square-foot patterns, risk notes,
          and top investment scenarios.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Average value" value={formatCurrency(displayData.summary.averageEstimatedValue)} hint="Across visible scenarios" />
        <MetricCard label="Median value" value={formatCurrency(displayData.summary.medianEstimatedValue)} hint="Middle scenario estimate" />
        <MetricCard label="Avg $/sqft" value={formatCurrency(displayData.summary.averagePricePerSqft)} hint="Estimated price per square foot" />
        <MetricCard label="Scenarios" value={String(displayData.summary.samplePropertyCount)} hint={scenarios.length ? "Saved user runs" : "Demo-safe samples"} />
        <MetricCard label="Warnings" value={String(displayData.summary.warningCount)} hint="Data-quality and trust notes" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr),minmax(340px,1fr)]">
        <SectionCard
          title="Estimated value by property type"
          eyebrow="Portfolio view"
          description="A quick comparison of average sample value by property type."
        >
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={typeRows} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="propertyType" tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`} width={72} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                <Bar dataKey="estimatedValue" fill="#128284" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <ModelTrustSummary modeNote={displayData.note} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard
          title="Living area vs estimated value"
          eyebrow="Size signal"
          description="The scatter view helps show how the sample values move with square footage."
        >
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="livingAreaSqft" name="Sqft" tickLine={false} axisLine={false} />
                <YAxis dataKey="estimatedValue" name="Value" tickFormatter={(value) => `$${Math.round(Number(value) / 1000)}k`} width={72} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value, name) => (name === "Value" ? formatCurrency(Number(value)) : Number(value).toLocaleString())} />
                <Scatter data={displayData.rows} fill="#128284" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard
          title="Price per square foot distribution"
          eyebrow="Value density"
          description="A simple sample-level view of estimated dollars per square foot."
        >
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pricePerSqftRows} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="propertyType" tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(value) => `$${Number(value)}`} width={72} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                <Bar dataKey="pricePerSqft" fill="#345c72" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title={scenarios.length ? "Top Saved Investment Scenarios" : "Top Sample Investment Scenarios"}
        eyebrow="Analyst table"
        description="This keeps the business question visible: which deal looks interesting, and what risk note should I bring up?"
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] uppercase tracking-[0.14em] text-slate-500">
                <th className="py-3 pr-4 font-bold">Property type</th>
                <th className="py-3 pr-4 font-bold">Living area</th>
                <th className="py-3 pr-4 font-bold">Beds</th>
                <th className="py-3 pr-4 font-bold">Baths</th>
                <th className="py-3 pr-4 font-bold">Estimated value</th>
                <th className="py-3 pr-4 font-bold">Budget</th>
                <th className="py-3 pr-4 font-bold">Target price</th>
                <th className="py-3 pr-4 font-bold">Estimated upside</th>
                <th className="py-3 pr-4 font-bold">Risk</th>
                <th className="py-3 font-bold">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {displayData.rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100">
                  <td className="py-3 pr-4 font-semibold text-cedar">{row.propertyType}</td>
                  <td className="py-3 pr-4">{row.livingAreaSqft.toLocaleString()} sqft</td>
                  <td className="py-3 pr-4">{row.bedrooms}</td>
                  <td className="py-3 pr-4">{row.bathrooms}</td>
                  <td className="py-3 pr-4">{formatCurrency(row.estimatedValue)}</td>
                  <td className="py-3 pr-4">{formatCurrency(row.budget)}</td>
                  <td className="py-3 pr-4">{formatCurrency(row.targetPrice)}</td>
                  <td className="py-3 pr-4">{formatSignedCurrency(row.estimatedUpside)}</td>
                  <td className="py-3 pr-4">{row.riskLevel}</td>
                  <td className="py-3">{row.verdict}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <DataQualityPanel notes={displayData.dataQualityNotes} warningCount={displayData.summary.warningCount} />
    </div>
  );
}
