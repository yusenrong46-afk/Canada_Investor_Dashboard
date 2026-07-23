import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  BarChart3,
  Bookmark,
  Building2,
  ChevronDown,
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

import { usePropertySession } from "../context/PropertySessionContext";
import { InlineAlert } from "./InlineAlert";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const primaryLinks: NavItem[] = [
  { href: "/estimate", label: "Estimate", icon: Sparkles },
  { href: "/improve", label: "Improve", icon: Hammer },
  { href: "/plan", label: "Plan", icon: ClipboardList },
  { href: "/deal-analyzer", label: "Deal", icon: LineChart },
];

const moreLinks: NavItem[] = [
  { href: "/workspace", label: "Scenarios", icon: Bookmark },
  { href: "/insights", label: "Insights", icon: BarChart3 },
  { href: "/map", label: "Market map", icon: MapIcon },
  { href: "/model-data-story", label: "Model", icon: ScrollText },
];

const mobileSections = [
  { label: "Workflow", items: primaryLinks },
  { label: "More", items: moreLinks },
];

function modeLabel(apiMode: string | null | undefined, modelServiceReady: boolean | null | undefined): string {
  if (apiMode === "live-model") {
    if (modelServiceReady) return "Live models";
    if (modelServiceReady === false) return "Models offline";
    return "Checking models";
  }
  if (apiMode === "public-interactive") return "Public rules";
  if (apiMode === "demo-samples") return "Demo samples";
  return "Mode unknown";
}

function modeTone(apiMode: string | null | undefined, modelServiceReady: boolean | null | undefined): string {
  if (apiMode === "live-model" && modelServiceReady) return "bg-success/10 text-success ring-success/20";
  if (apiMode === "live-model" && modelServiceReady === false) return "bg-danger/10 text-danger ring-danger/20";
  if (apiMode === "public-interactive" || apiMode === "demo-samples") return "bg-brand-50 text-brand-700 ring-brand-200";
  return "bg-warning/10 text-warning ring-warning/20";
}

function modeOneLiner(apiMode: string | null | undefined): string {
  if (apiMode === "demo-samples") return "Demo samples · not live data";
  if (apiMode === "public-interactive") return "Public rules · not an appraisal";
  if (apiMode === "live-model") return "Live models";
  return "Mode unverified";
}

export function SiteLayout({ children }: PropsWithChildren) {
  const { property, propertyValidation, apiMode, modelServiceReady } = usePropertySession();
  const [navOpen, setNavOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const propertyDetailsValid = propertyValidation?.valid !== false;
  const moreActive = moreLinks.some((item) => location.pathname === item.href);

  function closeNavigation(restoreFocus = false) {
    setNavOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => menuButtonRef.current?.focus());
    }
  }

  useEffect(() => {
    setNavOpen(false);
    setMoreOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (navOpen) {
      closeButtonRef.current?.focus();
    }
  }, [navOpen]);

  useEffect(() => {
    if (!moreOpen) {
      return undefined;
    }

    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (moreMenuRef.current?.contains(target) || moreButtonRef.current?.contains(target)) {
        return;
      }
      setMoreOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMoreOpen(false);
        moreButtonRef.current?.focus();
      }
    };

    window.addEventListener("mousedown", handlePointer);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [moreOpen]);

  useEffect(() => {
    if (!navOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeNavigation(true);
        return;
      }

      if (event.key !== "Tab" || !drawerRef.current) {
        return;
      }

      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      ).filter((element) => !element.hasAttribute("disabled") && element.tabIndex !== -1);

      if (!focusable.length) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navOpen]);

  return (
    <div className="min-h-screen bg-canvas-wash text-body">
      <header className="sticky top-0 z-40 border-b border-line/80 bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-5 py-3 lg:px-8">
          <button
            ref={menuButtonRef}
            type="button"
            aria-label="Open navigation"
            aria-expanded={navOpen}
            onClick={() => setNavOpen(true)}
            className="rounded-field border border-line p-2 text-body hover:text-ink lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-field bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100">
              <Building2 className="h-4 w-4" />
            </span>
            <div className="font-display text-lg leading-none tracking-tight text-ink">Canada Value Lab</div>
          </div>

          <nav aria-label="Primary" className="ml-2 hidden items-center gap-0.5 lg:flex">
            {primaryLinks.map(({ href, label }) => (
              <NavLink
                key={href}
                to={href}
                end
                className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`}
              >
                {label}
              </NavLink>
            ))}
            <div className="relative">
              <button
                ref={moreButtonRef}
                type="button"
                aria-expanded={moreOpen}
                aria-haspopup="menu"
                onClick={() => setMoreOpen((open) => !open)}
                className={`nav-link inline-flex items-center gap-1 ${moreActive || moreOpen ? "nav-link-active" : ""}`}
              >
                More
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              {moreOpen ? (
                <div
                  ref={moreMenuRef}
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-1 min-w-[11rem] rounded-card border border-line bg-surface p-1 shadow-hover"
                >
                  {moreLinks.map(({ href, label, icon: Icon }) => (
                    <NavLink
                      key={href}
                      to={href}
                      end
                      role="menuitem"
                      className={({ isActive }) =>
                        `flex items-center gap-2 rounded-field px-3 py-2 text-sm font-semibold ${
                          isActive ? "bg-brand-50 text-brand-700" : "text-body hover:bg-canvas hover:text-ink"
                        }`
                      }
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {label}
                    </NavLink>
                  ))}
                </div>
              ) : null}
            </div>
          </nav>

          <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="hidden min-w-0 items-center gap-1.5 text-sm md:inline-flex">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-brand-600" />
              <span className="truncate font-semibold text-ink">{property.postalCode}</span>
              {propertyDetailsValid ? (
                <span className="truncate text-muted">· {property.propertyType}</span>
              ) : (
                <span className="truncate text-warning">· Review inputs</span>
              )}
            </div>
            <span className={`shrink-0 rounded-field px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ring-1 ${modeTone(apiMode, modelServiceReady)}`}>
              {modeLabel(apiMode, modelServiceReady)}
            </span>
            <span className="hidden shrink-0 text-xs text-muted xl:inline">{modeOneLiner(apiMode)}</span>
          </div>
        </div>

        {apiMode === "live-model" && modelServiceReady === false ? (
          <div className="border-t border-line px-5 py-2 lg:px-8">
            <div className="mx-auto max-w-6xl">
              <InlineAlert tone="error" role="alert">
                Live-model mode is configured, but the Python model service is unreachable. Results are not being replaced with demo or public estimates.
              </InlineAlert>
            </div>
          </div>
        ) : apiMode == null ? (
          <div className="border-t border-line px-5 py-2 lg:px-8">
            <div className="mx-auto max-w-6xl">
              <InlineAlert>API mode could not be verified. Do not treat results as live until the connection is restored.</InlineAlert>
            </div>
          </div>
        ) : null}
      </header>

      {navOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => closeNavigation(true)}
          className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-sm lg:hidden"
        />
      ) : null}

      <aside
        ref={drawerRef}
        role={navOpen ? "dialog" : undefined}
        aria-modal={navOpen ? true : undefined}
        aria-label="Mobile navigation"
        className={`fixed inset-y-0 left-0 z-50 flex w-[300px] flex-col border-r border-line bg-surface shadow-hover transition-transform duration-200 lg:hidden ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <div className="font-display text-lg text-ink">Canada Value Lab</div>
            <div className="text-xs text-muted">{modeOneLiner(apiMode)}</div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close navigation"
            onClick={() => closeNavigation(true)}
            className="rounded-field border border-line p-1.5 text-muted hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav aria-label="Mobile main" className="flex-1 overflow-y-auto px-3 py-4">
          {mobileSections.map((section) => (
            <div key={section.label} className="mb-5">
              <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">{section.label}</div>
              <div className="space-y-1">
                {section.items.map(({ href, label, icon: Icon }) => (
                  <NavLink
                    key={href}
                    to={href}
                    end
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-field px-3 py-2.5 text-sm font-semibold transition ${
                        isActive ? "bg-brand-50 text-brand-700" : "text-body hover:bg-canvas hover:text-ink"
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
      </aside>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-6 lg:px-8 lg:py-8" aria-hidden={navOpen ? true : undefined} {...(navOpen ? { inert: true } : {})}>
        {children}
      </main>

      <footer className="border-t border-line/80 bg-surface/80">
        <div className="mx-auto max-w-6xl px-5 py-4 text-sm text-muted lg:px-8">
          Planning aid for deal screening — not an appraisal or lending decision.
        </div>
      </footer>
    </div>
  );
}
