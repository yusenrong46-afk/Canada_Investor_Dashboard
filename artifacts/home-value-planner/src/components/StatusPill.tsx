interface StatusPillProps {
  value: string;
}

export function StatusPill({ value }: StatusPillProps) {
  const normalized = value.toLowerCase();
  const tone =
    normalized === "likely"
      ? "bg-success/10 text-success ring-success/20"
      : normalized === "stretch"
        ? "bg-warning/10 text-warning ring-warning/20"
        : normalized === "unlikely"
          ? "bg-danger/10 text-danger ring-danger/20"
          : normalized === "not-assessed"
            ? "bg-canvas text-muted ring-line"
            : "bg-danger/10 text-danger ring-danger/20";

  const dot =
    normalized === "likely"
      ? "bg-success"
      : normalized === "stretch"
        ? "bg-warning"
        : normalized === "not-assessed"
          ? "bg-muted"
          : "bg-danger";

  return (
    <span className={`inline-flex items-center gap-2 rounded-pill px-3 py-1 text-sm font-bold ring-1 ${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {value.replace("-", " ")}
    </span>
  );
}
