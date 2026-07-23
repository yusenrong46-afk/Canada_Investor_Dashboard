import type { ReactNode } from "react";

type MetricTone = "neutral" | "success" | "warning" | "danger";

interface MetricCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  variant?: "standard" | "hero";
  tone?: MetricTone;
}

const toneClass: Record<MetricTone, string> = {
  neutral: "text-ink",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

function MetricValue({ value }: { value: ReactNode }) {
  return typeof value === "string" ? <span className="whitespace-nowrap">{value}</span> : value;
}

export function MetricCard({ label, value, hint, variant = "standard", tone = "neutral" }: MetricCardProps) {
  if (variant === "hero") {
    return (
      <div className="hero-panel min-w-0" aria-live="polite" aria-atomic="true">
        <div className="eyebrow">{label}</div>
        <div className={`metric-num mt-3 min-w-0 text-4xl leading-none sm:text-5xl ${toneClass[tone]}`}>
          <MetricValue value={value} />
        </div>
        {hint ? <p className="mt-3 max-w-xl text-sm leading-6 text-muted">{hint}</p> : null}
      </div>
    );
  }

  return (
    <div className="card min-w-0 p-4 sm:p-5">
      <div className="label">{label}</div>
      <div className={`metric-num mt-2 min-w-0 text-2xl leading-tight ${toneClass[tone]}`}>
        <MetricValue value={value} />
      </div>
      {hint ? <p className="mt-2 text-sm leading-5 text-muted">{hint}</p> : null}
    </div>
  );
}
