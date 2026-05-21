import type { PropsWithChildren } from "react";
import { NavLink } from "react-router-dom";

import type { PropertyInput } from "@vvl/shared";

const navItems = [
  { href: "/", label: "Deal analyzer" },
  { href: "/model-data-story", label: "Model & data story" },
];

interface SiteLayoutProps extends PropsWithChildren {
  property: PropertyInput;
}

export function SiteLayout({ children, property }: SiteLayoutProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-700">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-[0.18em] text-sound-700">Vancouver Value Lab</div>
            <div className="mt-1 font-display text-lg text-cedar">Estimate, improve, plan</div>
          </div>
          <nav className="grid w-full grid-cols-2 gap-2 lg:w-auto">
            {navItems.map(({ href, label }) => (
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
          <div className="text-sm text-slate-500">One clear product surface: screen the deal, then inspect the model.</div>
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
