interface ModelTrustSummaryProps {
  modeNote: string;
  intervalMethod?: "conformal" | "error-ratio";
}

export function ModelTrustSummary({ modeNote, intervalMethod }: ModelTrustSummaryProps) {
  const rows = [
    ["Prediction target", "Listing value, not final sale price"],
    ["Best use", "Deal screening and interview demo"],
    ...(intervalMethod ? [["Interval method", intervalMethod === "conformal" ? "Split conformal (80% target)" : "Error-ratio heuristic"]] : []),
    ["Needs review", "Comparable sales, exact condition, financing, taxes, and closing costs"],
  ];

  return (
    <div className="card-pad">
      <div className="eyebrow">Model trust</div>
      <p className="mt-2 text-sm leading-6 text-body">{modeNote}</p>
      <div className="mt-4 grid gap-2">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-1 rounded-field bg-canvas px-3 py-2 sm:grid-cols-[150px,minmax(0,1fr)]">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{label}</div>
            <div className="text-sm text-ink">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
