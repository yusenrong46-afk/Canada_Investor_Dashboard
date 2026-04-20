import { startTransition, useDeferredValue, useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { postEstimate } from "./api/client";
import { SiteLayout } from "./components/SiteLayout";
import { defaultProperty } from "./lib/defaults";
import { useLocalStorageState } from "./lib/useLocalStorageState";
import { EstimatePage } from "./pages/EstimatePage";
import { LandingPage } from "./pages/LandingPage";
import { PlanPage } from "./pages/PlanPage";
import { SimulatePage } from "./pages/SimulatePage";
import type { EstimateResponse, PlannedFlag, PropertyInput } from "./types";

export default function App() {
  const [property, setProperty] = useLocalStorageState<PropertyInput>("vvl-base-price-property-v1", defaultProperty);
  const [plannedFlags, setPlannedFlags] = useLocalStorageState<PlannedFlag[]>("vvl-uplift-flags-v1", []);
  const [estimate, setEstimate] = useState<EstimateResponse | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const deferredProperty = useDeferredValue(property);

  useEffect(() => {
    let active = true;
    setEstimateLoading(true);
    setRequestError(null);

    postEstimate(deferredProperty)
      .then((result) => {
        if (!active) {
          return;
        }

        startTransition(() => {
          setEstimate(result);
          setRequestError(null);
        });
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
  }, [deferredProperty]);

  const loadingBanner = requestError ? (
    <div className="mx-auto mb-6 max-w-7xl rounded-[24px] border border-amber-100 bg-amber-50 px-5 py-4 text-sm text-amber-700 shadow-soft">
      {requestError}
    </div>
  ) : estimateLoading ? (
    <div className="mx-auto mb-6 max-w-7xl rounded-[24px] border border-white/70 bg-white/80 px-5 py-4 text-sm text-slate-500 shadow-soft">
      Loading the Vancouver base-price model...
    </div>
  ) : null;

  return (
    <BrowserRouter>
      <SiteLayout property={property} estimate={estimate}>
        {loadingBanner}
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route
            path="/estimate"
            element={<EstimatePage property={property} estimate={estimate} onPropertyChange={setProperty} loading={estimateLoading} />}
          />
          <Route
            path="/simulate"
            element={<SimulatePage property={property} estimate={estimate} plannedFlags={plannedFlags} onPlannedFlagsChange={setPlannedFlags} />}
          />
          <Route
            path="/plan"
            element={<PlanPage property={property} estimate={estimate} plannedFlags={plannedFlags} onPlannedFlagsChange={setPlannedFlags} />}
          />
        </Routes>
      </SiteLayout>
    </BrowserRouter>
  );
}
