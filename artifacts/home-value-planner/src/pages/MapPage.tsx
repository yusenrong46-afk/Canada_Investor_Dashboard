import { useEffect, useState } from "react";
import { MapContainer, Polygon, TileLayer, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { marketCatalog, marketValues, type MarketId, type MarketMapCell, type MarketMapResponse } from "@vvl/shared";

import { getMarketMap } from "../api/client";
import { InlineAlert } from "../components/InlineAlert";
import { SectionCard } from "../components/SectionCard";
import { formatCurrency } from "../lib/format";

// Ocean ramp endpoints (brand-100 -> brand-900) so cell shading matches the coastal palette.
const rampLow: [number, number, number] = [204, 236, 235];
const rampHigh: [number, number, number] = [11, 78, 76];

function rampColor(value: number, domain: [number, number]): string {
  const [lo, hi] = domain;
  const span = hi - lo;
  const t = span > 0 ? Math.min(1, Math.max(0, (value - lo) / span)) : 0.5;
  const channels = rampLow.map((low, index) => Math.round(low + (rampHigh[index] - low) * t));
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}

interface MapLegendProps {
  domain: [number, number];
}

function MapLegend({ domain }: MapLegendProps) {
  return (
    <div className="card p-4">
      <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-muted">Median $/sqft</div>
      <div
        className="mt-3 h-3 rounded-pill"
        style={{ background: `linear-gradient(to right, rgb(${rampLow.join(", ")}), rgb(${rampHigh.join(", ")}))` }}
      />
      <div className="mt-2 flex items-center justify-between text-xs font-semibold tabular-nums text-body">
        <span>{formatCurrency(domain[0])}</span>
        <span>{formatCurrency(domain[1])}</span>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted">H3 resolution 8 - cells with &gt;= 5 model-ready observations.</p>
    </div>
  );
}

export function MapPage() {
  const [market, setMarket] = useState<MarketId>("vancouver");
  const [response, setResponse] = useState<MarketMapResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<MarketMapCell | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setSelectedCell(null);

    getMarketMap(market)
      .then((nextResponse) => {
        if (active) {
          setResponse(nextResponse);
        }
      })
      .catch((caughtError: Error) => {
        if (active) {
          setResponse(null);
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
  }, [market]);

  const ready = response?.status === "ready" ? response : null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="eyebrow">Market map</div>
        <h1 className="font-display text-3xl text-ink">Where the model actually has evidence</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted">
          Each hexagon is an H3 cell with at least five model-ready observations from the analytics warehouse. Shading shows the median
          price per square foot, so thin-coverage areas stay blank instead of being smoothed over.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Market">
        {marketValues.map((marketId) => {
          const active = marketId === market;
          return (
            <button
              key={marketId}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setMarket(marketId)}
              className={`rounded-pill border px-3 py-2 text-sm font-semibold transition ${
                active
                  ? "border-brand-400 bg-brand-50 text-brand-700 ring-1 ring-brand-200"
                  : "border-line bg-surface text-body hover:border-brand-200 hover:text-ink"
              }`}
            >
              {marketCatalog[marketId].label}
            </button>
          );
        })}
      </div>

      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}

      {response?.status === "unavailable" ? (
        <div className="card px-4 py-3 text-sm text-muted">Map data is unavailable for this deployment: {response.message}</div>
      ) : null}

      {loading && !ready ? <div className="card px-4 py-3 text-sm text-muted">Loading map cells...</div> : null}

      {ready ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr),340px]">
          <div className="card overflow-hidden">
            {/* Remount the map when the market changes so center and zoom apply cleanly. */}
            <MapContainer
              key={ready.market}
              center={ready.center}
              zoom={ready.zoom}
              scrollWheelZoom
              className="h-[60vh] min-h-[420px] w-full lg:h-[calc(100vh-280px)]"
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {ready.cells.map((cell) => {
                const color = rampColor(cell.medianPricePerSqft, ready.pricePerSqftDomain);
                return (
                  <Polygon
                    key={cell.h3}
                    positions={cell.boundary}
                    pathOptions={{ color: "#0b6e6b", weight: 1, opacity: 0.5, fillColor: color, fillOpacity: 0.55 }}
                    eventHandlers={{ click: () => setSelectedCell(cell) }}
                  >
                    <Tooltip sticky>
                      <div className="text-xs font-semibold">{formatCurrency(cell.medianPricePerSqft)} / sqft median</div>
                      <div className="text-xs">Median value {formatCurrency(cell.medianValue)}</div>
                      <div className="text-xs">{cell.rows} observations</div>
                    </Tooltip>
                  </Polygon>
                );
              })}
            </MapContainer>
          </div>

          <div className="space-y-4">
            <MapLegend domain={ready.pricePerSqftDomain} />

            <label className="block space-y-2">
              <span className="label">Select cell (keyboard)</span>
              <select
                className="field"
                value={selectedCell?.h3 ?? ""}
                onChange={(event) => {
                  const nextCell = ready.cells.find((cell) => cell.h3 === event.target.value) ?? null;
                  setSelectedCell(nextCell);
                }}
              >
                <option value="">Choose a map cell</option>
                {ready.cells.map((cell) => (
                  <option key={cell.h3} value={cell.h3}>
                    {cell.h3} · {formatCurrency(cell.medianPricePerSqft)}/sqft · {cell.rows} rows
                  </option>
                ))}
              </select>
            </label>

            <SectionCard
              title={selectedCell ? `Cell ${selectedCell.h3}` : "Pick a cell"}
              eyebrow={ready.label}
              description={selectedCell ? undefined : "Click any hexagon to see its median value, price per square foot, and how many observations sit behind it."}
            >
              {selectedCell ? (
                <div className="space-y-3">
                  <div className="data-row">
                    <span className="text-sm text-muted">Median value</span>
                    <span className="text-sm font-semibold tabular-nums text-ink">{formatCurrency(selectedCell.medianValue)}</span>
                  </div>
                  <div className="data-row">
                    <span className="text-sm text-muted">Median $/sqft</span>
                    <span className="text-sm font-semibold tabular-nums text-ink">{formatCurrency(selectedCell.medianPricePerSqft)}</span>
                  </div>
                  <div className="data-row">
                    <span className="text-sm text-muted">Observations</span>
                    <span className="text-sm font-semibold tabular-nums text-ink">{selectedCell.rows}</span>
                  </div>
                </div>
              ) : null}
              <p className="mt-4 text-xs leading-5 text-muted">
                Source: {ready.source} · Generated {new Date(ready.generatedAt).toLocaleDateString("en-CA")}
              </p>
            </SectionCard>
          </div>
        </div>
      ) : null}
    </div>
  );
}
