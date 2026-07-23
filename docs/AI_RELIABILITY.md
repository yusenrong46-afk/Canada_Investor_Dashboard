# AI and model reliability boundary

## Current state

This product does **not** currently use an LLM, RAG pipeline, or free-form generated answer in its decision path. Live value estimates come from fitted tree models; explanations are SHAP attributions. Public-mode estimates use labeled deterministic rules. Renovation results come from observed repeat-sale evidence or explicitly abstain.

This boundary matters: a polished natural-language sentence must never be treated as stronger evidence than the structured model result that produced it.

## Safeguards now enforced

- The API reports its actual runtime mode (`live-model`, `public-interactive`, or `demo-samples`) and the UI displays it.
- Live mode never fills the insights page with demo scenarios.
- Public rules do not inherit or display validation metrics from a different fitted model.
- Model and evidence claims are market-aware; Halifax output cannot reuse Seattle/Vancouver wording.
- Halifax improvement controls disclose that several scopes map to one broad permit-renovation signal and therefore do not stack.
- Deal verdicts deduct planned renovation spend, propagate the observed uplift range, and list major costs still excluded.
- Machine-specific absolute paths are removed from user-facing provenance and health responses.
- Invalid or unsupported inputs abstain instead of using a made-up geography fallback.
- Model-service calls have a bounded timeout and server errors return a safe message.

## Gate for any future LLM feature

An assistant or generated narrative must not ship until it has all of the following:

1. Structured input assembled only from the current estimate, plan, evidence, and provenance objects.
2. Structured output validated against a strict schema; no executable HTML, SQL, shell, or tool instruction is trusted from model text.
3. Sentence-level evidence identifiers for every quantitative or market claim.
4. Deterministic cross-checks that reject mismatched market names, unsupported numbers, stale sources, and contradictions with the API payload.
5. Clear uncertainty and abstention language when evidence is missing or conflicting.
6. Human approval before any high-impact action or external side effect.
7. An adversarial evaluation set covering prompt injection, indirect injection in retrieved text, unsupported citations, numeric drift, market mix-ups, sycophancy, and overconfident recommendations.
8. Rate, token, time, and cost limits with monitoring and a kill switch.

## Source basis

- [NIST AI 600-1, Generative AI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf) identifies confabulation as confidently presented false content and highlights the extra risk in consequential decision support.
- [OWASP LLM01: Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) recommends constrained model behaviour, output validation, least privilege, and human approval for high-risk actions.
- [OWASP LLM05: Improper Output Handling](https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/) requires zero-trust treatment and context-aware validation of model output.
- [OWASP LLM09: Misinformation](https://genai.owasp.org/llmrisk/llm092025-misinformation/) recommends cross-verification, automatic validation, risk communication, and human oversight.
- [OWASP LLM10: Unbounded Consumption](https://genai.owasp.org/llmrisk/llm102025-unbounded-consumption/) covers resource, cost, and denial-of-service controls.
