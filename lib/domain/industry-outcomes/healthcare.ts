/**
 * Healthcare -- Industry Outcome Map
 *
 * Strategic imperatives and pillars are sourced from the Master Repository
 * XLSX (Use Case Summaries sheet). Use case names match the Master Repo
 * canonical taxonomy so `healthcare.enrichment.ts` lookups (keyed by
 * lowercase name) keep resolving. Rich consultant-grade prose --
 * description, businessValue, typicalDataEntities, typicalSourceSystems
 * -- was added during the May 2026 registry consolidation. Benchmarks,
 * model types, KPI targets, dataAssetIds, and economic patterns remain
 * in healthcare.enrichment.ts.
 */

import type { IndustryOutcome } from "./index";

export const HEALTHCARE: IndustryOutcome = {
  id: "healthcare",
  name: "Healthcare",
  subVerticals: [
    "Health Systems",
    "Payers",
    "Physician Groups",
    "Ambulatory & Specialty",
    "Healthcare Providers",
    "Health Insurance / Payers",
  ],
  suggestedDomains: [
    "Clinical Operations",
    "Revenue Cycle",
    "Care Management",
    "Quality & Safety",
    "Population Health",
    "Patient Experience",
    "Network",
    "Pharmacy",
  ],
  suggestedPriorities: [
    "Improve Care Quality",
    "Reduce Cost",
    "Streamline Operations",
    "Patient Engagement",
    "Mitigate Risk",
  ],
  objectives: [
    {
      name: "Streamline Operations",
      whyChange:
        "Health systems and payers face rising labour costs, persistent clinical-staff shortages, and tightening margins -- with administrative burden alone consuming a quarter of total US healthcare spend. Interoperability mandates (FHIR, USCDI), automated clinical-note review, and operational AI on revenue-cycle and prior-auth processes unlock real capacity. Provider organisations that operationalise these tools recover physician time, lift coding accuracy, and accelerate payer adjudication while payers reduce per-claim cost and protect medical-loss ratios.",
      priorities: [
        {
          name: "Implement Interoperability",
          useCases: [
            {
              name: "Automate Reporting (e.g., NEDOCS for ED Wait Times)",
              description:
                "Operationalize NEDOCS and ED operational KPIs (door-to-doc, length of stay, boarding hours) with automated feeds and near-real-time dashboards used by ED and house-supervisor teams.",
              businessValue:
                "Faster identification of capacity bottlenecks; reduced LWBS rates; better evidence for capital and staffing decisions.",
              typicalDataEntities: [
                "ED Encounters",
                "Bed Occupancy",
                "Triage Records",
                "Wait Times",
                "Staffing Levels",
              ],
              typicalSourceSystems: [
                "EHR",
                "ADT Feed",
                "Bed Management System",
              ],
            },
            {
              name: "Predict Patient Throughput (ICU Capacity Planning)",
              description:
                "Forecast bed demand, length of stay, and discharge bottlenecks across ICUs and inpatient wards using ML on ADT, encounter, and clinical-pathway data to optimise staffing and diversion.",
              businessValue:
                "Higher bed turnover; reduced ED diversion; improved staffing accuracy.",
              typicalDataEntities: [
                "ADT Events",
                "Patient Acuity Scores",
                "Clinical Pathways",
                "Staffing Rosters",
                "Bed Inventory",
              ],
              typicalSourceSystems: [
                "EHR",
                "ADT Feed",
                "Workforce Management",
                "Capacity Management Platform",
              ],
            },
            {
              name: "Automate Clinical Data Pipelines with FHIR",
              description:
                "Build resilient FHIR-based ingestion and validation pipelines to standardise clinical data at scale across EHR vendors, ancillary systems, and external partners (HIEs, payers, registries).",
              businessValue:
                "Foundation for analytics, AI, and interoperability mandates (TEFCA, USCDI); reduced per-feed integration cost.",
              typicalDataEntities: [
                "FHIR Resources",
                "Validation Reports",
                "Source-System Mappings",
                "Lineage Records",
              ],
              typicalSourceSystems: [
                "EHR",
                "FHIR Server",
                "HIE Connector",
                "Integration Engine",
              ],
            },
            {
              name: "Support DICOM (standard for medical images)",
              description:
                "Enable image routing, metadata extraction, and research curation from PACS and VNA -- supporting both clinical workflows and downstream AI/research curation.",
              businessValue:
                "Foundation for imaging analytics and AI; reduced research onboarding effort; cleaner enterprise imaging strategy.",
              typicalDataEntities: [
                "DICOM Images",
                "Image Metadata",
                "Annotations",
                "Modality Worklists",
              ],
              typicalSourceSystems: ["PACS", "VNA", "Modality Workstations"],
            },
          ],
          kpis: [
            "Average length of stay",
            "Throughput",
            "Coding accuracy",
            "Cost-per-encounter",
          ],
          personas: [
            "Chief Operating Officer",
            "Chief Medical Information Officer",
            "VP Revenue Cycle",
          ],
        },
        {
          name: "Automate Clinical Note Review",
          useCases: [
            {
              name: "Reimbursement: Coding & Approvals",
              description:
                "Accelerate accurate coding and coverage decisions from clinical evidence using NLP/LLM on notes, with human-in-the-loop coder review for ambiguous cases.",
              businessValue:
                "Higher coding accuracy; faster claim turnaround; lower coder cost per encounter.",
              typicalDataEntities: [
                "Clinical Notes",
                "Coding Outputs",
                "Claim Records",
                "Coverage Policies",
              ],
              typicalSourceSystems: [
                "EHR",
                "Coding Platform",
                "Claims Adjudication",
              ],
            },
            {
              name: "Medicare Risk Adjustment",
              description:
                "Improve HCC capture and recapture using NLP on clinical notes plus claims and demographic data to align revenue with member risk under risk-adjusted payment models.",
              businessValue:
                "Higher accurate HCC recapture; better-aligned revenue and risk; improved compliance posture against RADV audits.",
              typicalDataEntities: [
                "Clinical Notes",
                "Claims History",
                "Member Demographics",
                "HCC Codes",
              ],
              typicalSourceSystems: [
                "EHR",
                "Claims Adjudication",
                "Risk Adjustment Platform",
              ],
            },
            {
              name: "De-Identify Unstructured Data",
              description:
                "Remove PHI from notes, transcripts, and images for research, sharing, and AI-training pipelines using validated de-identification models with auditable controls.",
              businessValue:
                "Lower PHI-exposure risk; broader research and AI-training data; cleaner data-sharing posture.",
              typicalDataEntities: [
                "Clinical Notes",
                "Transcripts",
                "Pathology Reports",
                "De-Identification Logs",
              ],
              typicalSourceSystems: [
                "EHR",
                "Clinical Data Warehouse",
                "De-Identification Platform",
              ],
            },
            {
              name: "AI-Assisted Data Curation (Registry & Research)",
              description:
                "Curate registry and research cohorts with AI extraction (line of therapy, biomarkers, response) and human-in-the-loop QA -- supporting both internal research and outcomes-based contracts.",
              businessValue:
                "Higher cohort coverage; lower per-record curation cost; faster registry build cycles.",
              typicalDataEntities: [
                "Clinical Notes",
                "Registry Records",
                "Biomarker Data",
                "Validation Records",
              ],
              typicalSourceSystems: [
                "EHR",
                "Clinical Data Warehouse",
                "NLP Platform",
                "Registry System",
              ],
            },
          ],
          kpis: [
            "Average length of stay",
            "Throughput",
            "Coding accuracy",
            "Cost-per-encounter",
          ],
          personas: [
            "Chief Operating Officer",
            "Chief Medical Information Officer",
            "VP Revenue Cycle",
          ],
        },
        {
          name: "Improve Operating Efficiency",
          useCases: [
            {
              name: "Automate Prior Authorization",
              description:
                "Pre-submit checks and auto-decisioning for prior auth using rule-plus-AI hybrid models with explainability, reducing turnaround for both providers and payers and meeting CMS interoperability rules.",
              businessValue:
                "Faster auth turnaround; reduced administrative burden; improved provider satisfaction.",
              typicalDataEntities: [
                "Prior Auth Requests",
                "Coverage Policies",
                "Clinical Documentation",
                "Decision Logs",
              ],
              typicalSourceSystems: [
                "EHR",
                "Payer Auth Platform",
                "Coverage Rules Engine",
              ],
            },
            {
              name: "Modernize Underwriting: Forecast Utilization & Accelerate Bids",
              description:
                "Predict utilisation and cost by population, group, and scenario using ML on claims and member data to price bids and renewals faster and more accurately.",
              businessValue:
                "Faster bid response; better-priced risk; higher win rate on profitable groups.",
              typicalDataEntities: [
                "Claims History",
                "Member Demographics",
                "Utilisation Patterns",
                "Group Definitions",
              ],
              typicalSourceSystems: [
                "Claims Adjudication",
                "Underwriting Platform",
                "Actuarial Tools",
              ],
            },
            {
              name: "Detect Fraud, Waste, & Abuse (Payment Integrity)",
              description:
                "Spot anomalous billing, upcoding, and improper payments using ML on claims, provider, and member data with case-management workflow for investigators.",
              businessValue:
                "Higher payment-integrity savings; lower per-case investigation cost.",
              typicalDataEntities: [
                "Claims",
                "Provider Profiles",
                "Member History",
                "Anomaly Scores",
                "Case Records",
              ],
              typicalSourceSystems: [
                "Claims Adjudication",
                "Special Investigations Unit Platform",
                "Provider Master Data",
              ],
            },
            {
              name: "Improve Revenue Cycle Mgmt",
              description:
                "Reduce denials, accelerate cash collection, and optimise net yield across the revenue-cycle lifecycle with ML on claim status, contract terms, and payer behaviour.",
              businessValue:
                "Lower denial rate; faster days-in-AR; improved net yield.",
              typicalDataEntities: [
                "Claims",
                "Remittance",
                "Contract Terms",
                "Payer Adjudication Logs",
              ],
              typicalSourceSystems: [
                "Claims Adjudication",
                "Patient Accounting",
                "Contract Management",
              ],
            },
            {
              name: "Optimize Supply Chain",
              description:
                "Match inventory and supplies to scheduled procedure demand to prevent stock-outs and waste -- particularly across high-cost implants, pharmacy, and PPE.",
              businessValue:
                "Reduced stock-outs in high-cost categories; lower inventory carrying cost; less expiration waste.",
              typicalDataEntities: [
                "Surgical Schedules",
                "Inventory Levels",
                "Pharmacy Stock",
                "Supplier Performance",
              ],
              typicalSourceSystems: [
                "ERP",
                "OR Scheduling",
                "Pharmacy System",
                "Inventory Management",
              ],
            },
          ],
          kpis: [
            "Average length of stay",
            "Throughput",
            "Coding accuracy",
            "Cost-per-encounter",
          ],
          personas: [
            "Chief Operating Officer",
            "Chief Medical Information Officer",
            "VP Revenue Cycle",
          ],
        },
      ],
    },
    {
      name: "Improve Provider Quality & Network Mgmt",
      whyChange:
        "Quality of care, HEDIS/Stars performance, and network optimisation directly drive risk-adjusted revenue and member retention under value-based contracts. Closing care gaps, optimising referrals, and steering to high-value providers is a multi-billion-dollar opportunity for both payers and risk-bearing providers. AI on claims, EHR, and price-transparency data closes care-gap loops faster, reduces network leakage, and improves star ratings -- protecting bonus payments and government program participation.",
      priorities: [
        {
          name: "Drive Quality of Care",
          useCases: [
            {
              name: "Improve HEDIS Scores",
              description:
                "Close care gaps and document compliance against HEDIS measures using ML on claims, EHR, and engagement data to target outreach and supplemental data collection.",
              businessValue:
                "Higher HEDIS measure performance; protected quality bonuses; improved value-based contract performance.",
              typicalDataEntities: [
                "Claims",
                "EHR Data",
                "HEDIS Measure Definitions",
                "Care Gap Lists",
              ],
              typicalSourceSystems: [
                "Claims Adjudication",
                "EHR",
                "Care Management Platform",
                "HEDIS Engine",
              ],
            },
            {
              name: "Improve Star Ratings (Medicare)",
              description:
                "Lift CAHPS, HOS, and operational quality metrics via targeted member outreach, service-recovery on dissatisfied members, and provider-performance interventions.",
              businessValue:
                "Higher Star Ratings; protected QBP bonuses; better Medicare Advantage market positioning.",
              typicalDataEntities: [
                "Member Surveys",
                "Service Interactions",
                "Provider Performance",
                "Quality Metrics",
              ],
              typicalSourceSystems: [
                "CRM",
                "Member Engagement Platform",
                "Provider Profile",
              ],
            },
            {
              name: "Improve Nurse Handoffs for Continuity of Care",
              description:
                "Generate concise, structured handoff summaries with SBAR action items using AI on the chart and recent encounter data to reduce communication failures during shift change.",
              businessValue:
                "Reduced communication-related adverse events; faster shift-change throughput.",
              typicalDataEntities: [
                "Clinical Notes",
                "Vital Signs",
                "Medication Lists",
                "Pending Tasks",
              ],
              typicalSourceSystems: ["EHR", "Nursing Workflow App"],
            },
          ],
          kpis: [
            "Readmission rate",
            "HEDIS / Stars scores",
            "Network leakage",
          ],
          personas: ["Chief Medical Officer", "VP Quality", "VP Network"],
        },
        {
          name: "Optimize Networks & Referrals",
          useCases: [
            {
              name: "Analyze Price Transparency for Network Rates",
              description:
                "Normalise machine-readable rates files to compare payer/provider negotiated rates and surface steerage opportunities using ML on the price-transparency datasets.",
              businessValue:
                "Better-negotiated network rates; sharper steerage to high-value providers.",
              typicalDataEntities: [
                "MRF Files",
                "Negotiated Rates",
                "Provider Master",
                "Procedure Codes",
              ],
              typicalSourceSystems: [
                "Price Transparency Dataset",
                "Provider Master Data",
                "Network Management Platform",
              ],
            },
            {
              name: "Nearest Neighbor for Provider Referrals",
              description:
                "Match patients to optimal in-network providers by need, proximity, and outcome history using nearest-neighbour models on referral and claims data.",
              businessValue:
                "Reduced network leakage; better-matched referrals; protected value-based contract performance.",
              typicalDataEntities: [
                "Referral History",
                "Provider Profiles",
                "Outcomes Data",
                "Geo-Coordinates",
              ],
              typicalSourceSystems: [
                "EHR",
                "Referral Management",
                "Network Management Platform",
              ],
            },
          ],
          kpis: [
            "Readmission rate",
            "HEDIS / Stars scores",
            "Network leakage",
          ],
          personas: ["Chief Medical Officer", "VP Quality", "VP Network"],
        },
      ],
    },
    {
      name: "Deliver Better Patient Outcomes & Experience",
      whyChange:
        "Predicting disease risk, personalising engagement, and improving member retention all move the needle on outcomes and financial performance under value-based and risk-bearing contracts. Population health programs depend on early identification of rising-risk members, omnichannel engagement, and SDOH-informed interventions. Health systems and payers that operationalise these capabilities reduce avoidable utilisation, improve HCAHPS/NPS, and retain members across renewal cycles.",
      priorities: [
        {
          name: "Predict Disease Risk",
          useCases: [
            {
              name: "Reduce Hospital Readmissions",
              description:
                "Predict 30-day readmission risk using EHR, claims, and SDOH features and trigger transitional care management programs for high-risk patients.",
              businessValue:
                "Lower readmission rate; protected CMS readmission penalties; better outcomes under bundled-payment contracts.",
              typicalDataEntities: [
                "Patient Encounters",
                "Risk Scores",
                "Discharge Records",
                "SDOH Data",
                "Care Plans",
              ],
              typicalSourceSystems: [
                "EHR",
                "Claims Adjudication",
                "Care Management Platform",
              ],
            },
            {
              name: "Predict Disease Onset & Progression",
              description:
                "Anticipate incidence and trajectory of chronic disease using ML on claims, EHR, lab, and SDOH data to target preventive and care-management interventions.",
              businessValue:
                "Earlier intervention on rising-risk members; better risk-adjusted outcomes; protected medical-loss ratios.",
              typicalDataEntities: [
                "EHR Data",
                "Claims",
                "Lab Results",
                "SDOH Data",
                "Risk Scores",
              ],
              typicalSourceSystems: [
                "EHR",
                "Claims Adjudication",
                "Population Health Platform",
              ],
            },
            {
              name: "Identify Probability of Next Clinical Event",
              description:
                "Sequence-aware risk scoring for next ED visit, admission, or escalation using transformer models on encounter timelines.",
              businessValue:
                "More precise targeting of care-management resources; reduced avoidable utilisation.",
              typicalDataEntities: [
                "Encounter Timelines",
                "ICD/CPT Codes",
                "Vital Signs",
                "Medication Records",
              ],
              typicalSourceSystems: [
                "EHR",
                "Claims Adjudication",
                "Population Health Platform",
              ],
            },
            {
              name: "Polygenic Risk Scoring",
              description:
                "Compute polygenic risk scores and link to phenotypes and clinical workflows to support preventive care and precision-medicine programs.",
              businessValue:
                "Earlier preventive interventions; differentiated wellness offerings.",
              typicalDataEntities: [
                "Genomic Data",
                "Phenotype Records",
                "PRS Scores",
                "Clinical Notes",
              ],
              typicalSourceSystems: [
                "Genomics Platform",
                "EHR",
                "Population Health Platform",
              ],
            },
          ],
          kpis: [
            "HCAHPS / NPS",
            "Risk-adjusted mortality",
            "Member retention",
          ],
          personas: [
            "Chief Experience Officer",
            "VP Population Health",
            "VP Patient Engagement",
          ],
        },
        {
          name: "Personalize Engagement",
          useCases: [
            {
              name: "Deliver Digital Health Apps (e.g., CGM)",
              description:
                "Provide AI-assisted coaching and alerts tied to device data (CGMs, BP cuffs, weight scales) integrated into care plans and member-engagement workflows.",
              businessValue:
                "Higher engagement and adherence among chronic-condition members; better outcomes under risk contracts.",
              typicalDataEntities: [
                "Device Telemetry",
                "Care Plans",
                "Engagement Logs",
                "Member Profiles",
              ],
              typicalSourceSystems: [
                "Member Engagement Platform",
                "Device Cloud",
                "Care Management Platform",
              ],
            },
            {
              name: "Support Patient Services (Scheduling, Chatbot)",
              description:
                "Self-service scheduling, benefits Q&A, and triage via compliant conversational interfaces -- escalating high-acuity cases to nurses with full audit transcript.",
              businessValue:
                "Higher self-service deflection; lower per-call cost; better access for members.",
              typicalDataEntities: [
                "Member Profiles",
                "Scheduling Slots",
                "Benefits Data",
                "Conversation Logs",
              ],
              typicalSourceSystems: [
                "Member Portal",
                "Conversational AI Platform",
                "Scheduling System",
              ],
            },
            {
              name: "Automate Adherence Reminders",
              description:
                "Identify non-adherent members and trigger omni-channel nudges (SMS, voice, app, mail) calibrated to channel preference and consent.",
              businessValue:
                "Higher medication adherence; better quality-measure performance; reduced avoidable utilisation.",
              typicalDataEntities: [
                "Refill History",
                "Adherence Scores",
                "Member Profiles",
                "Engagement Logs",
              ],
              typicalSourceSystems: [
                "Pharmacy Benefit Manager",
                "Member Engagement Platform",
                "CRM",
              ],
            },
          ],
          kpis: [
            "HCAHPS / NPS",
            "Risk-adjusted mortality",
            "Member retention",
          ],
          personas: [
            "Chief Experience Officer",
            "VP Population Health",
            "VP Patient Engagement",
          ],
        },
        {
          name: "Improve Retention",
          useCases: [
            {
              name: "Predict Member Churn",
              description:
                "Anticipate disenrollment risk using engagement, satisfaction, and claims signals and trigger retention plays calibrated by lifetime value and reason-for-leaving.",
              businessValue:
                "Higher member retention; protected risk-adjusted revenue across renewal cycles.",
              typicalDataEntities: [
                "Member Profiles",
                "Engagement History",
                "Survey Responses",
                "Churn Risk Scores",
              ],
              typicalSourceSystems: [
                "CRM",
                "Member Engagement Platform",
                "Claims Adjudication",
              ],
            },
            {
              name: "Call Center Analytics (Sentiment Analysis)",
              description:
                "Analyse member-service conversations for intent, sentiment, and compliance -- driving QA, routing, and agent-coaching programs.",
              businessValue:
                "Higher first-call resolution; better agent productivity; faster service-recovery on dissatisfied members.",
              typicalDataEntities: [
                "Call Transcripts",
                "Sentiment Scores",
                "Intent Categories",
                "QA Outcomes",
              ],
              typicalSourceSystems: [
                "Contact Center Platform",
                "Speech Analytics",
                "CRM",
              ],
            },
            {
              name: "Predict Propensity to Engage with Social Determinants",
              description:
                "Target members likely to accept SDOH services (food, housing, transportation) using propensity models on engagement, claims, and SDOH data to drive program enrolment.",
              businessValue:
                "Higher SDOH-program enrolment; better outcomes evidence; protected MLR through avoidable-utilisation reduction.",
              typicalDataEntities: [
                "Member Profiles",
                "SDOH Data",
                "Engagement History",
                "Program Outcomes",
              ],
              typicalSourceSystems: [
                "Population Health Platform",
                "CRM",
                "SDOH Data Provider",
              ],
            },
          ],
          kpis: [
            "HCAHPS / NPS",
            "Risk-adjusted mortality",
            "Member retention",
          ],
          personas: [
            "Chief Experience Officer",
            "VP Population Health",
            "VP Patient Engagement",
          ],
        },
      ],
    },
  ],
};
