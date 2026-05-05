import type { PropsWithChildren } from "react";
import { NavLink } from "react-router-dom";

import { formatCurrency } from "../lib/format";
import type { EstimateResponse, PropertyInput } from "../types";

const navItems = [
  { href: "/", step: "1", label: "Estimate" },
  { href: "/improve", step: "2", label: "Improve" },
  { href: "/plan", step: "3", label: "Plan" },
];

interface SiteLayoutProps extends PropsWithChildren {
  property: PropertyInput;
  estimate: EstimateResponse | null;
}

export function SiteLayout({ children, property, estimate }: SiteLayoutProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-700">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-[0.18em] text-sound-700">Vancouver Value Lab</div>
            <div className="mt-1 font-display text-lg text-cedar">Estimate, improve, plan</div>
          </div>
          <nav className="grid w-full grid-cols-3 gap-2 lg:w-auto">
            {navItems.map(({ href, step, label }) => (
              <NavLink
                key={href}
                to={href}
                end={href === "/"}
                className={({ isActive }) =>
                  `flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-center text-sm font-semibold transition ${
                    isActive
                      ? "border-sound-200 bg-sound-50 text-cedar"
                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-sound-700"
                  }`
                }
              >
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs ring-1 ring-slate-200">
                  {step}
                </span>
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-5 py-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-500">Current home</div>
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
