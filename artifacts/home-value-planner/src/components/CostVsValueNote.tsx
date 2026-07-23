import { improvementCatalog, type PlannedFlag } from "@vvl/shared";

import { formatCurrency } from "../lib/format";
import { InlineAlert } from "./InlineAlert";

interface CostVsValueNoteProps {
  plannedFlags: PlannedFlag[];
  upliftValue: number | null | undefined;
  market?: string | null;
  /** When true, costs can stack while uplift may not (Halifax shared category). */
  nonAdditiveUplift?: boolean;
}

export function assumedCatalogSpend(plannedFlags: PlannedFlag[]): number {
  return plannedFlags.reduce((sum, flag) => sum + improvementCatalog[flag].defaultCost, 0);
}

export function CostVsValueNote({ plannedFlags, upliftValue, market, nonAdditiveUplift }: CostVsValueNoteProps) {
  if (!plannedFlags.length || upliftValue == null) {
    return null;
  }

  const assumedCost = assumedCatalogSpend(plannedFlags);
  if (assumedCost <= 0) {
    return null;
  }

  const underwater = upliftValue < assumedCost;
  const halifax = market === "halifax_maritimes" || nonAdditiveUplift;

  return (
    <div className="space-y-3">
      <div className="rounded-field border border-line bg-canvas px-4 py-3 text-sm leading-6 text-body">
        <div className="font-semibold text-ink">Cost vs value</div>
        <p className="mt-1">
          Assumed cost {formatCurrency(assumedCost)} · Modeled uplift {formatCurrency(upliftValue)}. Uplift is gross sale-price impact;
          costs are screening defaults, not quotes.
        </p>
      </div>
      {underwater ? (
        <InlineAlert>
          Modeled sale-price uplift may be lower than assumed renovation cost. That is a common screening outcome, not a calculation error.
          {halifax
            ? " On Halifax, multiple selections can add cost while measured uplift stays one broad renovation signal."
            : null}
        </InlineAlert>
      ) : null}
    </div>
  );
}
