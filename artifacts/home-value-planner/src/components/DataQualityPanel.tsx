import { AlertTriangle } from "lucide-react";

import { InlineAlert } from "./InlineAlert";

interface DataQualityPanelProps {
  notes: string[];
  warningCount: number;
}

export function DataQualityPanel({ notes, warningCount }: DataQualityPanelProps) {
  return (
    <InlineAlert tone="warning">
      <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.16em]">
        <AlertTriangle className="h-4 w-4" />
        Data quality
      </div>
      <div className="mt-2 font-semibold text-ink">
        {warningCount} warning or review note{warningCount === 1 ? "" : "s"}
      </div>
      <div className="mt-3 space-y-2">
        {notes.map((note) => (
          <p key={note} className="leading-6 text-body">
            {note}
          </p>
        ))}
      </div>
    </InlineAlert>
  );
}
