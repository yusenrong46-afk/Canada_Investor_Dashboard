import type { DealRobustness } from "@vvl/shared";

import { SectionCard } from "../SectionCard";
import { formatPercent, formatSignedCurrency } from "../../lib/format";

function shareTone(share: number): string {
  if (share >= 0.7) {
    return "bg-success/10 text-success ring-success/20";
  }
  if (share >= 0.4) {
    return "bg-warning/10 text-warning ring-warning/20";
  }
  return "bg-danger/10 text-danger ring-danger/20";
}

function ScenarioShareChip({ label, share }: { label: string; share: number }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-pill px-3 py-1.5 text-sm font-bold ring-1 ${shareTone(share)}`}>
      {label}
      <span className="tabular-nums">{formatPercent(share * 100, 0)}</span>
    </span>
  );
}

function UpsideRange({ robustness }: { robustness: DealRobustness }) {
  const low = Math.min(robustness.upsideP10, 0);
  const high = Math.max(robustness.upsideP90, 0);
  const span = high - low || 1;
  const position = (value: number) => `${((value - low) / span) * 100}%`;

  return (
    <div>
      <div className="relative h-3 rounded-pill bg-canvas ring-1 ring-inset ring-line">
        <div
          className="absolute inset-y-0 rounded-pill bg-brand-200"
          style={{ left: position(robustness.upsideP10), width: `calc(${position(robustness.upsideP90)} - ${position(robustness.upsideP10)})` }}
        />
        <div className="absolute inset-y-0 w-1 -translate-x-1/2 rounded-pill bg-brand-700" style={{ left: position(robustness.upsideP50) }} />
        {low < 0 ? <div className="absolute -inset-y-1 w-px -translate-x-1/2 bg-muted" style={{ left: position(0) }} /> : null}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        {([
          ["P10", robustness.upsideP10],
          ["P50", robustness.upsideP50],
          ["P90", robustness.upsideP90],
        ] as const).map(([label, value]) => (
          <div key={label} className={label === "P10" ? "text-left" : label === "P50" ? "text-center" : "text-right"}>
            <div className="font-extrabold uppercase tracking-[0.14em] text-muted">{label}</div>
            <div className={`mt-0.5 font-semibold tabular-nums ${value >= 0 ? "text-ink" : "text-danger"}`}>{formatSignedCurrency(value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface DealRobustnessCardProps {
  robustness: DealRobustness;
}

export function DealRobustnessCard({ robustness }: DealRobustnessCardProps) {
  return (
    <SectionCard
      title="Illustrative deal stress test"
      eyebrow="Assumption-based"
      description={`${robustness.draws.toLocaleString()} seeded triangular draws through the estimate and uplift ranges. These are scenario shares, not calibrated probabilities.`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ScenarioShareChip label="Share with positive net upside" share={robustness.positiveUpsideShare} />
        {robustness.targetAchievableShare != null ? (
          <ScenarioShareChip label="Share reaching target" share={robustness.targetAchievableShare} />
        ) : null}
      </div>
      <div className="mt-5">
        <UpsideRange robustness={robustness} />
      </div>
      <p className="mt-4 text-xs leading-5 text-muted">{robustness.note}</p>
    </SectionCard>
  );
}
