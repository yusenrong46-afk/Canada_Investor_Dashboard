# Demo Script — Canada Investor Dashboard

## Goal

Use this script when I need to demo the project in an interview or walkthrough.

## 30-Second Setup

This is a full-stack real estate analytics dashboard. It estimates Vancouver listing value, tests renovation upside, turns that into an investment plan, and lets me save scenarios into a small workspace for comparison.

The important part is that I am not just showing a model prediction. I am showing how model output becomes a decision workflow.

## Walkthrough

1. Open `Estimate`.
2. Change the property type, square footage, beds, or baths.
3. Explain that the model estimates listing value, not final sale price.
4. Open `Improve`.
5. Select two improvements and show the added value.
6. Open `Plan`.
7. Change target price, budget, and timeline.
8. Click `Save scenario`.
9. Open `Deal Analyzer`.
10. Change asking price or budget and click `Save scenario`.
11. Open `Workspace`.
12. Select two scenarios and compare estimate, achievable value, spend, tag, and risk.
13. Edit a tag or note to show that the workspace is interactive.
14. Click `Use scenario` and explain that it reloads property, improvements, budget, timeline, and target/asking price.
15. Open `Insights`.
16. Show that Insights now uses saved scenarios instead of only demo sample rows.

## What To Say

The strongest explanation:

> I built this to show the full analytics path: data cleaning, model evaluation, API-backed predictions, decision rules, dashboard storytelling, and saved scenario comparison. I also keep the limitations visible because the model estimates listing price, not guaranteed sale price.

## Limitations To Mention

- The base model estimates listing price, not final sale price.
- Renovation uplift is still a scenario-planning layer and needs stronger Vancouver before/after sale labels.
- LocalStorage is enough for a portfolio demo, but database-backed saved projects would be a future production step.
- The result should support screening, not replace appraisal, inspection, or comparable-sale review.

## Best Closing Line

I would improve this next by adding authenticated saved projects, stronger Vancouver sale-price data, and richer geospatial features.
