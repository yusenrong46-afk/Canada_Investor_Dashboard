import { useEffect, useMemo, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { postEstimate } from "./api/client";
import { SiteLayout } from "./components/SiteLayout";
import { defaultProperty } from "./lib/defaults";
import { useLocalStorageState } from "./lib/useLocalStorageState";
import { EstimatePage } from "./pages/EstimatePage";
import { ImproveValuePage } from "./pages/ImproveValuePage";
import { PlanPage } from "./pages/PlanPage";
import type { EstimateResponse, PlannedFlag, PropertyInput } from "./types";

const validPlannedFlags: PlannedFlag[] = [
  "renovatedKitchen",
  "renovatedBathrooms",
  "legalSuiteAdded",
  "energyEfficient",
  "deferredMaintenanceResolved",
  "roofIssueResolved",
];
const validPlannedFlagSet = new Set(validPlannedFlags);

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
  const [savedProperty, setSavedProperty] = useLocalStorageState<PropertyInput>("vvl-base-price-property-v1", defaultProperty);
  const [savedPlannedFlags, setSavedPlannedFlags] = useLocalStorageState<PlannedFlag[]>("vvl-uplift-flags-v1", []);
  const property = useMemo(() => cleanProperty(savedProperty), [savedProperty]);
  const plannedFlags = useMemo(() => cleanPlannedFlags(savedPlannedFlags), [savedPlannedFlags]);
  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const setProperty = (nextProperty: PropertyInput) => setSavedProperty(cleanProperty(nextProperty));
  const setPlannedFlags = (nextFlags: PlannedFlag[]) => setSavedPlannedFlags(cleanPlannedFlags(nextFlags));

  useEffect(() => {
    let active = true;
    setEstimateLoading(true);
    setRequestError(null);

    postEstimate(property)
      .then((result) => {
        if (!active) {
          return;
        }

        setEstimate(result);
        setRequestError(null);
      })
      .catch((error: Error) => {
        if (active) {
          setRequestError(error.message);
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

  const loadingBanner = requestError ? (
    <div className="mx-auto mb-6 max-w-7xl rounded-lg border border-amber-100 bg-amber-50 px-5 py-4 text-sm text-amber-700 shadow-soft">
      {requestError}
    </div>
  ) : estimateLoading ? (
    <div className="mx-auto mb-6 max-w-7xl rounded-lg border border-white/70 bg-white/80 px-5 py-4 text-sm text-slate-500 shadow-soft">
      Loading the Vancouver base-price model...
    </div>
  ) : null;

  return (
    <BrowserRouter>
      <SiteLayout property={property} estimate={estimate}>
        {loadingBanner}
        <Routes>
          <Route
            path="/"
            element={<EstimatePage property={property} estimate={estimate} onPropertyChange={setProperty} loading={estimateLoading} />}
          />
          <Route path="/estimate" element={<Navigate to="/" replace />} />
          <Route
            path="/improve"
            element={<ImproveValuePage property={property} estimate={estimate} plannedFlags={plannedFlags} onPlannedFlagsChange={setPlannedFlags} />}
          />
          <Route path="/simulate" element={<Navigate to="/improve" replace />} />
          <Route
            path="/plan"
            element={<PlanPage property={property} estimate={estimate} plannedFlags={plannedFlags} onPlannedFlagsChange={setPlannedFlags} />}
          />
          <Route path="/model-story" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SiteLayout>
    </BrowserRouter>
  );
}
