# Portfolio Case Study: Vancouver Investor Deal Analyzer

## One-line Pitch

An investor-facing Vancouver real-estate dashboard that estimates as-is listing value, compares it with asking price, models renovation upside, flags risk, and explains the model's limitations with cited project documentation.

## Why This Is A Flagship Project

- It shows end-to-end engineering: React dashboard, Express API, Python ML service, validation, tests, documentation, and local model inference.
- It shows data science judgment: the base price model is trained on Vancouver listings, while renovation uplift uses real Seattle/King County repeat-sale records instead of fake labels.
- It gives a real user workflow: a buyer can screen one Vancouver deal before spending time on deeper comparable-sale, financing, permit, and contractor diligence.

## What The Dashboard Teaches

- Controlled inputs and persisted state.
- KPI cards for value gap, gross upside, and planned spend.
- Charts that support a decision instead of decorating the page.
- Trust design: confidence ranges, risk flags, model-card notes, and cited assistant answers.
- API design: schemas, typed responses, error handling, and backend orchestration.

## Resume Bullet

Built a Vancouver real-estate investor dashboard using Python, scikit-learn/XGBoost, Express, and React. Trained property-type-specific listing-price models with validation metrics, then added a deal analyzer that compares asking price to modeled value, estimates renovation upside from Seattle observed repeat-sale percentages, and surfaces risk flags and model limitations through a cited project explainer.

## Interview Story

The strongest decision in the project was not pretending the Vancouver listing data had renovation labels. I kept the base model Vancouver-specific, then built the uplift layer from real Seattle permit, sale, and residential-building records so the app learns percentage uplift from observed repeat sales instead of synthetic examples.

## Next Honest Upgrade

The next data science upgrade is a property-level transaction dataset joined to renovation permits and assessment history. That would allow a true uplift target:

```text
post-renovation sale price - counterfactual as-is value at post-sale date
```
