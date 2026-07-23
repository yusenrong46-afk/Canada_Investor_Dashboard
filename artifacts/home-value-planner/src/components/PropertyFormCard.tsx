import { useEffect, useMemo, useRef, useState } from "react";
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
import { validatePropertyInput, type PropertyFieldKey, type PropertyFormValidation, type PropertyValidationErrors } from "../lib/propertyValidation";

interface PropertyFormCardProps {
  property: PropertyInput;
  onChange: (property: PropertyInput) => void;
  markets?: MarketsResponse["markets"] | null;
  onValidationChange?: (validation: PropertyFormValidation) => void;
  sticky?: boolean;
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

const numberFieldMessages: Record<NumberFieldKey, string> = {
  livingAreaSqft: "Enter 250 to 10,000 sqft.",
  bedrooms: "Enter 0 to 10 bedrooms.",
  bathrooms: "Enter 0 to 10 bathrooms.",
  yearBuilt: `Enter a year from 1800 to ${currentYear}.`,
  knownCurrentValue: "Enter a positive current value.",
};

function toDraft(value: number | undefined): string {
  return value == null ? "" : String(value);
}

function validateNumberDraft(key: NumberFieldKey, value: string): string | null {
  const range = numberFieldRanges[key];
  const trimmedValue = value.trim();

  if (trimmedValue === "") {
    return range.optional ? null : "Finish this field to update results.";
  }

  const parsed = Number(trimmedValue);
  if (!Number.isFinite(parsed)) {
    return "Enter a valid number.";
  }

  if (range.integer && !Number.isInteger(parsed)) {
    return "Enter a whole number.";
  }

  if (parsed < range.min || (range.max != null && parsed > range.max)) {
    return numberFieldMessages[key];
  }

  return null;
}

function mergeValidation(property: PropertyInput, numberDrafts: Record<NumberFieldKey, string>): PropertyFormValidation {
  const schemaValidation = validatePropertyInput(property);
  const errors: PropertyValidationErrors = { ...schemaValidation.errors };

  (Object.keys(numberDrafts) as NumberFieldKey[]).forEach((key) => {
    const draftError = validateNumberDraft(key, numberDrafts[key]);
    if (draftError) {
      errors[key] = draftError;
    }
  });

  const message = Object.values(errors)[0];
  return {
    valid: !message,
    errors,
    message,
  };
}

function fieldErrorId(field: PropertyFieldKey): string {
  return `property-${field}-error`;
}

function fieldClass(error?: string): string {
  return error ? "field border-danger/50 focus:border-danger focus:ring-danger/10" : "field";
}

function FieldError({ field, message }: { field: PropertyFieldKey; message?: string }) {
  if (!message) {
    return null;
  }

  return (
    <p id={fieldErrorId(field)} className="text-xs font-medium text-danger">
      {message}
    </p>
  );
}

export function PropertyFormCard({ property, onChange, markets, onValidationChange, sticky = true }: PropertyFormCardProps) {
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
  const latestPropertyRef = useRef(property);

  useEffect(() => {
    latestPropertyRef.current = property;
  }, [property]);

  useEffect(() => {
    setNumberDrafts({
      livingAreaSqft: toDraft(property.livingAreaSqft),
      bedrooms: toDraft(property.bedrooms),
      bathrooms: toDraft(property.bathrooms),
      yearBuilt: toDraft(property.yearBuilt),
      knownCurrentValue: toDraft(property.knownCurrentValue),
    });
  }, [property.bathrooms, property.bedrooms, property.knownCurrentValue, property.livingAreaSqft, property.yearBuilt]);

  const validation = useMemo(() => mergeValidation(property, numberDrafts), [numberDrafts, property]);

  useEffect(() => {
    onValidationChange?.(validation);
  }, [onValidationChange, validation]);

  useEffect(
    () => () => {
      onValidationChange?.(validatePropertyInput(latestPropertyRef.current));
    },
    [onValidationChange],
  );

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
    <div className={`card-pad ${sticky ? "xl:sticky xl:top-28" : ""}`}>
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
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Market">
            {marketValues.map((marketId) => {
              const liveStatus = markets?.find((item) => item.id === marketId);
              const liveOnly = liveStatus?.status === "live-only";
              const active = marketId === activeMarket;
              return (
                <button
                  key={marketId}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={liveOnly}
                  title={liveOnly ? liveStatus?.note : undefined}
                  onClick={() => selectMarket(marketId)}
                  className={`rounded-pill border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:border-line disabled:bg-canvas disabled:text-muted ${
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
        </div>

        <label className="space-y-2 sm:col-span-2">
          <span className="label">Postal code</span>
          <input
            aria-describedby={`property-postal-hint ${validation.errors.postalCode ? fieldErrorId("postalCode") : ""}`.trim()}
            aria-invalid={Boolean(validation.errors.postalCode)}
            className={fieldClass(validation.errors.postalCode)}
            type="text"
            value={property.postalCode}
            placeholder={marketInfo.postalPlaceholder}
            onChange={(event) => onChange({ ...property, postalCode: event.target.value.toUpperCase() })}
          />
          <p id="property-postal-hint" className="text-xs text-muted">{marketInfo.postalHint}</p>
          <FieldError field="postalCode" message={validation.errors.postalCode} />
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
            aria-describedby={validation.errors.livingAreaSqft ? fieldErrorId("livingAreaSqft") : undefined}
            aria-invalid={Boolean(validation.errors.livingAreaSqft)}
            className={fieldClass(validation.errors.livingAreaSqft)}
            type="number"
            min={250}
            max={10_000}
            value={numberDrafts.livingAreaSqft}
            onChange={(event) => updateNumber("livingAreaSqft", event.target.value)}
            onBlur={() => resetNumber("livingAreaSqft")}
          />
          <FieldError field="livingAreaSqft" message={validation.errors.livingAreaSqft} />
        </label>

        <label className="space-y-2">
          <span className="label">Bedrooms</span>
          <input
            aria-describedby={validation.errors.bedrooms ? fieldErrorId("bedrooms") : undefined}
            aria-invalid={Boolean(validation.errors.bedrooms)}
            className={fieldClass(validation.errors.bedrooms)}
            type="number"
            min={0}
            max={10}
            value={numberDrafts.bedrooms}
            onChange={(event) => updateNumber("bedrooms", event.target.value)}
            onBlur={() => resetNumber("bedrooms")}
          />
          <FieldError field="bedrooms" message={validation.errors.bedrooms} />
        </label>

        <label className="space-y-2">
          <span className="label">Bathrooms</span>
          <input
            aria-describedby={validation.errors.bathrooms ? fieldErrorId("bathrooms") : undefined}
            aria-invalid={Boolean(validation.errors.bathrooms)}
            className={fieldClass(validation.errors.bathrooms)}
            type="number"
            min={0}
            max={10}
            step="0.5"
            value={numberDrafts.bathrooms}
            onChange={(event) => updateNumber("bathrooms", event.target.value)}
            onBlur={() => resetNumber("bathrooms")}
          />
          <FieldError field="bathrooms" message={validation.errors.bathrooms} />
        </label>

        <label className="space-y-2">
          <span className="label">Year built</span>
          <input
            aria-describedby={validation.errors.yearBuilt ? fieldErrorId("yearBuilt") : undefined}
            aria-invalid={Boolean(validation.errors.yearBuilt)}
            className={fieldClass(validation.errors.yearBuilt)}
            type="number"
            min={1800}
            max={currentYear}
            placeholder="Optional"
            value={numberDrafts.yearBuilt}
            onChange={(event) => updateNumber("yearBuilt", event.target.value)}
            onBlur={() => resetNumber("yearBuilt")}
          />
          <FieldError field="yearBuilt" message={validation.errors.yearBuilt} />
        </label>

        <label className="space-y-2">
          <span className="label">Known current value</span>
          <input
            aria-describedby={validation.errors.knownCurrentValue ? fieldErrorId("knownCurrentValue") : undefined}
            aria-invalid={Boolean(validation.errors.knownCurrentValue)}
            className={fieldClass(validation.errors.knownCurrentValue)}
            type="number"
            min={1}
            placeholder="Optional"
            value={numberDrafts.knownCurrentValue}
            onChange={(event) => updateNumber("knownCurrentValue", event.target.value)}
            onBlur={() => resetNumber("knownCurrentValue")}
          />
          <FieldError field="knownCurrentValue" message={validation.errors.knownCurrentValue} />
        </label>
      </div>
    </div>
  );
}
