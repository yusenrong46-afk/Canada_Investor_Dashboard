import { Check } from "lucide-react";
import { improvementCatalog, improvementFlagValues, type PlannedFlag } from "@vvl/shared";

const improvementOptions = improvementFlagValues.map((flag) => ({
  flag,
  label: improvementCatalog[flag].label,
  hint: improvementCatalog[flag].hint,
}));

interface ImprovementFlagPickerProps {
  plannedFlags: PlannedFlag[];
  onChange: (flags: PlannedFlag[]) => void;
}

export function ImprovementFlagPicker({ plannedFlags, onChange }: ImprovementFlagPickerProps) {
  const selected = new Set(plannedFlags);

  const toggle = (flag: PlannedFlag) => {
    if (selected.has(flag)) {
      onChange(plannedFlags.filter((item) => item !== flag));
      return;
    }
    onChange([...plannedFlags, flag]);
  };

  return (
    <div className="grid gap-3">
      {improvementOptions.map((option) => {
        const active = selected.has(option.flag);
        return (
          <button
            key={option.flag}
            type="button"
            onClick={() => toggle(option.flag)}
            className={`rounded-card border px-4 py-4 text-left transition ${
              active
                ? "border-brand-400 bg-brand-50 ring-1 ring-brand-200"
                : "border-line bg-surface hover:border-slate-300"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-ink">{option.label}</div>
                <div className="mt-1 text-sm leading-6 text-muted">{option.hint}</div>
              </div>
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${
                  active ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-surface text-transparent"
                }`}
              >
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
