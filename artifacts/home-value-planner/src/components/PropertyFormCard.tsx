import type { PropertyInput, PropertyType } from "../types";

interface PropertyFormCardProps {
  property: PropertyInput;
  onChange: (property: PropertyInput) => void;
}

const propertyTypeOptions: PropertyType[] = ["Detached", "Townhouse", "Condo", "Duplex"];

export function PropertyFormCard({ property, onChange }: PropertyFormCardProps) {
  const updateNumber = (key: keyof Pick<PropertyInput, "livingAreaSqft" | "bedrooms" | "bathrooms" | "propertyTax" | "knownCurrentValue">, value: string) => {
    const parsed = value === "" ? undefined : Number(value);

    onChange({
      ...property,
      [key]:
        parsed === undefined
          ? key === "propertyTax" || key === "knownCurrentValue"
            ? undefined
            : property[key]
          : parsed,
    });
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
            value={property.livingAreaSqft}
            onChange={(event) => updateNumber("livingAreaSqft", event.target.value)}
          />
        </label>

        <label className="space-y-2">
          <span className="label">Bedrooms</span>
          <input
            className="field"
            type="number"
            min={0}
            value={property.bedrooms}
            onChange={(event) => updateNumber("bedrooms", event.target.value)}
          />
        </label>

        <label className="space-y-2">
          <span className="label">Bathrooms</span>
          <input
            className="field"
            type="number"
            min={0}
            step="0.5"
            value={property.bathrooms}
            onChange={(event) => updateNumber("bathrooms", event.target.value)}
          />
        </label>

        <label className="space-y-2">
          <span className="label">Property tax</span>
          <input
            className="field"
            type="number"
            min={0}
            placeholder="Optional"
            value={property.propertyTax ?? ""}
            onChange={(event) => updateNumber("propertyTax", event.target.value)}
          />
        </label>

        <label className="space-y-2">
          <span className="label">Known current value</span>
          <input
            className="field"
            type="number"
            min={0}
            placeholder="Optional"
            value={property.knownCurrentValue ?? ""}
            onChange={(event) => updateNumber("knownCurrentValue", event.target.value)}
          />
        </label>
      </div>
    </div>
  );
}
