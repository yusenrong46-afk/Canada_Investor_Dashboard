import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import {
  improvementFlagValues,
  type ApiRuntimeMode,
  type EstimateResponse,
  type MarketsResponse,
  type PlannedFlag,
  type PropertyInput,
} from "@vvl/shared";

import { getHealth, getMarkets, postEstimate } from "../api/client";
import { defaultProperty } from "../lib/defaults";
import { validatePropertyInput, type PropertyFormValidation } from "../lib/propertyValidation";
import { buildRequestKey, isFreshResult } from "../lib/requestKey";
import {
  cleanScenario,
  isScenarioStore,
  migrateScenarioStore,
  newestFirst,
  type DealInputState,
  type PlanInputState,
  type ScenarioRecord,
  type ScenarioStore,
} from "../lib/scenarios";
import { useDebouncedValue } from "../lib/useDebouncedValue";
import { useLocalStorageState } from "../lib/useLocalStorageState";

const estimateRoutes = new Set(["/estimate", "/improve", "/"]);

const validPlannedFlags = [...improvementFlagValues];
const validPlannedFlagSet = new Set(validPlannedFlags);

export const defaultPlanInputs: PlanInputState = {
  targetPrice: 1_400_000,
  budget: 120_000,
  timelineMonths: 9,
};

export const defaultDealInputs: DealInputState = {
  askingPrice: 735_000,
  budget: 85_000,
  timelineMonths: 9,
};

function cleanPlannedFlags(flags: PlannedFlag[]): PlannedFlag[] {
  return flags.filter((flag) => validPlannedFlagSet.has(flag));
}

function cleanProperty(property: PropertyInput): PropertyInput {
  return {
    postalCode: property.postalCode ?? defaultProperty.postalCode,
    propertyType: property.propertyType ?? defaultProperty.propertyType,
    livingAreaSqft: property.livingAreaSqft ?? defaultProperty.livingAreaSqft,
    bedrooms: property.bedrooms ?? defaultProperty.bedrooms,
    bathrooms: property.bathrooms ?? defaultProperty.bathrooms,
    yearBuilt: property.yearBuilt,
    knownCurrentValue: property.knownCurrentValue,
  };
}

export interface PropertySessionValue {
  property: PropertyInput;
  setProperty: (property: PropertyInput) => void;
  propertyValidation: PropertyFormValidation;
  setPropertyFormValidation: (validation: PropertyFormValidation) => void;
  plannedFlags: PlannedFlag[];
  setPlannedFlags: (flags: PlannedFlag[]) => void;
  scenarios: ScenarioRecord[];
  saveScenario: (scenario: ScenarioRecord) => void;
  deleteScenario: (scenarioId: string) => void;
  updateScenario: (scenario: ScenarioRecord) => void;
  clearScenarios: () => void;
  useScenario: (scenario: ScenarioRecord) => void;
  planInputs: PlanInputState;
  setPlanInputs: (inputs: PlanInputState) => void;
  dealInputs: DealInputState;
  setDealInputs: (inputs: DealInputState) => void;
  estimate: EstimateResponse | null;
  estimateLoading: boolean;
  estimateError: string | null;
  markets: MarketsResponse["markets"] | null;
  apiMode: ApiRuntimeMode | null;
  modelServiceReady: boolean | null;
}

const PropertySessionContext = createContext<PropertySessionValue | null>(null);

type EstimateResult = EstimateResponse & { requestKey: string };

export function PropertySessionProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [savedProperty, setSavedProperty] = useLocalStorageState<PropertyInput>("vvl-base-price-property-v1", defaultProperty);
  const [savedPlannedFlags, setSavedPlannedFlags] = useLocalStorageState<PlannedFlag[]>("vvl-uplift-flags-v1", []);
  const [savedScenarioStore, setSavedScenarioStore] = useLocalStorageState<ScenarioStore>(
    "vvl-scenarios-v1",
    { version: 1, data: [] },
    { migrate: migrateScenarioStore, validate: isScenarioStore },
  );
  const [planInputs, setPlanInputs] = useLocalStorageState<PlanInputState>("vvl-plan-inputs-v1", defaultPlanInputs);
  const [dealInputs, setDealInputs] = useLocalStorageState<DealInputState>("vvl-deal-inputs-v1", defaultDealInputs);
  const [estimate, setEstimate] = useState<EstimateResult | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const estimateSequenceRef = useRef(0);
  const [markets, setMarkets] = useState<MarketsResponse["markets"] | null>(null);
  const [apiMode, setApiMode] = useState<ApiRuntimeMode | null>(null);
  const [modelServiceReady, setModelServiceReady] = useState<boolean | null>(null);
  const [propertyFormValidation, setPropertyFormValidation] = useState<PropertyFormValidation>(() => validatePropertyInput(defaultProperty));

  const property = useMemo(() => cleanProperty(savedProperty), [savedProperty]);
  const debouncedProperty = useDebouncedValue(property, 400);
  const shouldFetchEstimate = estimateRoutes.has(location.pathname);
  const visibleEstimateKey = buildRequestKey(property);
  const debouncedEstimateKey = buildRequestKey(debouncedProperty);
  const estimateIsDebouncing = visibleEstimateKey !== debouncedEstimateKey;
  const schemaPropertyValidation = useMemo(() => validatePropertyInput(property), [property]);
  const propertyValidation = useMemo<PropertyFormValidation>(() => {
    if (!schemaPropertyValidation.valid) {
      return schemaPropertyValidation;
    }
    return propertyFormValidation.valid ? schemaPropertyValidation : propertyFormValidation;
  }, [propertyFormValidation, schemaPropertyValidation]);
  const plannedFlags = useMemo(() => cleanPlannedFlags(savedPlannedFlags), [savedPlannedFlags]);
  const savedScenarios = savedScenarioStore.data;

  function setSavedScenarios(next: ScenarioRecord[] | ((current: ScenarioRecord[]) => ScenarioRecord[])) {
    setSavedScenarioStore((currentStore: ScenarioStore) => ({
      version: 1,
      data: typeof next === "function" ? next(currentStore.data) : next,
    }));
  }

  const setProperty = (nextProperty: PropertyInput) => {
    const cleanedProperty = cleanProperty(nextProperty);
    setSavedProperty(cleanedProperty);
    setPropertyFormValidation(validatePropertyInput(cleanedProperty));
  };

  const setPlannedFlags = (nextFlags: PlannedFlag[]) => setSavedPlannedFlags(cleanPlannedFlags(nextFlags));
  const scenarios = useMemo(() => newestFirst(savedScenarios.map(cleanScenario)), [savedScenarios]);

  function saveScenario(nextScenario: ScenarioRecord) {
    setSavedScenarios((currentScenarios) => newestFirst([nextScenario, ...currentScenarios]).slice(0, 30));
  }

  function deleteScenario(scenarioId: string) {
    setSavedScenarios((currentScenarios) => currentScenarios.filter((scenario) => scenario.id !== scenarioId));
  }

  function updateScenario(nextScenario: ScenarioRecord) {
    setSavedScenarios((currentScenarios) => currentScenarios.map((scenario) => (scenario.id === nextScenario.id ? nextScenario : scenario)));
  }

  function clearScenarios() {
    setSavedScenarios([]);
  }

  function useScenario(scenario: ScenarioRecord) {
    setProperty(scenario.property);
    setPlannedFlags(scenario.plannedFlags);
    setPlanInputs({
      targetPrice: scenario.targetPrice ?? scenario.achievableValue,
      budget: scenario.budget,
      timelineMonths: scenario.timelineMonths,
    });
    setDealInputs({
      askingPrice: scenario.askingPrice ?? scenario.estimatedValue,
      budget: scenario.budget,
      timelineMonths: scenario.timelineMonths,
    });
  }

  useEffect(() => {
    let active = true;

    getMarkets()
      .then((response) => {
        if (active) {
          setMarkets(response.markets);
        }
      })
      .catch(() => {
        // The market pills fall back to the shared catalog when the endpoint is unreachable.
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    getHealth()
      .then((response) => {
        if (active) {
          setApiMode(response.mode);
          setModelServiceReady(response.modelServiceReady ?? null);
        }
      })
      .catch(() => {
        if (active) {
          setApiMode(null);
          setModelServiceReady(null);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (estimate != null && estimate.requestKey !== visibleEstimateKey) {
      setEstimate(null);
    }
  }, [estimate, visibleEstimateKey]);

  useEffect(() => {
    if (!shouldFetchEstimate) {
      setEstimateLoading(false);
      return undefined;
    }

    if (!propertyValidation.valid) {
      setEstimate(null);
      setEstimateLoading(false);
      setEstimateError(null);
      return undefined;
    }

    if (estimateIsDebouncing) {
      return undefined;
    }

    const sequence = ++estimateSequenceRef.current;
    setEstimateLoading(true);
    setEstimateError(null);

    const controller = new AbortController();
    postEstimate(debouncedProperty, controller.signal)
      .then((response) => {
        if (sequence !== estimateSequenceRef.current) {
          return;
        }
        setEstimate({ ...response, requestKey: debouncedEstimateKey });
      })
      .catch((caughtError: Error) => {
        if (sequence !== estimateSequenceRef.current || caughtError.name === "AbortError") {
          return;
        }
        setEstimateError(caughtError.message);
      })
      .finally(() => {
        if (sequence !== estimateSequenceRef.current) {
          return;
        }
        setEstimateLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [debouncedEstimateKey, debouncedProperty, estimateIsDebouncing, propertyValidation.valid, shouldFetchEstimate]);

  const freshEstimate = estimate && isFreshResult(estimate, visibleEstimateKey) ? estimate : null;
  const estimateBusy = shouldFetchEstimate && (estimateLoading || estimateIsDebouncing);

  const value = useMemo<PropertySessionValue>(
    () => ({
      property,
      setProperty,
      propertyValidation,
      setPropertyFormValidation,
      plannedFlags,
      setPlannedFlags,
      scenarios,
      saveScenario,
      deleteScenario,
      updateScenario,
      clearScenarios,
      useScenario,
      planInputs,
      setPlanInputs,
      dealInputs,
      setDealInputs,
      estimate: freshEstimate,
      estimateLoading: estimateBusy,
      estimateError,
      markets,
      apiMode,
      modelServiceReady,
    }),
    [
      property,
      propertyValidation,
      plannedFlags,
      scenarios,
      planInputs,
      dealInputs,
      freshEstimate,
      estimateBusy,
      estimateError,
      markets,
      apiMode,
      modelServiceReady,
    ],
  );

  return <PropertySessionContext.Provider value={value}>{children}</PropertySessionContext.Provider>;
}

export function usePropertySession(): PropertySessionValue {
  const context = useContext(PropertySessionContext);
  if (!context) {
    throw new Error("usePropertySession must be used within PropertySessionProvider");
  }
  return context;
}
