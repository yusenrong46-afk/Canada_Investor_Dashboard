interface MetricCardProps {
  label: string;
  value: string;
  hint?: string;
}

export function MetricCard({ label, value, hint }: MetricCardProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-soft">
      <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 font-display text-[28px] leading-none text-cedar">{value}</div>
      {hint ? <p className="mt-2 text-sm leading-5 text-slate-500">{hint}</p> : null}
    </div>
  );
}
