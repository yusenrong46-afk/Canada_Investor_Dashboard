import type { PropsWithChildren } from "react";
import { NavLink } from "react-router-dom";

import { formatCurrency } from "../lib/format";
import type { EstimateResponse, PropertyInput } from "../types";

interface SiteLayoutProps extends PropsWithChildren {
  property: PropertyInput;
  estimate: EstimateResponse | null;
}

export function SiteLayout({ children, property, estimate }: SiteLayoutProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-700">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-5 py-4">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-[0.22em] text-sound-700">Vancouver Value Lab</div>
            <div className="mt-1 font-display text-lg text-cedar">Estimate + rule-based uplift</div>
          </div>
          <nav className="hidden items-center gap-6 md:flex">
            {[
              ["/", "Home"],
              ["/estimate", "Estimate"],
              ["/simulate", "Simulate"],
              ["/plan", "Plan"],
            ].map(([href, label]) => (
              <NavLink
                key={href}
                to={href}
                end={href === "/"}
                className={({ isActive }) =>
                  `text-sm font-semibold transition ${
                    isActive ? "text-cedar" : "text-slate-500 hover:text-sound-700"
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <NavLink
            to="/estimate"
            className="inline-flex rounded-full bg-cedar px-4 py-2 text-sm font-semibold text-white transition hover:bg-slateblue"
          >
            Estimate value
          </NavLink>
        </div>
      </header>

      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-5 py-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-slate-500">Current home</div>
            <div className="mt-1 text-sm font-medium text-slate-700">
              {property.postalCode} · {property.propertyType} · {property.livingAreaSqft.toLocaleString()} sqft
            </div>
          </div>
          <div className="text-sm text-slate-500">
            Anchor value: <span className="font-semibold text-slate-700">{estimate ? formatCurrency(estimate.anchorValue) : "Loading"}</span>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-7xl px-5 py-8">{children}</main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-5 py-6 text-sm text-slate-500 md:flex-row md:items-center md:justify-between">
          <div>Vancouver-only listing-value estimate plus rule-based uplift. Outputs are directional planning aids, not guarantees.</div>
          <div>React + Vite + Tailwind · Express 5 API · Python model service</div>
        </div>
      </footer>
    </div>
  );
}
