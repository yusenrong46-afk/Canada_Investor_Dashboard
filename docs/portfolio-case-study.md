# Portfolio Case Study: Vancouver Deal Analyzer

## One-Line Pitch

I built a full-stack Vancouver real-estate deal analyzer that estimates as-is value, compares it with asking price, models renovation upside, flags risk, and explains the model/data limits with a cited RAG-style assistant.

## Why I Changed The Shape

The previous app had separate Estimate, Improve, Plan, and Deal Analyzer screens. That was useful while building, but it made the project feel heavier than it needed to be.

I simplified it into two screens:

```text
Deal Analyzer
Model & Data Story
```

That gives the project a cleaner interview story. The main screen answers the investor question. The second screen explains how the model works, what data trained it, and what I would improve next.

## What I Am Proud Of

- I connected a React frontend, Express API, Python ML service, validation, tests, docs, and local model inference.
- I trained property-type-specific Vancouver listing-price models instead of one generic model.
- I did not fake renovation labels. The uplift layer uses real Seattle/King County permits, sales, and residential-building records.
- I moved repeated frontend/API contracts into shared TypeScript types and Zod schemas.
- I moved older prototype layers into `legacy/` so the active product is easier to understand.

## Interview Story

The strongest decision in this project was not pretending the Vancouver listing data could answer every question.

The Vancouver data supports an as-is listing-price model. It does not support a true renovation-uplift model because it does not show the same property before renovation, the renovation event, and the resale after renovation.

So I separated the system:

- Vancouver data estimates the base value.
- Seattle/King County observed repeat-sale data estimates uplift percentage.
- The UI and docs explain that this is a transfer-learning bridge, not a final local uplift model.

## Resume Bullet

Built a full-stack Vancouver real-estate deal analyzer using React, TypeScript, Express, Python, scikit-learn, and XGBoost. Trained property-type-specific listing-price models on cleaned Vancouver data, added an observed repeat-sale renovation uplift layer from Seattle/King County permits and sales, simplified the product into a deal-screening workflow, and exposed model limitations through risk flags and a cited project assistant.

## Next Honest Upgrade

The next serious model upgrade is not deep learning first. It is better data.

I would try to get a BC Assessment custom extract with property-level sales, assessment, inventory, permit, and structural fields. Then I would join it to City of Vancouver permits and build a local uplift target:

```text
post-renovation sale price - counterfactual as-is value at post-sale date
```

After that, I would compare tuned gradient boosting, random forest, and simple explainable baselines again.
