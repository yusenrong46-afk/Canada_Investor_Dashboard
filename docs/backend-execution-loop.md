# Backend reliability execution loop

Use this prompt to continue the backend work across Codex turns without losing the original scope or declaring success from partial fixes.

## Loop prompt

```text
You are continuing the Canadian Investor Dashboard backend reliability program in:
/Users/thomas/Documents/canadian-investor-dashboard

Objective
Complete Goals G1-G3 in docs/backend-execution-goals.md, in order:
1. Resume-release truth pass.
2. Persistent, observable backend foundation.
3. Cost-complete and defensible decision engine.

Do not begin the moat, an LLM feature, or new-market work until all three release gates pass.

Authoritative state
- Treat the current worktree, deployed Vercel API, tests, generated reports, and goal ledger as authoritative.
- Existing changes may be incomplete user work. Inspect diffs before editing and preserve unrelated changes.
- A passing unit test is evidence only for the behaviour it directly covers.
- Production completion requires a production check; local behaviour is not production proof.

Loop
1. Read docs/backend-execution-goals.md and identify the highest-priority unchecked requirement whose dependencies are satisfied.
2. Inspect the current implementation and existing diff for that requirement.
3. State the narrow vertical slice being executed and the evidence that will prove it.
4. Implement the slice completely, including contracts, failure behaviour, tests, documentation, and migration compatibility where applicable.
5. Run the smallest focused checks first, then the broader affected test/build suite.
6. If the slice affects deployed behaviour, verify the production endpoint after deployment; do not use local results as a substitute.
7. Record commands, results, files, unresolved risks, and the next slice in the goal ledger.
8. Re-audit the release gate. Mark an item complete only when direct evidence proves it.
9. Repeat until the active goal's release gate passes, then move to the next goal.

Non-negotiable product invariants
- A rules result must never claim to be XGBoost, random forest, calibrated, causal, or fully observed.
- Demonstration data must never look like user, portfolio, or market-wide production data.
- Valuation, uplift, plan, and deal calculations must expose their engine, evidence strength, validation state, version, data date, source IDs, and limitations.
- Gross appreciation must never be presented as net investment return.
- Scenario shares from an assumed distribution must never be called calibrated probabilities.
- Missing evidence produces an abstention or explicit assumption, never an invented fallback.
- Training never occurs inside an inference request or production startup fallback.
- Every persisted decision must be reproducible from saved inputs, assumptions, evidence IDs, code/model version, and data version.
- An LLM may eventually explain verified structured results, but it may not become the authority for valuation or deal arithmetic.

Release order
- G1 must pass before database/authentication work changes the public workflow.
- G2 must pass before decision outputs are used to collect moat data.
- G3 must pass before any strong recommendation or probability language is restored.

Completion rule
Do not report the program complete until every G1-G3 acceptance item has direct, current evidence in the ledger and all required local plus production gates pass.
```

## How to use it

At the start of each execution turn, pair the loop prompt with the current goal ledger. The ledger contains status; this prompt contains the operating rules. Update the ledger after every verified vertical slice.
