import { useMemo } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { improvementFlagValues, type PlannedFlag, type PropertyInput } from "@vvl/shared";

import { SiteLayout } from "./components/SiteLayout";
import { defaultProperty } from "./lib/defaults";
import { useLocalStorageState } from "./lib/useLocalStorageState";
import { DealAnalyzerPage } from "./pages/DealAnalyzerPage";
import { ModelStoryPage } from "./pages/ModelStoryPage";

const validPlannedFlags = [...improvementFlagValues];
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
  const setProperty = (nextProperty: PropertyInput) => setSavedProperty(cleanProperty(nextProperty));
  const setPlannedFlags = (nextFlags: PlannedFlag[]) => setSavedPlannedFlags(cleanPlannedFlags(nextFlags));

  return (
    <BrowserRouter>
      <SiteLayout property={property}>
        <Routes>
          <Route
            path="/"
            element={<DealAnalyzerPage property={property} plannedFlags={plannedFlags} onPropertyChange={setProperty} onPlannedFlagsChange={setPlannedFlags} />}
          />
          <Route path="/model-data-story" element={<ModelStoryPage />} />
          <Route path="/estimate" element={<Navigate to="/" replace />} />
          <Route path="/improve" element={<Navigate to="/" replace />} />
          <Route path="/simulate" element={<Navigate to="/" replace />} />
          <Route path="/plan" element={<Navigate to="/" replace />} />
          <Route path="/model-story" element={<Navigate to="/model-data-story" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SiteLayout>
    </BrowserRouter>
  );
}
