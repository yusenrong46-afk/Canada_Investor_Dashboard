import type { PlannedFlag } from "../types";

const improvementOptions: Array<{ flag: PlannedFlag; label: string; hint: string }> = [
  { flag: "renovatedKitchen", label: "Renovated kitchen", hint: "Cabinets, counters, appliances, layout polish." },
  { flag: "renovatedBathrooms", label: "Renovated bathrooms", hint: "Fixtures, tile, vanity, plumbing refresh." },
  { flag: "legalSuiteAdded", label: "Legal suite added", hint: "Secondary suite or lock-off income space." },
  { flag: "energyEfficient", label: "Energy upgrades", hint: "Windows, insulation, HVAC, heat pump." },
  { flag: "curbAppealImproved", label: "Curb appeal", hint: "Facade, entry, paint, landscaping, deck." },
  { flag: "permitIssuesResolved", label: "Permit issues resolved", hint: "Compliance cleanup before listing." },
  { flag: "deferredMaintenanceResolved", label: "Deferred maintenance", hint: "Repairs buyers would notice quickly." },
  { flag: "roofIssueResolved", label: "Roof and systems", hint: "Roofing, furnace, boiler, electrical." },
];

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
            className={`rounded-2xl border px-4 py-4 text-left transition ${
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
