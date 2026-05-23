import type { PropsWithChildren } from "react";
import { NavLink } from "react-router-dom";

import type { PropertyInput } from "@vvl/shared";

const navItems = [
  { href: "/estimate", label: "Estimate" },
  { href: "/improve", label: "Improve" },
  { href: "/plan", label: "Plan" },
  { href: "/workspace", label: "Workspace" },
  { href: "/insights", label: "Insights" },
  { href: "/deal-analyzer", label: "Deal analyzer" },
  { href: "/model-data-story", label: "Model story" },
];

interface SiteLayoutProps extends PropsWithChildren {
  property: PropertyInput;
}

export function SiteLayout({ children, property }: SiteLayoutProps) {
  const demoMode = import.meta.env.VITE_DEMO_MODE === "true" || import.meta.env.VITE_DEMO_MODE === "1";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-700">
      <header className="border-b border-slate-200 bg-white/95 backdrop-blur lg:sticky lg:top-0 lg:z-50">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-[0.18em] text-sound-700">Vancouver Value Lab</div>
            <div className="mt-1 font-display text-lg text-cedar">Estimate, improve, plan</div>
          </div>
          <nav className="flex w-full gap-2 overflow-x-auto pb-1 lg:grid lg:w-auto lg:grid-cols-7 lg:overflow-visible lg:pb-0">
            {navItems.map(({ href, label }) => (
              <NavLink
                key={href}
                to={href}
                end
                className={({ isActive }) =>
                  `flex shrink-0 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-center text-sm font-semibold transition ${
                    isActive
                      ? "border-sound-200 bg-sound-50 text-cedar"
                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-sound-700"
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      {demoMode ? (
        <div className="border-b border-amber-200 bg-amber-50">
          <div className="mx-auto w-full max-w-7xl px-5 py-3 text-sm font-medium text-amber-900">
            Demo Mode: This version uses precomputed sample outputs so the dashboard can be reviewed publicly without private data or model artifacts.
          </div>
        </div>
      ) : null}

      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-5 py-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-500">Current home</div>
            <div className="mt-1 text-sm font-medium text-slate-700">
              {property.postalCode} · {property.propertyType} · {property.livingAreaSqft.toLocaleString()} sqft
            </div>
          </div>
          <div className="text-sm text-slate-500">Main workflow: estimate the value, test improvements, then build an investor plan.</div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-7xl px-5 py-8">{children}</main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-5 py-6 text-sm text-slate-500 md:flex-row md:items-center md:justify-between">
          <div>Vancouver listing-value estimate plus Seattle observed uplift percentages. Outputs are planning aids, not guarantees.</div>
          <div>React + Vite + Tailwind · Express 5 API · Python model service</div>
        </div>
      </footer>
    </div>
  );
}
