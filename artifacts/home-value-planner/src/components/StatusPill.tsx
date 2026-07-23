interface StatusPillProps {
  value: string;
}

export function StatusPill({ value }: StatusPillProps) {
  const normalized = value.toLowerCase();
  const tone =
    normalized.includes("meets target")
      ? "bg-success/10 text-success ring-success/20"
      : normalized.includes("near target")
        ? "bg-warning/10 text-warning ring-warning/20"
        : normalized.includes("below target")
          ? "bg-danger/10 text-danger ring-danger/20"
          : normalized === "not-assessed"
            ? "bg-canvas text-muted ring-line"
            : "bg-danger/10 text-danger ring-danger/20";

  const dot =
    normalized.includes("meets target")
      ? "bg-success"
      : normalized.includes("near target")
        ? "bg-warning"
        : normalized === "not-assessed"
          ? "bg-muted"
          : "bg-danger";

  return (
    <span className={`inline-flex items-center gap-2 rounded-field px-3 py-1 text-sm font-semibold ring-1 ${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {value}
    </span>
  );
}
