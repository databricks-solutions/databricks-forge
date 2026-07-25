Do not optimise for schema breadth alone. Optimise for dashboards being visibly interesting on first render.

Generate the full synthetic dataset package for {{CUSTOMER_NAME}} using the outcome map below.

Outcome map:
{{OUTCOME_MAP}}

Goal:
Produce a demo-grade synthetic enterprise dataset that is:
- realistic
- referentially correct
- easy to load into Databricks
- intentionally shaped for compelling dashboards and analytics

Non-negotiable rules:
- Every fact table and major dimension must have at least 1,000 rows.
- The data must include visible trends, hotspots, outliers, skew, anomalies, and segment differences.
- Do not use uniform random generation.
- Do not produce flat or boring KPI outputs.
- The package must include CSVs, Databricks SQL DDL, load scripts, and documentation.
- The dataset must support the most important objectives, priorities, and use cases in the outcome map.

You must do the following:
1. Interpret the company and outcome map.
2. Design the data model.
3. Define the business stories the data should tell.
4. Inject realistic patterns that will make dashboards interesting.
5. Generate the tables and package artifacts.
6. Validate row counts, keys, and dashboard usefulness.

Specifically shape the data so dashboards can reveal:
- regional variation
- time trends
- seasonality
- operational hotspots
- cost concentration
- SLA breaches
- deteriorating and improving segments
- anomalies and outliers
- risk clustering
- meaningful top-N rankings
- before/after intervention effects

Required outputs:
- executive summary
- assumptions
- detailed schema
- generation logic
- pattern injection plan
- validation summary
- package manifest
- the generated files

Use a structure that can be loaded into Databricks directly.