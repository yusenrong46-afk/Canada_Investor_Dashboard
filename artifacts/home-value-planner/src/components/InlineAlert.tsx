import type { ReactNode } from "react";

type InlineAlertTone = "warning" | "error" | "info";

interface InlineAlertProps {
  tone?: InlineAlertTone;
  children: ReactNode;
  role?: "alert" | "status";
}

const toneClasses: Record<InlineAlertTone, string> = {
  warning: "border-warning/30 bg-warning/10 text-warning",
  error: "border-danger/30 bg-danger/10 text-danger",
  info: "border-brand-200 bg-brand-50 text-brand-800",
};

export function InlineAlert({ tone = "warning", children, role }: InlineAlertProps) {
  return (
    <div role={role ?? (tone === "error" ? "alert" : "status")} className={`rounded-card border px-4 py-3 text-sm ${toneClasses[tone]}`}>
      {children}
    </div>
  );
}
