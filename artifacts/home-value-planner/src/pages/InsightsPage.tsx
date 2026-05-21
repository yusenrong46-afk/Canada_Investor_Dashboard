import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import type { DemoMetricsResponse } from "@vvl/shared";

import { getInsights } from "../api/client";
import { DataQualityPanel } from "../components/DataQualityPanel";
import { MetricCard } from "../components/MetricCard";
import { ModelTrustSummary } from "../components/ModelTrustSummary";
import { SectionCard } from "../components/SectionCard";
import { formatCurrency, formatSignedCurrency } from "../lib/format";

function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildTypeRows(data: DemoMetricsResponse) {
  const groups = new Map<string, number[]>();

  for (const row of data.rows) {
    groups.set(row.propertyType, [...(groups.get(row.propertyType) ?? []), row.estimatedValue]);
  }

  return Array.from(groups.entries()).map(([propertyType, values]) => ({
    propertyType,
    estimatedValue: Math.round(average(values)),
  }));
}

function buildPricePerSqftRows(data: DemoMetricsResponse) {
  return data.rows.map((row) => ({
    propertyType: row.propertyType,
    pricePerSqft: row.pricePerSqft,
  }));
}

export function InsightsPage() {
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

  const typeRows = useMemo(() => (data ? buildTypeRows(data) : []), [data]);
  const pricePerSqftRows = useMemo(() => (data ? buildPricePerSqftRows(data) : []), [data]);

  if (error) {
    return <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{error}</div>;
  }

  if (!data) {
    return <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-soft">Loading insights...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-sound-600">Market & Investment Insights</div>
        <h1 className="font-display text-3xl text-cedar">What do the sample deals say?</h1>
        <p className="max-w-3xl text-sm leading-6 text-slate-500">
          This page turns the demo-safe sample outputs into a simple analyst view: value levels, price-per-square-foot patterns, risk notes,
          and top sample investment scenarios.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Average value" value={formatCurrency(data.summary.averageEstimatedValue)} hint="Across demo sample properties" />
        <MetricCard label="Median value" value={formatCurrency(data.summary.medianEstimatedValue)} hint="Middle sample estimate" />
        <MetricCard label="Avg $/sqft" value={formatCurrency(data.summary.averagePricePerSqft)} hint="Estimated price per square foot" />
        <MetricCard label="Sample properties" value={String(data.summary.samplePropertyCount)} hint="Demo-safe scenarios" />
        <MetricCard label="Warnings" value={String(data.summary.warningCount)} hint="Data-quality and trust notes" />
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

        <ModelTrustSummary modeNote={data.note} />
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
                <Scatter data={data.rows} fill="#128284" />
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
        title="Top Sample Investment Scenarios"
        eyebrow="Analyst table"
        description="This keeps the business question visible: which sample deal looks interesting, and what risk note should I bring up?"
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
              {data.rows.map((row) => (
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

      <DataQualityPanel notes={data.dataQualityNotes} warningCount={data.summary.warningCount} />
    </div>
  );
}
