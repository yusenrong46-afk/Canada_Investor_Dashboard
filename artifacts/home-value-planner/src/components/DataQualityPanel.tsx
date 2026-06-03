import { AlertTriangle } from "lucide-react";

interface DataQualityPanelProps {
  notes: string[];
  warningCount: number;
}

export function DataQualityPanel({ notes, warningCount }: DataQualityPanelProps) {
  return (
    <div className="rounded-card border border-warning/30 bg-warning/10 p-5">
      <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.16em] text-warning">
        <AlertTriangle className="h-4 w-4" />
        Data quality
      </div>
      <div className="mt-2 text-sm font-semibold text-ink">
        {warningCount} warning or review note{warningCount === 1 ? "" : "s"}
      </div>
      <div className="mt-3 space-y-2">
        {notes.map((note) => (
          <p key={note} className="text-sm leading-6 text-body">
            {note}
          </p>
        ))}
      </div>
    </div>
  );
}
