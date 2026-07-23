import type { ResultProvenance } from "@vvl/shared";

const engineLabels: Record<ResultProvenance["engineType"], string> = {
  rules: "Rules-based screen",
  "fitted-model": "Fitted model",
  composite: "Composite screen",
  "precomputed-demo": "Precomputed demo",
};

const evidenceLabels: Record<ResultProvenance["evidenceLevel"], string> = {
  none: "No evidence",
  assumption: "Assumption",
  proxy: "Proxy evidence",
  observed: "Observed evidence",
  mixed: "Mixed evidence",
};

const validationLabels: Record<ResultProvenance["validationStatus"], string> = {
  "not-applicable": "Not applicable",
  unvalidated: "Unvalidated",
  descriptive: "Descriptive only",
  validated: "Validated",
};

interface ProvenanceBadgeProps {
  provenance: ResultProvenance;
  compact?: boolean;
}

export function ProvenanceBadge({ provenance, compact = false }: ProvenanceBadgeProps) {
  return (
    <div className="rounded-field border border-line bg-surface px-3 py-2 text-xs leading-5 text-muted">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-ink">
        <span>
          <span className="font-semibold">Engine:</span> {engineLabels[provenance.engineType]}
        </span>
        <span>
          <span className="font-semibold">Evidence:</span> {evidenceLabels[provenance.evidenceLevel]}
        </span>
        <span>
          <span className="font-semibold">Validation:</span> {validationLabels[provenance.validationStatus]}
        </span>
        {!compact ? (
          <span>
            <span className="font-semibold">Contract:</span> {provenance.contractVersion}
          </span>
        ) : null}
      </div>
      {provenance.limitations.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-4">
          {provenance.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
