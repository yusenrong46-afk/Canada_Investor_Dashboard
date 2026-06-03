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
    <section className={`card p-5 sm:p-6 ${className}`}>
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
          <h3 className="font-display text-lg text-ink">{title}</h3>
          {description ? <p className="max-w-2xl text-sm leading-6 text-muted">{description}</p> : null}
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}
