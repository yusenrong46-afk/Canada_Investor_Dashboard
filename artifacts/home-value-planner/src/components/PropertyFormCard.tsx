import { useEffect, useState } from "react";

import type { PropertyInput, PropertyType } from "../types";

interface PropertyFormCardProps {
  property: PropertyInput;
  onChange: (property: PropertyInput) => void;
}

const propertyTypeOptions: PropertyType[] = ["Detached", "Townhouse", "Condo", "Duplex"];
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

export function PropertyFormCard({ property, onChange }: PropertyFormCardProps) {
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

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-soft xl:sticky xl:top-24">
      <div className="mb-5">
        <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-sound-600">Home profile</div>
        <h2 className="mt-1 font-display text-xl text-cedar">Enter the home details</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Use the current condition of the home. The optional value field is only for your own comparison.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 sm:col-span-2">
          <span className="label">Postal code</span>
          <input
            className="field"
            type="text"
            value={property.postalCode}
            placeholder="V6B 1X9"
            onChange={(event) => onChange({ ...property, postalCode: event.target.value.toUpperCase() })}
          />
          <p className="text-xs text-slate-500">Use a Vancouver postal code in the V5 or V6 area.</p>
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
