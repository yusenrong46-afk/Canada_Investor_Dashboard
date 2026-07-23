import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { SiteLayout } from "./components/SiteLayout";
import { PropertySessionProvider } from "./context/PropertySessionContext";

const DealAnalyzerPage = lazy(() => import("./pages/DealAnalyzerPage").then((module) => ({ default: module.DealAnalyzerPage })));
const EstimatePage = lazy(() => import("./pages/EstimatePage").then((module) => ({ default: module.EstimatePage })));
const ImproveValuePage = lazy(() => import("./pages/ImproveValuePage").then((module) => ({ default: module.ImproveValuePage })));
const InsightsPage = lazy(() => import("./pages/InsightsPage").then((module) => ({ default: module.InsightsPage })));
const MapPage = lazy(() => import("./pages/MapPage").then((module) => ({ default: module.MapPage })));
const ModelStoryPage = lazy(() => import("./pages/ModelStoryPage").then((module) => ({ default: module.ModelStoryPage })));
const PlanPage = lazy(() => import("./pages/PlanPage").then((module) => ({ default: module.PlanPage })));
const ScenarioWorkspacePage = lazy(() => import("./pages/ScenarioWorkspacePage").then((module) => ({ default: module.ScenarioWorkspacePage })));

function AppRoutes() {
  return (
    <Suspense fallback={<div className="card px-4 py-3 text-sm text-muted">Loading page...</div>}>
      <Routes>
        <Route path="/" element={<Navigate to="/estimate" replace />} />
        <Route path="/estimate" element={<EstimatePage />} />
        <Route path="/improve" element={<ImproveValuePage />} />
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/deal-analyzer" element={<DealAnalyzerPage />} />
        <Route path="/insights" element={<InsightsPage />} />
        <Route path="/workspace" element={<ScenarioWorkspacePage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/model-data-story" element={<ModelStoryPage />} />
        <Route path="/simulate" element={<Navigate to="/improve" replace />} />
        <Route path="/model-story" element={<Navigate to="/model-data-story" replace />} />
        <Route path="*" element={<Navigate to="/estimate" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <PropertySessionProvider>
        <SiteLayout>
          <AppRoutes />
        </SiteLayout>
      </PropertySessionProvider>
    </BrowserRouter>
  );
}
