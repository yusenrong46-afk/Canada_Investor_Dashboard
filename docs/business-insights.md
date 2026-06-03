# Business Insights

## Main Business Question

The dashboard answers a simple investor question:

> Is this property worth deeper review after I consider price, renovation upside, budget, timeline, and model risk?

## Current Insight Pages

### Estimate

The Estimate page explains the current listing-value estimate and gives the user a confidence range, price per square foot, and local market context.

### Improve

The Improve page shows how selected renovation work could change the modeled value.

I keep the uplift limitation visible because the current Vancouver data does not contain clean before/after renovation labels.

### Plan

The Plan page turns the estimate and renovation assumptions into an action plan.

It helps answer:

- What work fits the budget?
- What work fits the timeline?
- Does the target price look likely, stretched, or unlikely?
- What should I review manually before trusting the result?

### Market & Investment Insights

The Insights page summarizes saved user scenarios when the user has saved runs in the Scenario Workspace. If no scenarios exist yet, it falls back to demo-safe sample outputs.

- average estimated value
- median estimated value
- average price per square foot
- sample property count
- warnings and data-quality notes
- top sample investment scenarios

### Scenario Workspace

The Scenario Workspace turns the app into a reusable analysis surface instead of a one-result calculator.

Users can save a run from:

- Plan
- Deal Analyzer

Each saved scenario stores:

- property inputs
- selected improvements
- estimate
- achievable value
- budget
- target or asking price
- planned spend
- upside
- risk level
- verdict
- model version

This is intentionally stored in browser localStorage for now. It is simple enough for me to explain in an interview, and it gives the product a real user workflow without adding a database too early.

## How I Would Explain The Value

This project is not just a prediction app. It is a decision-support workflow.

The value is in connecting:

- cleaned data
- model output
- uncertainty
- business rules
- dashboard storytelling
- saved scenario comparison

That is the part I want recruiters to notice.

## Streamlined Product Scope

The active repo now focuses on one complete workflow:

- estimate the current value
- test renovation upside
- build a plan
- save and compare scenarios
- summarize insights from saved scenarios

Older prototypes, dormant database experiments, assistant experiments, and optional deployment artifacts were removed so the codebase is easier to review and explain.

## Current Limitations

- Listing value is not final sale price.
- Uplift outputs need stronger Vancouver permit and resale labels.
- Demo mode uses sample outputs for public review.
- The user still needs comparable-sale review, property inspection, financing assumptions, taxes, and closing-cost analysis.

## Better Data I Would Add

- BC Assessment property and sales data
- City of Vancouver building permits
- property tax data
- parcel polygons
- zoning districts
- census and income features
- rental-market data
- transit-access features

The biggest improvement is better joined data, not a more complicated model first.
