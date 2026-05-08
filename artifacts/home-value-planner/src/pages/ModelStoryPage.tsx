import { Link } from "react-router-dom";

import { SectionCard } from "../components/SectionCard";

export function ModelStoryPage() {
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-soft">
        <div className="max-w-3xl">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-sound-600">Portfolio story</div>
          <h1 className="mt-2 font-display text-4xl leading-tight text-cedar">Vancouver investor deal analyzer with honest ML boundaries</h1>
          <p className="mt-3 text-base leading-7 text-slate-500">
            The flagship version turns a listing-price model into a practical investor workflow: estimate value, compare asking price, model
            renovation scenarios, explain risk, and show exactly where the data stops supporting stronger claims.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/" className="rounded-full bg-cedar px-5 py-3 text-sm font-semibold text-white transition hover:bg-slateblue">
              Open analyzer
            </Link>
            <Link to="/estimate" className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400">
              Inspect model
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          ["Real product value", "A buyer can sanity-check one Vancouver deal before spending time on deeper diligence."],
          ["Data science judgment", "The app predicts listing price, while renovation uplift uses observed Seattle repeat-sale percentages instead of fake labels."],
          ["Engineering breadth", "React dashboard, Express API, Python model service, validation, docs, tests, and an explainer assistant."],
        ].map(([title, body]) => (
          <div key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
            <div className="font-display text-xl text-cedar">{title}</div>
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
            Built a Vancouver real-estate investor dashboard using Python, scikit-learn/XGBoost, Express, and React. The system estimates as-is
            listing value, compares asking price to model value, simulates renovation upside from observed Seattle repeat-sale percentages, and flags investor risk.
          </p>
          <p>
            The project separates the Vancouver base-price model from the Seattle-trained uplift layer because Vancouver public data does not expose
            enough property-level before/after resale outcomes. That decision is visible in the UI, API, docs, and assistant answers.
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title="Dashboard concepts this teaches"
        eyebrow="Learning map"
        description="Each screen maps to a common dashboard engineering skill."
      >
        <div className="grid gap-3 md:grid-cols-2">
          {[
            ["Inputs", "Controlled forms, validation, persisted state, and API request shapes."],
            ["Metrics", "Currency/percent formatting, confidence ranges, and KPI cards."],
            ["Charts", "Value-gap and upside visuals that support decisions instead of decoration."],
            ["Trust", "Warnings, limitations, model quality, citations, and graceful fallback states."],
          ].map(([title, body]) => (
            <div key={title} className="rounded-xl bg-slate-50 px-4 py-3">
              <div className="text-sm font-semibold text-cedar">{title}</div>
              <div className="mt-1 text-sm leading-6 text-slate-500">{body}</div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
