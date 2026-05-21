# Optimization Refactor Notes

This refactor was about making the project easier to explain and easier for me to edit.

## What I Reduced

### Frontend Pages

Before:

```text
Estimate -> Improve -> Plan -> Deal Analyzer -> Model Story
```

After:

```text
Deal Analyzer
Model & Data Story
```

The old pages are still in `legacy/frontend-three-step-pages/`, but they are no longer part of the active app.

### API Endpoints

Before:

```text
POST /api/estimate
POST /api/simulate
POST /api/plan
POST /api/deal/analyze
POST /api/assistant/query
```

After:

```text
POST /api/deal/analyze
POST /api/assistant/query
```

The API still has internal helper functions for estimate, simulate, and plan logic. I only reduced the public surface because the frontend does not need to call every intermediate step.

### Duplicate TypeScript Types

Before, the frontend and API had separate copies of many types.

After, shared contracts live in:

```text
artifacts/shared/src/constants.ts
artifacts/shared/src/schemas.ts
artifacts/shared/src/types.ts
```

Junior-level explanation:

- `constants.ts`: values the whole app agrees on
- `schemas.ts`: runtime validation with Zod
- `types.ts`: TypeScript shapes for editor help and safer code

### Python Model Service

Before:

```text
model-service/service.py
model-service/uplift_service.py
```

After:

```text
model-service/base_model/core.py
model-service/uplift_model/core.py
model-service/service.py          compatibility wrapper
model-service/uplift_service.py   compatibility wrapper
```

The wrappers keep tests and older imports working. The active routes now import from `base_model` and `uplift_model`.

## What I Would Improve Next

1. Split `base_model/core.py` further into cleaning, features, training, inference, and market context.
2. Split `uplift_model/core.py` further into data loading, repeat-sale row building, training, and inference.
3. Add frontend tests for the Deal Analyzer page.
4. Build the RAG assistant manually so I understand retrieval, chunking, scoring, citations, and answer generation instead of treating it like a black box.
