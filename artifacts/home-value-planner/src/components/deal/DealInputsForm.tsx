import { useEffect, useState } from "react";
import { detectMarket, type MarketsResponse, type PlannedFlag, type PropertyInput } from "@vvl/shared";

import { HalifaxUpliftCaveat } from "../HalifaxUpliftCaveat";
import { ImprovementFlagPicker } from "../ImprovementFlagPicker";
import { PropertyFormCard } from "../PropertyFormCard";
import { SectionCard } from "../SectionCard";
import { formatCurrency } from "../../lib/format";
import { updateNumberDraft } from "../../lib/numberDraft";
import type { PropertyFormValidation } from "../../lib/propertyValidation";
import type { DealInputState } from "../../lib/scenarios";

interface DealInputsFormProps {
  property: PropertyInput;
  onPropertyChange: (property: PropertyInput) => void;
  plannedFlags: PlannedFlag[];
  onPlannedFlagsChange: (flags: PlannedFlag[]) => void;
  dealInputs: DealInputState;
  onDealInputsChange: (inputs: DealInputState) => void;
  markets?: MarketsResponse["markets"] | null;
  onPropertyValidationChange: (validation: PropertyFormValidation) => void;
}

export function DealInputsForm({
  property,
  onPropertyChange,
  plannedFlags,
  onPlannedFlagsChange,
  dealInputs,
  onDealInputsChange,
  markets,
  onPropertyValidationChange,
}: DealInputsFormProps) {
  const { askingPrice, budget, timelineMonths } = dealInputs;
  const [askingPriceDraft, setAskingPriceDraft] = useState(String(dealInputs.askingPrice));
  const [budgetDraft, setBudgetDraft] = useState(String(dealInputs.budget));
  const [timelineDraft, setTimelineDraft] = useState(String(dealInputs.timelineMonths));
  const [askingPriceError, setAskingPriceError] = useState<string | null>(null);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const detectedMarket = detectMarket(property.postalCode);

  useEffect(() => {
    setAskingPriceDraft(String(askingPrice));
  }, [askingPrice]);

  useEffect(() => {
    setBudgetDraft(String(budget));
  }, [budget]);

  useEffect(() => {
    setTimelineDraft(String(timelineMonths));
  }, [timelineMonths]);

  return (
    <div className="space-y-6">
      <PropertyFormCard
        property={property}
        onChange={onPropertyChange}
        markets={markets}
        onValidationChange={onPropertyValidationChange}
        sticky={false}
      />

      <SectionCard title="Deal inputs" eyebrow="Investor thesis" description="Keep these numbers conservative; transaction costs are not included yet.">
        <div className="grid gap-4">
          <label className="space-y-2">
            <span className="label">Asking price</span>
            <input
              className="field"
              type="number"
              min={100000}
              value={askingPriceDraft}
              onChange={(event) => {
                setAskingPriceError(
                  updateNumberDraft(
                    event.target.value,
                    setAskingPriceDraft,
                    (nextValue) => onDealInputsChange({ ...dealInputs, askingPrice: nextValue }),
                    100_000,
                  ),
                );
              }}
              onBlur={() => setAskingPriceDraft(String(askingPrice))}
            />
            {askingPriceError ? (
              <p className="text-xs text-danger">{askingPriceError}</p>
            ) : (
              <p className="text-xs tabular-nums text-muted">= {formatCurrency(askingPrice)}</p>
            )}
          </label>
          <label className="space-y-2">
            <span className="label">Renovation budget</span>
            <input
              className="field"
              type="number"
              min={1}
              value={budgetDraft}
              onChange={(event) =>
                setBudgetError(
                  updateNumberDraft(event.target.value, setBudgetDraft, (nextValue) => onDealInputsChange({ ...dealInputs, budget: nextValue }), 1),
                )
              }
              onBlur={() => setBudgetDraft(String(budget))}
            />
            {budgetError ? (
              <p className="text-xs text-danger">{budgetError}</p>
            ) : (
              <p className="text-xs tabular-nums text-muted">= {formatCurrency(budget)}</p>
            )}
          </label>
          <label className="space-y-2">
            <span className="label">Timeline months</span>
            <input
              className="field"
              type="number"
              min={3}
              max={18}
              value={timelineDraft}
              onChange={(event) =>
                setTimelineError(
                  updateNumberDraft(
                    event.target.value,
                    setTimelineDraft,
                    (nextValue) => onDealInputsChange({ ...dealInputs, timelineMonths: nextValue }),
                    3,
                    18,
                  ),
                )
              }
              onBlur={() => setTimelineDraft(String(timelineMonths))}
            />
            {timelineError ? <p className="text-xs text-danger">{timelineError}</p> : null}
          </label>
        </div>
      </SectionCard>

      <SectionCard title="Planned improvements" eyebrow="Renovation scope" description="Select the work that could realistically finish before resale.">
        <ImprovementFlagPicker plannedFlags={plannedFlags} onChange={onPlannedFlagsChange} />
        {detectedMarket === "halifax_maritimes" ? <HalifaxUpliftCaveat variant="deal" /> : null}
      </SectionCard>
    </div>
  );
}
