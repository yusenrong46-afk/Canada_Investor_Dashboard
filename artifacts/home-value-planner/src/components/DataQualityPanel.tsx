interface DataQualityPanelProps {
  notes: string[];
  warningCount: number;
}

export function DataQualityPanel({ notes, warningCount }: DataQualityPanelProps) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-amber-700">Data quality</div>
      <div className="mt-2 text-sm font-semibold text-amber-900">{warningCount} warning or review note{warningCount === 1 ? "" : "s"}</div>
      <div className="mt-3 space-y-2">
        {notes.map((note) => (
          <p key={note} className="text-sm leading-6 text-amber-900">
            {note}
          </p>
        ))}
      </div>
    </div>
  );
}
