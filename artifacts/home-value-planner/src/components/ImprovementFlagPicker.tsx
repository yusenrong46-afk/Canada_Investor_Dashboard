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
            className={`rounded-lg border px-4 py-4 text-left transition ${
              active
                ? "border-sound-400 bg-sound-50 shadow-soft"
                : "border-slate-200 bg-white hover:border-slate-300"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-cedar">{option.label}</div>
                <div className="mt-1 text-sm leading-6 text-slate-500">{option.hint}</div>
              </div>
              <div
                className={`mt-1 h-5 w-5 rounded-full border-2 ${
                  active ? "border-sound-600 bg-sound-600" : "border-slate-300 bg-white"
                }`}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}
