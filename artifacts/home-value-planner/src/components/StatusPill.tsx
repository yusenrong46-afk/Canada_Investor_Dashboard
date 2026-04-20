interface StatusPillProps {
  value: string;
}

export function StatusPill({ value }: StatusPillProps) {
  const tone =
    value === "Likely" || value === "likely"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
      : value === "Stretch" || value === "stretch"
        ? "bg-amber-50 text-amber-700 ring-amber-100"
        : value === "Unlikely" || value === "unlikely"
          ? "bg-rose-50 text-rose-700 ring-rose-100"
        : value === "not-assessed"
          ? "bg-slate-100 text-slate-600 ring-slate-200"
          : "bg-rose-50 text-rose-700 ring-rose-100";

  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-sm font-bold ring-1 ${tone}`}>
      {value.replace("-", " ")}
    </span>
  );
}
