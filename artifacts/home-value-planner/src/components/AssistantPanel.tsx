import { FormEvent, useState } from "react";

import { postAssistantQuery } from "../api/client";
import type { AssistantQueryResponse } from "../types";

const starterQuestions = [
  "Why is renovation uplift rule-based?",
  "What does the base model use?",
  "How should I read the confidence range?",
];

export function AssistantPanel() {
  const [question, setQuestion] = useState(starterQuestions[0]);
  const [response, setResponse] = useState<AssistantQueryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const askQuestion = (nextQuestion = question) => {
    const trimmed = nextQuestion.trim();
    if (!trimmed) {
      return;
    }

    setQuestion(trimmed);
    setLoading(true);
    setError(null);
    postAssistantQuery({ question: trimmed, topK: 4 })
      .then(setResponse)
      .catch((caughtError: Error) => setError(caughtError.message))
      .finally(() => setLoading(false));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    askQuestion();
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-soft">
      <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-sound-600">Project explainer</div>
      <h2 className="mt-1 font-display text-xl text-cedar">Ask how the dashboard works</h2>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        Retrieval-first assistant over the project docs, model card, API contract, and metrics. It cites sources instead of inventing answers.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        <textarea
          className="field min-h-24 resize-none"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={500}
        />
        <button
          type="submit"
          className="rounded-full bg-cedar px-5 py-3 text-sm font-semibold text-white transition hover:bg-slateblue disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading}
        >
          {loading ? "Searching docs" : "Ask"}
        </button>
      </form>

      <div className="mt-4 flex flex-wrap gap-2">
        {starterQuestions.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => askQuestion(item)}
            className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-sound-300 hover:text-sound-700"
          >
            {item}
          </button>
        ))}
      </div>

      {error ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{error}</div> : null}

      {response ? (
        <div className="mt-5 space-y-4">
          <div className="rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">
            <div className="mb-2 text-xs font-extrabold uppercase tracking-[0.16em] text-slate-500">Confidence: {response.confidence}</div>
            {response.answer}
          </div>
          <div className="space-y-3">
            {response.citations.map((citation) => (
              <div key={`${citation.source}-${citation.score}`} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-cedar">{citation.title}</div>
                  <div className="text-xs text-slate-500">{citation.source}</div>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-500">{citation.snippet}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
