/**
 * Digital Natives & Technology -- Industry Outcome Map
 *
 * Strategic imperatives, priorities, and reference use cases align with the
 * Master Repository v2 taxonomy. Use case names match `digital-natives.enrichment.ts`
 * lookups (keyed by lowercase name) so structured data (model type, KPI
 * targets, benchmarks, dataAssetIds, economic patterns) keeps resolving.
 * Consultant-grade prose was added during the May 2026 outcome-map uplift.
 */

import type { IndustryOutcome } from "./index";

export const DIGITAL_NATIVES: IndustryOutcome = {
  id: "digital-natives",
  name: "Digital Natives & Technology",
  subVerticals: [
    "B2B SaaS",
    "B2C Platforms",
    "FinTech",
    "E-Commerce Platforms",
    "Cloud & Infrastructure",
    "Marketplaces",
    "Streaming & Content",
  ],
  suggestedDomains: [
    "Engineering",
    "Operations",
    "Customer Experience",
    "Finance",
    "Cybersecurity",
    "Product",
    "Data & ML Platform",
    "Trust & Safety",
  ],
  suggestedPriorities: [
    "Drive Innovation",
    "Optimize Operations",
    "Increase Revenue",
    "Reduce Cost",
    "Enhance Experience",
    "Improve Reliability",
  ],
  objectives: [
    {
      name: "Unified Data & AI Platform",
      whyChange:
        "Digital natives win or lose on the speed at which they can move data and AI from product idea to production. Fragmented warehouses, lakehouses, streaming engines, and ML toolchains create an unsustainable ops tax: data engineers spend their time on plumbing instead of product, ML teams ship fewer experiments, and infrastructure costs grow faster than revenue. The leaders are consolidating onto a single lakehouse + governed catalog + shared ML/feature platform so product squads can self-serve real-time data, build ML/AI features, and scale to billions of events without rebuilding the substrate. Doing this now -- before the next product surface (agents, real-time copilots, GenAI) -- is the difference between compounding velocity and compounding tech debt.",
      priorities: [
        {
          name: "Low Latency Real-Time Apps & Analytics",
          useCases: [
            {
              name: "Customer Data Enrichment",
              description:
                "Continuously update and enhance customer profiles with real-time behavioral and transactional signals -- product events, in-app actions, billing changes, support touches -- so every product surface and downstream model sees a single, current view.",
              businessValue:
                "10-20% lift in personalization and growth conversion through fresher, richer profiles; 30-50% reduction in profile staleness incidents.",
              typicalDataEntities: [
                "Customer Profiles",
                "Behavioral Events",
                "Transaction History",
                "Enrichment Attributes",
                "Identity Resolution Graph",
              ],
              typicalSourceSystems: [
                "CDP",
                "Product Analytics",
                "Billing System",
                "CRM",
                "Event Streaming Platform",
              ],
            },
            {
              name: "Identity Resolution",
              description:
                "Recognize users across web, mobile, third-party platforms, and offline touchpoints to build a privacy-respecting unified identity graph that enables consistent personalization, attribution, and compliance with consent.",
              businessValue:
                "20-40% lift in attributable conversions after unified identity rolls out; foundation for every privacy-aware personalization use case.",
              typicalDataEntities: [
                "Identity Graph",
                "Device Identifiers",
                "Cross-Platform Events",
                "User Profiles",
                "Consent Records",
              ],
              typicalSourceSystems: [
                "CDP",
                "Product Analytics",
                "Auth System",
                "Marketing Platform",
                "Consent Management Platform",
              ],
            },
            {
              name: "Real-Time Personalization",
              description:
                "Deliver tailored content, recommendations, search, and offers in millisecond budgets -- powered by streaming feature pipelines, low-latency vector retrieval, and online ML models -- so every user interaction adapts to current intent.",
              businessValue:
                "5-15% lift in engagement / retention / revenue per session vs batch personalization baselines.",
              typicalDataEntities: [
                "User Sessions",
                "Real-Time Features",
                "Item Catalog",
                "Embedding Indices",
                "Model Inference Logs",
              ],
              typicalSourceSystems: [
                "Streaming Platform",
                "Feature Store",
                "Vector Database",
                "Model Serving",
                "Product Analytics",
              ],
            },
            {
              name: "Resource Optimization",
              description:
                "Dynamically allocate compute, storage, and CDN capacity to real-time demand using forecasting models on traffic, seasonality, and product launches -- driving down infrastructure spend without breaking SLOs.",
              businessValue:
                "15-25% reduction in infrastructure unit cost; better SLO attainment during launches and peak events.",
              typicalDataEntities: [
                "Capacity Forecasts",
                "Traffic Patterns",
                "Cost Telemetry",
                "Allocation Rules",
                "SLO Metrics",
              ],
              typicalSourceSystems: [
                "Cloud Provider",
                "Observability Platform",
                "FinOps Tooling",
                "Kubernetes / Auto-scaler",
              ],
            },
          ],
          kpis: [
            "Data processing latency (p95 ms)",
            "Engineering team productivity (deploys/week)",
            "Data processing cost per event",
            "SLO attainment %",
          ],
          personas: [
            "Chief Technology Officer",
            "VP Engineering",
            "Data Platform Owner",
            "Head of SRE",
          ],
        },
        {
          name: "Accelerate Production ML/AI",
          useCases: [
            {
              name: "ML Model Lifecycle Management",
              description:
                "Streamline ML model development, evaluation, deployment, and monitoring at scale with unified MLOps tooling -- model registry, automated CI/CD for models, evaluation harnesses, drift monitoring -- so teams ship models continuously and safely.",
              businessValue:
                "2-5x increase in model deployment frequency; faster time-to-value on every ML investment.",
              typicalDataEntities: [
                "Model Registry",
                "Training Datasets",
                "Evaluation Metrics",
                "Drift Signals",
                "Inference Logs",
              ],
              typicalSourceSystems: [
                "MLflow / Model Registry",
                "Feature Store",
                "Lakehouse",
                "Model Serving",
                "Observability Platform",
              ],
            },
            {
              name: "Feature Store & Feature Engineering",
              description:
                "Centralize feature definitions and serving so the same features power offline training and online inference -- with consistent semantics, lineage, governance, and reuse across product squads and modeling teams.",
              businessValue:
                "30-50% reduction in feature-engineering rework; eliminated train-serve skew incidents.",
              typicalDataEntities: [
                "Feature Definitions",
                "Feature Tables (Online + Offline)",
                "Feature Lineage",
                "Feature Metadata",
              ],
              typicalSourceSystems: [
                "Feature Store",
                "Lakehouse",
                "Streaming Platform",
                "Model Serving",
              ],
            },
            {
              name: "A/B Testing & Experimentation Platform",
              description:
                "Run thousands of concurrent experiments with rigorous statistical guardrails (sample size, sequential testing, segmentation, holdouts) so every product change is causally measured and only winning treatments roll out.",
              businessValue:
                "Higher iteration velocity; cumulative compounding revenue lift from systematically validated changes.",
              typicalDataEntities: [
                "Experiment Definitions",
                "Treatment Assignments",
                "Outcome Metrics",
                "Significance Statistics",
                "Holdout Cohorts",
              ],
              typicalSourceSystems: [
                "Experimentation Platform",
                "Product Analytics",
                "Lakehouse",
                "Feature Flagging Service",
              ],
            },
            {
              name: "GenAI Product Features",
              description:
                "Embed LLM-powered features (assistants, summarization, search, agents) directly into the product surface, grounded in proprietary data via RAG and governed by content / evaluation / safety controls.",
              businessValue:
                "New product surface area, premium tier monetization, and material productivity uplift for end users.",
              typicalDataEntities: [
                "Document Corpus",
                "Embedding Indices",
                "Prompt Templates",
                "Evaluation Datasets",
                "Safety Policies",
              ],
              typicalSourceSystems: [
                "Vector Database",
                "Model Serving",
                "Feature Store",
                "Content Safety Service",
                "Lakehouse",
              ],
            },
          ],
          kpis: [
            "Model deployment frequency",
            "Experiment velocity",
            "ML infrastructure cost per inference",
            "GenAI feature adoption %",
          ],
          personas: [
            "Head of Data Science",
            "VP Engineering",
            "Chief AI Officer",
            "Head of ML Platform",
          ],
        },
        {
          name: "Trust, Safety & Reliability",
          useCases: [
            {
              name: "Trust & Safety Content Moderation",
              description:
                "Detect and act on abusive, fraudulent, or policy-violating content using ML classifiers, human-in-the-loop review, and policy automation -- protecting platform health and end-user trust at scale.",
              businessValue:
                "Lower toxic-content exposure; reduced regulatory risk; improved community health metrics.",
              typicalDataEntities: [
                "User-Generated Content",
                "Moderation Decisions",
                "Policy Violations",
                "Reviewer Notes",
                "Appeal Outcomes",
              ],
              typicalSourceSystems: [
                "Content Platform",
                "Moderation Tooling",
                "Trust & Safety Case Management",
                "ML Model Serving",
              ],
            },
            {
              name: "Platform Reliability & Observability",
              description:
                "Unify logs, metrics, and traces in a lakehouse-backed observability stack to detect, root-cause, and prevent incidents -- with ML-driven anomaly detection on the highest-cardinality signals.",
              businessValue:
                "Lower MTTR; better SLO attainment; lower observability tooling cost vs vendor SaaS.",
              typicalDataEntities: [
                "Logs",
                "Metrics",
                "Distributed Traces",
                "Incident Records",
                "Anomaly Scores",
              ],
              typicalSourceSystems: [
                "Observability Platform",
                "Lakehouse",
                "Incident Management",
                "Cloud Provider",
              ],
            },
          ],
          kpis: ["Incident MTTR", "Trust & Safety policy violation rate", "SLO attainment %"],
          personas: [
            "Chief Trust & Safety Officer",
            "VP SRE",
            "Head of Observability",
            "VP Engineering",
          ],
        },
      ],
    },
  ],
};
