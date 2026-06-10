import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { improvementFlagValues, type EstimateResponse, type MarketsResponse, type PlannedFlag, type PropertyInput } from "@vvl/shared";

import { getMarkets, postEstimate } from "./api/client";
import { SiteLayout } from "./components/SiteLayout";
import { defaultProperty } from "./lib/defaults";
import { cleanScenario, newestFirst, type DealInputState, type PlanInputState, type ScenarioRecord } from "./lib/scenarios";
import { useLocalStorageState } from "./lib/useLocalStorageState";

// Every route loads lazily so heavy vendors (Recharts, Leaflet) only download with the page that renders them.
const DealAnalyzerPage = lazy(() => import("./pages/DealAnalyzerPage").then((module) => ({ default: module.DealAnalyzerPage })));
const EstimatePage = lazy(() => import("./pages/EstimatePage").then((module) => ({ default: module.EstimatePage })));
const ImproveValuePage = lazy(() => import("./pages/ImproveValuePage").then((module) => ({ default: module.ImproveValuePage })));
const InsightsPage = lazy(() => import("./pages/InsightsPage").then((module) => ({ default: module.InsightsPage })));
const MapPage = lazy(() => import("./pages/MapPage").then((module) => ({ default: module.MapPage })));
const ModelStoryPage = lazy(() => import("./pages/ModelStoryPage").then((module) => ({ default: module.ModelStoryPage })));
const PlanPage = lazy(() => import("./pages/PlanPage").then((module) => ({ default: module.PlanPage })));
const ScenarioWorkspacePage = lazy(() => import("./pages/ScenarioWorkspacePage").then((module) => ({ default: module.ScenarioWorkspacePage })));

const validPlannedFlags = [...improvementFlagValues];
const validPlannedFlagSet = new Set(validPlannedFlags);
const defaultPlanInputs: PlanInputState = {
  targetPrice: 1_400_000,
  budget: 120_000,
  timelineMonths: 9,
};
const defaultDealInputs: DealInputState = {
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

export default function App() {
  // The dashboard stays database-free by persisting the active workflow and saved scenarios in browser storage.
  const [savedProperty, setSavedProperty] = useLocalStorageState<PropertyInput>("vvl-base-price-property-v1", defaultProperty);
  const [savedPlannedFlags, setSavedPlannedFlags] = useLocalStorageState<PlannedFlag[]>("vvl-uplift-flags-v1", []);
  const [savedScenarios, setSavedScenarios] = useLocalStorageState<ScenarioRecord[]>("vvl-scenarios-v1", []);
  const [planInputs, setPlanInputs] = useLocalStorageState<PlanInputState>("vvl-plan-inputs-v1", defaultPlanInputs);
  const [dealInputs, setDealInputs] = useLocalStorageState<DealInputState>("vvl-deal-inputs-v1", defaultDealInputs);
  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [markets, setMarkets] = useState<MarketsResponse["markets"] | null>(null);
  const property = useMemo(() => cleanProperty(savedProperty), [savedProperty]);
  const plannedFlags = useMemo(() => cleanPlannedFlags(savedPlannedFlags), [savedPlannedFlags]);
  const setProperty = (nextProperty: PropertyInput) => setSavedProperty(cleanProperty(nextProperty));
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
    // The market list only changes per deployment, so fetch it once and share it with every form.
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
    // Keep the base estimate live as the user edits the property; downstream pages reuse this shared result.
    let active = true;
    setEstimateLoading(true);
    setEstimateError(null);

    postEstimate(property)
      .then((response) => {
        if (active) {
          setEstimate(response);
        }
      })
      .catch((caughtError: Error) => {
        if (active) {
          setEstimateError(caughtError.message);
        }
      })
      .finally(() => {
        if (active) {
          setEstimateLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [property]);

  return (
    <BrowserRouter>
      <SiteLayout property={property}>
        <Suspense fallback={<div className="card px-4 py-3 text-sm text-muted">Loading page...</div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/estimate" replace />} />
            <Route
              path="/estimate"
              element={
                <EstimatePage
                  property={property}
                  estimate={estimate}
                  onPropertyChange={setProperty}
                  loading={estimateLoading}
                  error={estimateError}
                  markets={markets}
                />
              }
            />
            <Route
              path="/improve"
              element={<ImproveValuePage property={property} estimate={estimate} plannedFlags={plannedFlags} onPlannedFlagsChange={setPlannedFlags} />}
            />
            <Route
              path="/plan"
              element={
                <PlanPage
                  property={property}
                  estimate={estimate}
                  plannedFlags={plannedFlags}
                  onPlannedFlagsChange={setPlannedFlags}
                  onSaveScenario={saveScenario}
                  planInputs={planInputs}
                  onPlanInputsChange={setPlanInputs}
                />
              }
            />
            <Route
              path="/deal-analyzer"
              element={
                <DealAnalyzerPage
                  property={property}
                  plannedFlags={plannedFlags}
                  onPropertyChange={setProperty}
                  onPlannedFlagsChange={setPlannedFlags}
                  onSaveScenario={saveScenario}
                  dealInputs={dealInputs}
                  onDealInputsChange={setDealInputs}
                  markets={markets}
                />
              }
            />
            <Route path="/insights" element={<InsightsPage scenarios={scenarios} intervalMethod={estimate?.uncertainty?.method} />} />
            <Route
              path="/workspace"
              element={
                <ScenarioWorkspacePage
                  scenarios={scenarios}
                  onUseScenario={useScenario}
                  onUpdateScenario={updateScenario}
                  onDeleteScenario={deleteScenario}
                  onClearScenarios={clearScenarios}
                />
              }
            />
            <Route path="/map" element={<MapPage />} />
            <Route path="/model-data-story" element={<ModelStoryPage />} />
            <Route path="/simulate" element={<Navigate to="/improve" replace />} />
            <Route path="/model-story" element={<Navigate to="/model-data-story" replace />} />
            <Route path="*" element={<Navigate to="/estimate" replace />} />
          </Routes>
        </Suspense>
      </SiteLayout>
    </BrowserRouter>
  );
}
