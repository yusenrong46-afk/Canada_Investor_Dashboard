import { useEffect, useState } from "react";
import type { EstimateResponse, PropertyInput } from "@vvl/shared";

import { getMarketEvidence, type MarketEvidenceResponse } from "../api/client";
import { SectionCard } from "./SectionCard";
import { formatCurrency, formatSignedCurrency } from "../lib/format";

interface MarketEvidencePanelProps {
  property: PropertyInput;
  estimate: EstimateResponse | null;
}

export function MarketEvidencePanel({ property, estimate }: MarketEvidencePanelProps) {
  const [evidence, setEvidence] = useState<MarketEvidenceResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const market = estimate?.market ?? null;
  const fsa = property.postalCode.replace(/\s+/g, "").slice(0, 3).toUpperCase();
  const propertyType = property.propertyType;

  useEffect(() => {
    if (!market) {
      return;
    }

    let active = true;
    setLoading(true);

    getMarketEvidence({ market, fsa, propertyType })
      .then((response) => {
        if (active) {
          setEvidence(response);
        }
      })
      .catch(() => {
        if (active) {
          setEvidence(null);
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
  }, [market, fsa, propertyType]);

  if (!market) {
    return null;
  }

  if (loading && !evidence) {
    return (
      <SectionCard title="Market evidence" eyebrow="Warehouse-backed" description="Aggregates from the training warehouse for this segment.">
        <div className="data-row text-sm text-muted">Loading market evidence...</div>
      </SectionCard>
    );
  }

  if (!evidence || evidence.status !== "ready" || !evidence.rows.length) {
    return null;
  }

  const bestRow = evidence.rows[0];
  const pricePerSqftDelta =
    estimate && bestRow.medianPricePerSqft != null ? Math.round(estimate.pricePerSqft - bestRow.medianPricePerSqft) : null;
  const typicalProfile =
    bestRow.avgLivingAreaSqft != null && bestRow.avgBedrooms != null && bestRow.avgBathrooms != null
      ? `${Math.round(bestRow.avgLivingAreaSqft).toLocaleString()} sqft · ${bestRow.avgBedrooms.toFixed(1)} bd · ${bestRow.avgBathrooms.toFixed(1)} ba`
      : "Not available";
  const builtDate = evidence.generatedAt.slice(0, 10);

  return (
    <SectionCard title="Market evidence" eyebrow="Warehouse-backed" description="Aggregates from the training warehouse for this segment.">
      <div className="space-y-3">
        <div className="data-row">
          <span className="text-sm font-medium text-body">Training rows</span>
          <span className="text-sm font-semibold tabular-nums text-ink">{bestRow.trainingRows.toLocaleString()}</span>
        </div>
        <div className="data-row">
          <span className="text-sm font-medium text-body">Model-ready rows</span>
          <span className="text-sm font-semibold tabular-nums text-ink">{bestRow.modelReadyRows.toLocaleString()}</span>
        </div>
        <div className="data-row">
          <span className="text-sm font-medium text-body">Median value</span>
          <span className="text-sm font-semibold tabular-nums text-ink">
            {bestRow.medianValue != null ? formatCurrency(bestRow.medianValue) : "Not available"}
          </span>
        </div>
        <div className="data-row">
          <span className="text-sm font-medium text-body">Median $/sqft</span>
          <span className="text-sm font-semibold tabular-nums text-ink">
            {bestRow.medianPricePerSqft != null ? formatCurrency(bestRow.medianPricePerSqft) : "Not available"}
          </span>
        </div>
        <div className="data-row">
          <span className="text-sm font-medium text-body">Typical size · beds · baths</span>
          <span className="text-sm font-semibold tabular-nums text-ink">{typicalProfile}</span>
        </div>
        <div className="data-row">
          <span className="text-sm font-medium text-body">Estimate vs segment $/sqft</span>
          <span className={`text-sm font-semibold tabular-nums ${pricePerSqftDelta != null && pricePerSqftDelta < 0 ? "text-danger" : "text-success"}`}>
            {pricePerSqftDelta != null ? formatSignedCurrency(pricePerSqftDelta) : "Not available"}
          </span>
        </div>
        {evidence.scope !== "fsa-property-type" ? (
          <p className="text-sm leading-6 text-muted">City-level fallback — not enough {fsa} observations.</p>
        ) : null}
        <p className="border-t border-line pt-3 text-xs leading-5 text-muted">
          Exported from the DuckDB training mart - built {builtDate} - PVSC/HRM/listing sources
        </p>
      </div>
    </SectionCard>
  );
}
