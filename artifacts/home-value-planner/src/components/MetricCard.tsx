type MetricTone = "neutral" | "success" | "warning" | "danger";

interface MetricCardProps {
  label: string;
  value: string;
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

export function MetricCard({ label, value, hint, variant = "standard", tone = "neutral" }: MetricCardProps) {
  if (variant === "hero") {
    return (
      <div className="hero-panel min-w-0 bg-gradient-to-br from-surface to-brand-50/40">
        <div className="eyebrow">{label}</div>
        <div className={`metric-num mt-3 break-words text-4xl leading-none sm:text-5xl ${toneClass[tone]}`}>{value}</div>
        {hint ? <p className="mt-3 max-w-xl text-sm leading-6 text-muted">{hint}</p> : null}
      </div>
    );
  }

  return (
    <div className="card min-w-0 p-4 sm:p-5">
      <div className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-muted">{label}</div>
      <div className={`metric-num mt-2 break-words text-xl leading-tight ${toneClass[tone]}`}>{value}</div>
      {hint ? <p className="mt-2 text-sm leading-5 text-muted">{hint}</p> : null}
    </div>
  );
}
