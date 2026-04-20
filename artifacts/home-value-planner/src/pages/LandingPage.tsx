import { Link } from "react-router-dom";

import { SectionCard } from "../components/SectionCard";

export function LandingPage() {
  const roadmapItems = [
    {
      title: "Estimate today",
      body: "Use the live Vancouver base-price model trained on real listing data.",
      href: "/estimate",
      cta: "Open estimate",
    },
    {
      title: "Simulate next",
      body: "Test a transparent rule-based uplift engine that applies cost-recovery, feasibility, timeline, and market-ceiling rules.",
      href: "/simulate",
      cta: "Open simulator",
    },
    {
      title: "Plan the sale",
      body: "Turn the rule engine into a budget-aware action list with phases and a realistic target check.",
      href: "/plan",
      cta: "Open planner",
    },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-soft">
        <div className="max-w-3xl">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-sound-600">Current release</div>
          <h1 className="mt-2 font-display text-4xl leading-tight text-cedar">
            A Vancouver housing price prediction demo with an honest renovation planning layer.
          </h1>
          <p className="mt-3 text-base leading-7 text-slate-500">
            The estimate uses a real ML model trained on Vancouver listing data. The renovation planner is kept rule-based because this dataset
            does not contain before-and-after resale labels for causal uplift modeling.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/estimate" className="rounded-full bg-cedar px-5 py-3 text-sm font-semibold text-white transition hover:bg-slateblue">
              Start with estimate
            </Link>
            <Link to="/simulate" className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400">
              See what comes next
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        {roadmapItems.map((item) => (
          <Link key={item.title} to={item.href} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft transition hover:border-sound-300">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-sound-600">Step</div>
            <div className="mt-2 font-display text-xl text-cedar">{item.title}</div>
            <p className="mt-2 text-sm leading-6 text-slate-500">{item.body}</p>
            <div className="mt-4 text-sm font-semibold text-sound-700">{item.cta}</div>
          </Link>
        ))}
      </div>

      <SectionCard
        title="What this model uses"
        eyebrow="Model scope"
        description="The project separates the trained listing-price model from the non-ML renovation calculator."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-2xl font-display text-cedar">~3.9k</div>
            <div className="mt-1 text-sm text-slate-500">Usable Vancouver listings in the training dataset</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-2xl font-display text-cedar">4</div>
            <div className="mt-1 text-sm text-slate-500">Supported property types: condo, detached, townhouse, duplex</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-2xl font-display text-cedar">Rules</div>
            <div className="mt-1 text-sm text-slate-500">Uplift assumptions are shown on every simulation and plan result</div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
