import { useEffect, useState } from "react";
import {
  detectMarket,
  marketCatalog,
  marketValues,
  propertyTypeValues,
  type MarketId,
  type MarketsResponse,
  type PropertyInput,
  type PropertyType,
} from "@vvl/shared";

import { defaultPropertyByMarket } from "../lib/defaults";

interface PropertyFormCardProps {
  property: PropertyInput;
  onChange: (property: PropertyInput) => void;
  markets?: MarketsResponse["markets"] | null;
}

const propertyTypeOptions = [...propertyTypeValues];
const currentYear = new Date().getFullYear();
type NumberFieldKey = keyof Pick<
  PropertyInput,
  "livingAreaSqft" | "bedrooms" | "bathrooms" | "yearBuilt" | "knownCurrentValue"
>;

const numberFieldRanges: Record<NumberFieldKey, { min: number; max?: number; optional?: boolean; integer?: boolean }> = {
  livingAreaSqft: { min: 250, max: 10_000, integer: true },
  bedrooms: { min: 0, max: 10, integer: true },
  bathrooms: { min: 0, max: 10 },
  yearBuilt: { min: 1800, max: currentYear, optional: true, integer: true },
  knownCurrentValue: { min: 1, optional: true, integer: true },
};

function toDraft(value: number | undefined): string {
  return value == null ? "" : String(value);
}

export function PropertyFormCard({ property, onChange, markets }: PropertyFormCardProps) {
  const detectedMarket = detectMarket(property.postalCode);
  // Remember the last pill the user clicked so an empty or partial postal code keeps the chosen market.
  const [pickedMarket, setPickedMarket] = useState<MarketId>(detectedMarket ?? "vancouver");
  const activeMarket = detectedMarket ?? pickedMarket;
  const marketInfo = marketCatalog[activeMarket];
  const [numberDrafts, setNumberDrafts] = useState<Record<NumberFieldKey, string>>({
    livingAreaSqft: toDraft(property.livingAreaSqft),
    bedrooms: toDraft(property.bedrooms),
    bathrooms: toDraft(property.bathrooms),
    yearBuilt: toDraft(property.yearBuilt),
    knownCurrentValue: toDraft(property.knownCurrentValue),
  });

  useEffect(() => {
    setNumberDrafts({
      livingAreaSqft: toDraft(property.livingAreaSqft),
      bedrooms: toDraft(property.bedrooms),
      bathrooms: toDraft(property.bathrooms),
      yearBuilt: toDraft(property.yearBuilt),
      knownCurrentValue: toDraft(property.knownCurrentValue),
    });
  }, [property.bathrooms, property.bedrooms, property.knownCurrentValue, property.livingAreaSqft, property.yearBuilt]);

  const updateNumber = (key: NumberFieldKey, value: string) => {
    // Keep a draft string so users can clear or partially type a number without committing invalid app state.
    setNumberDrafts((current) => ({ ...current, [key]: value }));

    const range = numberFieldRanges[key];
    if (value.trim() === "") {
      if (range.optional) {
        onChange({ ...property, [key]: undefined });
      }
      return;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return;
    }

    if (parsed < range.min || (range.max != null && parsed > range.max) || (range.integer && !Number.isInteger(parsed))) {
      return;
    }

    onChange({ ...property, [key]: parsed });
  };

  const resetNumber = (key: NumberFieldKey) => {
    setNumberDrafts((current) => ({ ...current, [key]: toDraft(property[key]) }));
  };

  const selectMarket = (marketId: MarketId) => {
    setPickedMarket(marketId);
    if (marketId !== activeMarket) {
      onChange({ ...defaultPropertyByMarket[marketId] });
    }
  };

  return (
    <div className="card-pad xl:sticky xl:top-28">
      <div className="mb-5">
        <div className="eyebrow">Home profile</div>
        <h2 className="mt-1 font-display text-xl text-ink">Enter the home details</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Use the current condition of the home. The optional value field is only for your own comparison.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <span className="label">Market</span>
          <div className="grid grid-cols-2 gap-2">
            {marketValues.map((marketId) => {
              const liveStatus = markets?.find((item) => item.id === marketId);
              const liveOnly = liveStatus?.status === "live-only";
              const active = marketId === activeMarket;
              return (
                <button
                  key={marketId}
                  type="button"
                  disabled={liveOnly}
                  title={liveOnly ? liveStatus?.note : undefined}
                  onClick={() => selectMarket(marketId)}
                  className={`rounded-pill border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:border-line disabled:bg-canvas disabled:text-muted ${
                    active
                      ? "border-brand-400 bg-brand-50 text-brand-700 ring-1 ring-brand-200"
                      : "border-line bg-surface text-body hover:border-slate-300 hover:text-ink"
                  }`}
                >
                  {marketCatalog[marketId].label}
                </button>
              );
            })}
          </div>
        </div>

        <label className="space-y-2 sm:col-span-2">
          <span className="label">Postal code</span>
          <input
            className="field"
            type="text"
            value={property.postalCode}
            placeholder={marketInfo.postalPlaceholder}
            onChange={(event) => onChange({ ...property, postalCode: event.target.value.toUpperCase() })}
          />
          <p className="text-xs text-muted">{marketInfo.postalHint}</p>
        </label>

        <label className="space-y-2">
          <span className="label">Property type</span>
          <select
            value={property.propertyType}
            onChange={(event) => onChange({ ...property, propertyType: event.target.value as PropertyType })}
            className="field"
          >
            {propertyTypeOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-2">
          <span className="label">Living area (sqft)</span>
          <input
            className="field"
            type="number"
            min={250}
            value={numberDrafts.livingAreaSqft}
            onChange={(event) => updateNumber("livingAreaSqft", event.target.value)}
            onBlur={() => resetNumber("livingAreaSqft")}
          />
        </label>

        <label className="space-y-2">
          <span className="label">Bedrooms</span>
          <input
            className="field"
            type="number"
            min={0}
            value={numberDrafts.bedrooms}
            onChange={(event) => updateNumber("bedrooms", event.target.value)}
            onBlur={() => resetNumber("bedrooms")}
          />
        </label>

        <label className="space-y-2">
          <span className="label">Bathrooms</span>
          <input
            className="field"
            type="number"
            min={0}
            step="0.5"
            value={numberDrafts.bathrooms}
            onChange={(event) => updateNumber("bathrooms", event.target.value)}
            onBlur={() => resetNumber("bathrooms")}
          />
        </label>

        <label className="space-y-2">
          <span className="label">Year built</span>
          <input
            className="field"
            type="number"
            min={1800}
            max={currentYear}
            placeholder="Optional"
            value={numberDrafts.yearBuilt}
            onChange={(event) => updateNumber("yearBuilt", event.target.value)}
            onBlur={() => resetNumber("yearBuilt")}
          />
        </label>

        <label className="space-y-2">
          <span className="label">Known current value</span>
          <input
            className="field"
            type="number"
            min={1}
            placeholder="Optional"
            value={numberDrafts.knownCurrentValue}
            onChange={(event) => updateNumber("knownCurrentValue", event.target.value)}
            onBlur={() => resetNumber("knownCurrentValue")}
          />
        </label>
      </div>
    </div>
  );
}
