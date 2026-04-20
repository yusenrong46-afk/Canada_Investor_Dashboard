import type { PropsWithChildren, ReactNode } from "react";

interface SectionCardProps extends PropsWithChildren {
  title: string;
  eyebrow?: string;
  description?: string;
  aside?: ReactNode;
  className?: string;
}

export function SectionCard({ title, eyebrow, description, aside, className = "", children }: SectionCardProps) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-soft ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          {eyebrow ? <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-sound-600">{eyebrow}</div> : null}
          <h3 className="font-display text-lg text-cedar">{title}</h3>
          {description ? <p className="max-w-2xl text-sm leading-6 text-slate-500">{description}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
