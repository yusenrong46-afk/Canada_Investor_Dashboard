# Interview Summary — Canada Investor Dashboard

## 30-Second Explanation

This is a full-stack real estate analytics dashboard that helps users estimate property value, evaluate renovation upside, and turn messy property data into a practical investment plan.

## What I Built

- React/TypeScript dashboard
- Express REST API
- Python model service
- Data cleaning and validation workflow
- Model metrics report
- Data quality report
- Demo-safe sample mode
- Business insights page
- Scenario workspace for saved user comparisons

## What I Learned

- How to connect ML outputs to user-facing decisions
- How to make model limitations visible
- How to handle messy and incomplete data
- How to design a dashboard around decisions, not just charts
- How to turn a single prediction workflow into a saved scenario workspace

## Limitations

- The model estimates listing price, not final sale price.
- Renovation uplift still needs better Vancouver before/after sale labels.
- Demo mode uses precomputed sample outputs so the project can be reviewed publicly.
- The dashboard supports screening, but it does not replace appraisal, inspection, or comparable-sale analysis.

## What I Would Improve Next

- Better sale-price data
- More local renovation uplift data
- More robust geospatial features
- Authentication / saved projects
- Database-backed scenario history
- Production deployment
