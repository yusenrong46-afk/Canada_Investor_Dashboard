import { Link } from "react-router-dom";

import { AssistantPanel } from "../components/AssistantPanel";
import { SectionCard } from "../components/SectionCard";

export function ModelStoryPage() {
  const modelRows = [
    ["Base model", "Vancouver listing data", "3,518 usable rows", "As-is listing value by property type."],
    ["Uplift model", "Seattle/King County observed repeat sales", "633 repeat-sale rows", "Renovation uplift percentage, transferred carefully to Vancouver."],
    ["Validation", "Train/holdout, cross-validation, bootstrap", "12.6% overall holdout MAPE", "Enough to screen deals, not enough to replace appraisal work."],
  ];

  const nextDataRows = [
    ["BC Assessment custom extract", "The biggest upgrade: real BC sales, assessment inventory, permits, and property attributes."],
    ["City of Vancouver permits", "Local renovation signal that can replace the Seattle bridge once joined to actual Vancouver sales."],
    ["Property tax, parcels, zoning", "Better location, age, land value, improvement value, and zoning features."],
    ["Census, CMHC, TransLink", "Neighbourhood demand, income, rental market, and transit-access features."],
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-8 shadow-soft">
        <div className="max-w-3xl">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-sound-600">Model & data story</div>
          <h1 className="mt-2 font-display text-4xl leading-tight text-cedar">How I built the deal analyzer, and where I would improve it next</h1>
          <p className="mt-3 text-base leading-7 text-slate-500">
            I kept this project focused on one practical question: is this Vancouver deal worth deeper review? The model helps with screening,
            but I also show the data limits clearly because real estate models can become misleading fast.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/" className="rounded-full bg-cedar px-5 py-3 text-sm font-semibold text-white transition hover:bg-slateblue">
              Open analyzer
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        {modelRows.map(([title, source, metric, body]) => (
          <div key={title} className="rounded-lg border border-slate-200 bg-white p-5 shadow-soft">
            <div className="font-display text-xl text-cedar">{title}</div>
            <div className="mt-3 text-[11px] font-extrabold uppercase tracking-[0.16em] text-sound-600">{source}</div>
            <div className="mt-1 text-sm font-semibold text-slate-700">{metric}</div>
            <p className="mt-2 text-sm leading-6 text-slate-500">{body}</p>
          </div>
        ))}
      </div>

      <SectionCard
        title="How to explain it in an interview"
        eyebrow="Resume narrative"
        description="The strongest story is not that the model is perfect. The strongest story is that the product tells the user what the model can and cannot know."
      >
        <div className="space-y-3 text-sm leading-6 text-slate-600">
          <p>
            I built this as a full-stack data science project, not just a notebook. The React app gives the investor workflow, the Express API
            keeps validation and deal math in one place, and the Python service owns the model training and inference.
          </p>
          <p>
            The important judgment call was not pretending the Vancouver listing data had renovation labels. The base model stays Vancouver-specific,
            while the uplift layer uses observed Seattle repeat-sale percentages until I can get local transaction data.
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title="Data I would add next"
        eyebrow="Model quality"
        description="The next jump is not a fancier algorithm first. It is better joined data."
      >
        <div className="grid gap-3 md:grid-cols-2">
          {nextDataRows.map(([title, body]) => (
            <div key={title} className="rounded-xl bg-slate-50 px-4 py-3">
              <div className="text-sm font-semibold text-cedar">{title}</div>
              <div className="mt-1 text-sm leading-6 text-slate-500">{body}</div>
            </div>
          ))}
        </div>
      </SectionCard>

      <AssistantPanel />
    </div>
  );
}
