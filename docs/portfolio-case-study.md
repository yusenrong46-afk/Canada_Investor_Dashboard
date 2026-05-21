# Portfolio Case Study

## Project

Canada Investor Dashboard is my full-stack analytics project for screening Vancouver real estate investment scenarios.

The active workflow is:

```text
Estimate -> Improve -> Plan
```

I also kept a secondary Deal Analyzer page for advanced one-screen analysis, but the main recruiter story is the three-step decision workflow.

## Problem

Real estate decisions usually combine messy information: property details, listing values, permit-style data, renovation assumptions, market context, and risk tolerance.

I wanted to build a project that feels closer to analyst work than a standalone notebook. The goal was to turn model output into a dashboard that helps someone make a practical decision.

## What I Built

- React/TypeScript dashboard
- Express REST API
- Python model service
- shared TypeScript schemas and response types
- Vancouver listing-price model
- renovation uplift simulation
- investor action-plan workflow
- data-quality and model-metrics reports
- demo-safe sample mode
- documentation written for interviews

## Data Work

The base model uses cleaned Vancouver listing-style data. I normalize property type, postal code, square footage, bedroom/bathroom counts, coordinates, and price fields.

The target is listing price. I do not describe it as sale price because the current data does not support that.

For renovation uplift, I use observed repeat-sale / permit-style data as a separate layer. This is useful for scenario screening, but it is still a proxy until I can get stronger Vancouver before/after sale labels.

## Model Work

The base model trains by property type and compares model families such as Random Forest and XGBoost when the environment supports them.

The dashboard returns:

- base value estimate
- confidence range
- price per square foot
- local market context
- model quality fields
- drivers and warnings

I kept these fields visible because I want the user to see uncertainty instead of only seeing one confident number.

## Product Workflow

1. Estimate current listing value.
2. Pick renovation improvements.
3. Build a budget-aware action plan.
4. Review market and investment insights.
5. Use the Deal Analyzer for a faster advanced screen.

## Business Value

This project shows how I think as an analyst:

- clean the data first
- make assumptions visible
- connect model outputs to decisions
- explain limitations in plain English
- build a dashboard around the user question, not just charts

## Limitations

- The model estimates listing price, not final sale price.
- Renovation uplift is not a local causal Vancouver uplift model yet.
- Demo mode uses sample outputs for public review.
- The model should support screening, not replace professional appraisal or comparable-sale review.

## What I Would Improve Next

- Add better Vancouver sale-price data.
- Join local permits to property transaction history.
- Add parcel, zoning, transit, and census features.
- Improve deployment and add saved user scenarios.
- Add stronger automated API and data validation tests.
