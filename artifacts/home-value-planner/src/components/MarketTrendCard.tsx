import { useEffect, useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MarketTrendResponse } from "@vvl/shared";

import { getMarketTrend } from "../api/client";
import { MetricCard } from "./MetricCard";
import { SectionCard } from "./SectionCard";
import { formatPercent } from "../lib/format";

interface MarketTrendCardProps {
  market: string | null;
}

export function MarketTrendCard({ market }: MarketTrendCardProps) {
  const [trend, setTrend] = useState<MarketTrendResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!market) {
      return;
    }

    let active = true;
    setLoading(true);

    getMarketTrend(market)
      .then((response) => {
        if (active) {
          setTrend(response);
        }
      })
      .catch(() => {
        if (active) {
          setTrend(null);
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
  }, [market]);

  const ready = trend?.status === "ready" ? trend : null;

  const chartData = useMemo(
    () =>
      (ready?.points ?? []).map((point) => ({
        period: point.period,
        indexValue: point.indexValue,
        forecastValue: point.forecastValue,
        forecastBand: point.forecastLow != null && point.forecastHigh != null ? [point.forecastLow, point.forecastHigh] : undefined,
      })),
    [ready],
  );

  if (!market) {
    return null;
  }

  if (loading && !ready) {
    return (
      <SectionCard title="Market trend" eyebrow="Index history & forecast">
        <div className="data-row text-sm text-muted">Loading market trend...</div>
      </SectionCard>
    );
  }

  if (!ready || !ready.points.length) {
    return null;
  }

  const lastIndexPoint = [...ready.points].reverse().find((point) => point.indexValue != null) ?? null;
  const horizonPoint = [...ready.points].reverse().find((point) => point.forecastValue != null) ?? null;
  const modeledChange =
    lastIndexPoint?.indexValue != null && horizonPoint?.forecastValue != null
      ? horizonPoint.forecastValue / lastIndexPoint.indexValue - 1
      : null;

  return (
    <SectionCard
      title="Market trend"
      eyebrow="Index history & forecast"
      description={`${ready.marketLabel} price-index history with a modeled forecast to ${horizonPoint?.period ?? "the horizon"}.`}
    >
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="period" minTickGap={48} tickLine={false} axisLine={false} tick={{ fill: "#94a3b8", fontSize: 12 }} />
            <YAxis
              domain={["auto", "auto"]}
              width={56}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#94a3b8", fontSize: 12 }}
              tickFormatter={(value) => Number(value).toFixed(0)}
            />
            <Tooltip
              formatter={(value) =>
                Array.isArray(value) ? `${Number(value[0]).toFixed(1)} to ${Number(value[1]).toFixed(1)}` : Number(value).toFixed(1)
              }
            />
            <Area type="monotone" dataKey="forecastBand" name="Forecast interval" stroke="none" fill="#0d9488" fillOpacity={0.15} />
            <Line type="monotone" dataKey="indexValue" name="Index" stroke="#0d9488" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="forecastValue" name="Forecast" stroke="#0f766e" strokeWidth={2} strokeDasharray="6 4" dot={false} />
            <ReferenceLine
              x={ready.baselinePeriod}
              stroke="#94a3b8"
              strokeDasharray="4 4"
              label={{ value: "latest data", fill: "#94a3b8", fontSize: 11, position: "insideTopLeft" }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-3 text-xs leading-5 text-muted">
        {ready.method} · {ready.dataSource} · {ready.license}
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <MetricCard
          label="12-month modeled change"
          tone={modeledChange != null ? (modeledChange >= 0 ? "success" : "danger") : "neutral"}
          value={modeledChange != null ? `${modeledChange >= 0 ? "+" : ""}${formatPercent(modeledChange * 100, 1)}` : "Not available"}
          hint={
            lastIndexPoint && horizonPoint ? `${lastIndexPoint.period} actual to ${horizonPoint.period} forecast` : "Forecast not available"
          }
        />
        <MetricCard
          label="Forecast band at horizon"
          value={
            horizonPoint?.forecastLow != null && horizonPoint.forecastHigh != null
              ? `${horizonPoint.forecastLow.toFixed(1)} – ${horizonPoint.forecastHigh.toFixed(1)}`
              : "Not available"
          }
          hint={horizonPoint ? `Index level range at ${horizonPoint.period}` : "Forecast not available"}
        />
      </div>
    </SectionCard>
  );
}
