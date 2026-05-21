interface ModelTrustSummaryProps {
  modeNote: string;
}

export function ModelTrustSummary({ modeNote }: ModelTrustSummaryProps) {
  const rows = [
    ["Prediction target", "Listing value, not final sale price"],
    ["Best use", "Deal screening and interview demo"],
    ["Needs review", "Comparable sales, exact condition, financing, taxes, and closing costs"],
  ];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-soft">
      <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-sound-600">Model trust</div>
      <p className="mt-2 text-sm leading-6 text-slate-600">{modeNote}</p>
      <div className="mt-4 grid gap-2">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-1 rounded-lg bg-slate-50 px-3 py-2 sm:grid-cols-[150px,minmax(0,1fr)]">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
            <div className="text-sm text-slate-700">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
