import { useCallback } from "react";
import type { DealAnalyzeResponse, PlannedFlag, PropertyInput } from "@vvl/shared";

import { postDealAnalyze } from "../api/client";
import type { PropertyFormValidation } from "../lib/propertyValidation";
import { buildRequestKey } from "../lib/requestKey";
import type { DealInputState } from "../lib/scenarios";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { useLatestRequest } from "../lib/useLatestRequest";

interface UseDealAnalyzeQueryArgs {
  property: PropertyInput;
  plannedFlags: PlannedFlag[];
  dealInputs: DealInputState;
  propertyValidation: PropertyFormValidation;
}

export function useDealAnalyzeQuery({ property, plannedFlags, dealInputs, propertyValidation }: UseDealAnalyzeQueryArgs) {
  const debouncedProperty = useDebouncedValue(property, 400);
  const debouncedFlags = useDebouncedValue(plannedFlags, 400);
  const debouncedDealInputs = useDebouncedValue(dealInputs, 400);

  const visibleKey = buildRequestKey({
    property,
    plannedFlags,
    askingPrice: dealInputs.askingPrice,
    budget: dealInputs.budget,
    timelineMonths: dealInputs.timelineMonths,
  });
  const fetchKey = buildRequestKey({
    property: debouncedProperty,
    plannedFlags: debouncedFlags,
    askingPrice: debouncedDealInputs.askingPrice,
    budget: debouncedDealInputs.budget,
    timelineMonths: debouncedDealInputs.timelineMonths,
  });

  const fetchDeal = useCallback(
    (signal: AbortSignal) =>
      postDealAnalyze(
        {
          ...debouncedProperty,
          plannedFlags: debouncedFlags,
          askingPrice: debouncedDealInputs.askingPrice,
          budget: debouncedDealInputs.budget,
          timelineMonths: debouncedDealInputs.timelineMonths,
        },
        signal,
      ),
    [debouncedDealInputs, debouncedFlags, debouncedProperty],
  );

  const { data: freshResult, loading, error } = useLatestRequest<DealAnalyzeResponse>(
    visibleKey,
    fetchKey,
    propertyValidation.valid,
    fetchDeal,
  );

  return {
    result: freshResult,
    loading,
    error,
    askingPrice: dealInputs.askingPrice,
    budget: dealInputs.budget,
    timelineMonths: dealInputs.timelineMonths,
  };
}
