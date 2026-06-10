import { useEffect, useState, type PropsWithChildren } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  BarChart3,
  Bookmark,
  Building2,
  ClipboardList,
  Hammer,
  LineChart,
  Map as MapIcon,
  MapPin,
  Menu,
  ScrollText,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";

import type { PropertyInput } from "@vvl/shared";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    label: "Workflow",
    items: [
      { href: "/estimate", label: "Estimate", icon: Sparkles },
      { href: "/improve", label: "Improve", icon: Hammer },
      { href: "/plan", label: "Plan", icon: ClipboardList },
    ],
  },
  {
    label: "Analysis",
    items: [
      { href: "/workspace", label: "Scenarios", icon: Bookmark },
      { href: "/insights", label: "Insights", icon: BarChart3 },
      { href: "/deal-analyzer", label: "Deal", icon: LineChart },
      { href: "/map", label: "Market map", icon: MapIcon },
    ],
  },
  {
    label: "Reference",
    items: [{ href: "/model-data-story", label: "Model", icon: ScrollText }],
  },
];

interface SiteLayoutProps extends PropsWithChildren {
  property: PropertyInput;
}

export function SiteLayout({ children, property }: SiteLayoutProps) {
  const demoMode = import.meta.env.VITE_DEMO_MODE === "true" || import.meta.env.VITE_DEMO_MODE === "1";
  const publicMode = import.meta.env.VITE_PUBLIC_MODE === "true" || import.meta.env.VITE_PUBLIC_MODE === "1";
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    // Close the mobile drawer whenever the route changes.
    setNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-canvas text-body lg:grid lg:grid-cols-[260px,minmax(0,1fr)]">
      {/* Mobile backdrop */}
      {navOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-sm lg:hidden"
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col bg-sidebar text-slate-300 transition-transform duration-200 lg:static lg:h-screen lg:translate-x-0 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-5 py-5">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-field bg-brand-500/15 text-brand-300 ring-1 ring-inset ring-brand-500/30">
              <Building2 className="h-5 w-5" />
            </span>
            <div>
              <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-brand-300">Vancouver Value Lab</div>
              <div className="text-xs text-slate-400">Estimate · Improve · Plan</div>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
            className="rounded-field p-1.5 text-slate-400 hover:bg-white/5 hover:text-white lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3 pb-6">
          {navSections.map((section) => (
            <div key={section.label}>
              <div className="px-3 pb-2 pt-6 text-[10px] font-extrabold uppercase tracking-[0.18em] text-slate-500">
                {section.label}
              </div>
              <div className="space-y-1">
                {section.items.map(({ href, label, icon: Icon }) => (
                  <NavLink
                    key={href}
                    to={href}
                    end
                    className={({ isActive }) =>
                      `relative flex items-center gap-3 rounded-field px-3 py-2.5 text-sm font-semibold transition ${
                        isActive
                          ? "bg-brand-500/15 text-white ring-1 ring-inset ring-brand-500/30 before:absolute before:left-0 before:top-1/2 before:h-5 before:w-1 before:-translate-y-1/2 before:rounded-pill before:bg-brand-400"
                          : "text-slate-400 hover:bg-white/5 hover:text-white"
                      }`
                    }
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 px-5 py-4 text-xs leading-5 text-slate-500">
          Planning aid for deal screening — not an appraisal.
        </div>
      </aside>

      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-surface/80 backdrop-blur">
          <div className="flex items-center justify-between gap-4 px-5 py-3 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                aria-label="Open navigation"
                onClick={() => setNavOpen(true)}
                className="rounded-field border border-line p-2 text-body hover:text-ink lg:hidden"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="inline-flex min-w-0 items-center gap-2 rounded-pill bg-canvas px-3 py-1.5 text-sm">
                <MapPin className="h-4 w-4 shrink-0 text-brand-600" />
                <span className="truncate font-semibold text-ink">{property.postalCode}</span>
                <span className="hidden text-muted sm:inline">·</span>
                <span className="hidden truncate text-body sm:inline">{property.propertyType}</span>
                <span className="hidden text-muted sm:inline">·</span>
                <span className="hidden truncate text-body sm:inline">{property.livingAreaSqft.toLocaleString()} sqft</span>
              </div>
            </div>
            <div className="hidden text-sm text-muted xl:block">
              Estimate value → test improvements → build a plan → save scenarios.
            </div>
          </div>

          {demoMode || publicMode ? (
            <div className="border-t border-warning/30 bg-warning/10 px-5 py-2 text-xs font-medium text-warning lg:px-8">
              {demoMode
                ? "Demo Mode: precomputed sample outputs so the dashboard can be reviewed publicly without private data or model artifacts."
                : "Public Interactive Mode: estimates update from your inputs using a transparent screening model. Use it for deal review, not appraisal or lending decisions."}
            </div>
          ) : null}
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 lg:px-8 lg:py-10">{children}</main>

        <footer className="border-t border-line bg-surface">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-6 text-sm text-muted md:flex-row md:items-center md:justify-between lg:px-8">
            <div>Vancouver listing-value estimate plus renovation upside screening. Outputs are planning aids, not guarantees.</div>
            <div>React + Vite + Tailwind · Express 5 API · Python model service</div>
          </div>
        </footer>
      </div>
    </div>
  );
}
