/**
 * Life Sciences -- Industry Outcome Map
 *
 * Strategic imperatives and pillars are sourced from the Master Repository
 * XLSX (Use Case Summaries sheet). Use case names match the Master Repo
 * canonical taxonomy so `life-sciences.enrichment.ts` lookups (keyed by
 * lowercase name) keep resolving. Rich consultant-grade prose --
 * description, businessValue, typicalDataEntities, typicalSourceSystems
 * -- was lifted from the legacy HLS outcome map during the May 2026
 * registry consolidation. Benchmarks, model types, KPI targets,
 * dataAssetIds, and economic patterns remain in life-sciences.enrichment.ts.
 */

import type { IndustryOutcome } from "./index";

export const LIFE_SCIENCES: IndustryOutcome = {
  id: "life-sciences",
  name: "Life Sciences",
  subVerticals: [
    "Pharma",
    "Biotech",
    "Medical Devices",
    "Diagnostics",
    "CRO/CMO",
  ],
  suggestedDomains: [
    "R&D",
    "Clinical Development",
    "Manufacturing",
    "Supply Chain",
    "Commercial",
    "Patient Engagement",
    "Regulatory",
    "Pharmacovigilance",
  ],
  suggestedPriorities: [
    "Accelerate R&D",
    "Improve Commercial Effectiveness",
    "Optimize Production",
    "Regulatory Compliance",
    "Drive Innovation",
    "Reduce Cost",
  ],
  objectives: [
    {
      name: "Increase R&D Productivity",
      whyChange:
        "Despite tremendous growth in R&D investments, success rates of new drugs have remained flat. Time-to-market averages 12+ years and $2B+ in spend, and delays in launch erode lifetime revenues. AI-driven target identification, transformer models on multi-omics, FAIR data architectures, and protocol-design analytics are the highest-leverage interventions in the discovery and clinical-development pipeline -- pharma and biotech leaders that operationalise them shorten time-to-IND, reduce trial amendments, and improve probability of technical and regulatory success at every stage gate.",
      priorities: [
        {
          name: "Accelerate Drug Discovery",
          useCases: [
            {
              name: "Genetic Target Identification",
              description:
                "Use genomics, multi-omics, and computational biology to identify and prioritise drug targets with higher probability of clinical success -- integrating pathway evidence, GWAS hits, expression atlases, and literature.",
              businessValue:
                "$75.5M attributable value per program from accelerated genomics access and population-scale analytics; meaningful reduction in preclinical attrition.",
              typicalDataEntities: [
                "Genomic Data",
                "Target Pathways",
                "Literature Evidence",
                "Experimental Results",
                "Pathway Annotations",
              ],
              typicalSourceSystems: [
                "Genomics Platform",
                "Research Data Lake",
                "Scientific Literature DB",
                "ELN",
              ],
            },
            {
              name: "QSAR Modeling (Quantitative Structure Activity Relationship)",
              description:
                "Predict molecular activity, toxicity, and ADMET properties from structure to optimise drug-candidate selection and triage hit lists earlier in discovery.",
              businessValue:
                "Reduced preclinical attrition rate; faster lead optimisation cycles; better-informed candidate selection at IND-enabling decisions.",
              typicalDataEntities: [
                "Molecular Structures",
                "Activity Data",
                "Chemical Properties",
                "ADMET Profiles",
              ],
              typicalSourceSystems: [
                "ELN",
                "Compound Management",
                "Research Data Lake",
              ],
            },
            {
              name: "Geneformer Modeling (Gene Expressions & Network Biology)",
              description:
                "Use transformer models on single-cell and bulk expression matrices to learn cell-state embeddings, predict perturbation effects, and reason about disease biology at network level.",
              businessValue:
                "Higher-quality target hypotheses; mechanism-of-action insights that traditional analyses miss.",
              typicalDataEntities: [
                "Single-Cell Expression",
                "Bulk Transcriptomics",
                "Perturbation Experiments",
                "Gene Networks",
              ],
              typicalSourceSystems: [
                "Genomics Platform",
                "Research Data Lake",
                "Foundation Model Registry",
              ],
            },
            {
              name: "Image Classification (eg. Digital Path.)",
              description:
                "Apply computer vision to digital pathology slides for diagnosis, biomarker scoring, and drug-response prediction -- supporting both research and companion-diagnostic development.",
              businessValue:
                "Faster biomarker scoring; better-targeted patient stratification in trials.",
              typicalDataEntities: [
                "Pathology Images",
                "Annotations",
                "Clinical Outcomes",
                "Biomarker Data",
              ],
              typicalSourceSystems: [
                "PACS",
                "LIMS",
                "Electronic Health Records",
              ],
            },
            {
              name: "Chromatography Insights",
              description:
                "Detect peak issues, drift, and method-development bottlenecks across analytical chromatography runs using ML on instrument telemetry.",
              businessValue:
                "Faster method development; lower batch reject rate; reduced lab cycle time.",
              typicalDataEntities: [
                "Chromatograms",
                "Method Parameters",
                "Sample Metadata",
                "QC Standards",
              ],
              typicalSourceSystems: [
                "Chromatography Data System",
                "LIMS",
                "ELN",
              ],
            },
          ],
          kpis: [
            "Time to candidate",
            "Trial enrollment rate",
            "Protocol amendments",
            "FAIR data coverage",
          ],
          personas: [
            "Chief Scientific Officer",
            "VP Discovery",
            "Head of Computational Biology",
          ],
        },
        {
          name: "Streamline Clinical Development",
          useCases: [
            {
              name: "Clinical Trial Protocol Design",
              description:
                "Generate, optimise, and stress-test protocols and eligibility criteria using AI on historical trial data -- improving patient recruitment, reducing amendments, and shortening trial duration.",
              businessValue:
                "Higher first-pass protocol approval; reduced cycle time and amendment rate during conduct.",
              typicalDataEntities: [
                "Clinical Trial Data",
                "Patient Demographics",
                "Historical Protocols",
                "Site Data",
                "Eligibility Criteria",
              ],
              typicalSourceSystems: [
                "CTMS",
                "Electronic Health Records",
                "Clinical Data Warehouse",
              ],
            },
            {
              name: "Clinical Trial Site Selection",
              description:
                "Rank sites and investigators by expected enrolment performance, data-quality history, and patient-population fit using analytics on past trial conduct and EHR/claims-derived patient counts.",
              businessValue:
                "Higher enrolment velocity; lower per-site cost; reduced rescue-site activation.",
              typicalDataEntities: [
                "Site Performance",
                "Patient Populations",
                "Investigator Profiles",
                "Enrollment History",
              ],
              typicalSourceSystems: [
                "CTMS",
                "Site Feasibility Platform",
                "Electronic Health Records",
              ],
            },
            {
              name: "Drug Repurposing",
              description:
                "Use AI on structured RWD, clinical literature, and pharmacovigilance signals to identify new indications for approved or shelved compounds -- shrinking the development cycle and de-risking pipeline.",
              businessValue:
                "Lower development cost and time vs de-novo programs; faster path to additional indications and lifecycle extension.",
              typicalDataEntities: [
                "Drug Profiles",
                "Disease Ontologies",
                "Clinical Outcomes",
                "Literature Evidence",
                "Adverse Event Signals",
              ],
              typicalSourceSystems: [
                "Clinical Data Warehouse",
                "Scientific Literature DB",
                "Pharmacovigilance DB",
              ],
            },
            {
              name: "Automate QA of Clinical Data",
              description:
                "Detect anomalies, missingness, edit-check failures, and protocol deviations in clinical datasets using AI to ensure data integrity and regulatory compliance.",
              businessValue:
                "Reduced data-cleaning cycle time; cleaner submission packages; fewer FDA/EMA queries during review.",
              typicalDataEntities: [
                "Clinical Trial Data",
                "Edit Checks",
                "Source Data",
                "Reconciliation Logs",
              ],
              typicalSourceSystems: ["EDC", "CTMS", "Clinical Data Warehouse"],
            },
            {
              name: "Modernize Clinical Data Repository",
              description:
                "Establish scalable, standardised clinical analytics on OMOP, CDISC, and FAIR principles -- so cross-trial and cross-program insight generation runs on governed, interoperable data rather than per-study silos.",
              businessValue:
                "Faster cross-trial analytics; lower long-run data-platform cost; foundation for RWE generation.",
              typicalDataEntities: [
                "OMOP CDM",
                "CDISC Standards",
                "Clinical Trial Data",
                "Lineage Records",
              ],
              typicalSourceSystems: [
                "Clinical Data Warehouse",
                "EDC",
                "OMOP CDM",
              ],
            },
          ],
          kpis: [
            "Time to candidate",
            "Trial enrollment rate",
            "Protocol amendments",
            "FAIR data coverage",
          ],
          personas: [
            "Chief Scientific Officer",
            "VP Discovery",
            "Head of Clinical Operations",
            "Chief Medical Officer",
          ],
        },
        {
          name: "Build a FAIR Data Platform",
          useCases: [
            {
              name: "Knowledge Graphs for R&D",
              description:
                "Build knowledge graphs that link genes, targets, compounds, diseases, trials, literature, and outcomes into a unified queryable graph spanning biology and chemistry.",
              businessValue:
                "Accelerated hypothesis generation; reduced time spent reconciling siloed datasets across discovery and development.",
              typicalDataEntities: [
                "Research Data",
                "Literature",
                "Experimental Results",
                "Entity Relationships",
                "Ontologies",
              ],
              typicalSourceSystems: [
                "ELN",
                "Research Data Lake",
                "Scientific Literature DB",
                "Knowledge Graph Platform",
              ],
            },
            {
              name: "Medical Image Processing & Management (Pixels for DICOM)",
              description:
                "Normalise, de-identify, and govern medical images at scale (DICOM, microscopy, MRI/CT) for AI training and downstream analysis.",
              businessValue:
                "Foundation for digital-pathology and imaging biomarker programs; reduced PHI exposure risk.",
              typicalDataEntities: [
                "DICOM Images",
                "Image Metadata",
                "De-Identification Logs",
                "Annotations",
              ],
              typicalSourceSystems: [
                "PACS",
                "VNA",
                "Research Imaging Platform",
              ],
            },
            {
              name: "Omics Data Management",
              description:
                "Curate, QC, and provision multi-omics (genomics, transcriptomics, proteomics) at scale with FAIR metadata and reproducible pipelines.",
              businessValue:
                "Faster, governed access to high-quality omics for translational and clinical research; reduced reanalysis cost.",
              typicalDataEntities: [
                "Genomic Data",
                "Transcriptomics",
                "Proteomics",
                "FAIR Metadata",
              ],
              typicalSourceSystems: [
                "Genomics Platform",
                "LIMS",
                "Research Data Lake",
              ],
            },
            {
              name: "Research Assistant",
              description:
                "Deploy AI assistants (scientist copilots) that help researchers navigate scientific literature, internal research data, and patent corpora with citations and traceability.",
              businessValue:
                "Faster time-to-insight on literature and internal data; consistent answers across teams and geographies.",
              typicalDataEntities: [
                "Scientific Literature",
                "Research Data",
                "Patent Data",
                "Internal Reports",
                "Embeddings",
              ],
              typicalSourceSystems: [
                "Scientific Literature DB",
                "Research Data Lake",
                "ELN",
                "Vector Store",
              ],
            },
            {
              name: "BioMedical Information Retrieval",
              description:
                "Domain-specific semantic retrieval and filtering across biomedical corpora (PubMed, ClinicalTrials.gov, internal reports) with controlled-vocabulary support.",
              businessValue:
                "Reduced literature-review effort; better-grounded scientific decisions.",
              typicalDataEntities: [
                "Biomedical Literature",
                "Clinical Trial Registries",
                "Embeddings",
                "Controlled Vocabularies",
              ],
              typicalSourceSystems: [
                "Scientific Literature DB",
                "Vector Store",
                "Knowledge Graph Platform",
              ],
            },
          ],
          kpis: [
            "Time to candidate",
            "Trial enrollment rate",
            "Protocol amendments",
            "FAIR data coverage",
          ],
          personas: [
            "Chief Scientific Officer",
            "VP Discovery",
            "Chief Data Officer",
            "Head of Research Informatics",
          ],
        },
      ],
    },
    {
      name: "Optimize Production",
      whyChange:
        "Life-sciences supply chains absorb cold-chain volatility, GMP-driven batch quality, and demand variability across markets and indications. Smart manufacturing (predictive maintenance, OEE, digital twins), end-to-end supply-chain visibility, and AI-driven demand forecasting protect both compliance posture and on-shelf availability. Companies that close the visibility gap from CMO/CDMO partner sites through to specialty pharmacies improve launch readiness, lower expedite spend, and avoid stock-outs that translate directly into lost lives and lost revenue.",
      priorities: [
        {
          name: "Create E2E Supply Chain Visibility",
          useCases: [
            {
              name: "Automate Reporting (eg., OTIF)",
              description:
                "Generate operational KPI reports (OTIF, fill rate, expedite spend) on a near-real-time cadence with drill-down by lane, partner, and SKU.",
              businessValue:
                "Faster issue identification; lower expedite spend; better partner accountability.",
              typicalDataEntities: [
                "Shipment Events",
                "OTIF History",
                "Carrier Performance",
                "Order Fulfilment Records",
              ],
              typicalSourceSystems: ["TMS", "WMS", "ERP", "Carrier APIs"],
            },
            {
              name: "Inventory Management",
              description:
                "Optimise stock levels, expiries, and allocation across central, regional, and specialty-pharmacy nodes balancing service level with expiration risk on cold-chain product.",
              businessValue:
                "Lower expiration write-offs; higher in-market availability for newly launched products.",
              typicalDataEntities: [
                "Inventory Levels",
                "Demand Forecasts",
                "Expiration Dates",
                "Distribution Network",
              ],
              typicalSourceSystems: ["ERP", "WMS", "Demand Planning"],
            },
            {
              name: "Demand Forecasting",
              description:
                "Forecast drug demand by SKU, channel, region, and indication using ML models that incorporate epidemiology, market dynamics, prescription trends, and seasonality.",
              businessValue:
                "Higher forecast accuracy; fewer stock-outs of life-saving therapies; reduced expedite freight.",
              typicalDataEntities: [
                "Sales History",
                "Epidemiology Data",
                "Market Data",
                "Inventory Levels",
                "Prescription Trends",
              ],
              typicalSourceSystems: [
                "ERP",
                "Demand Planning",
                "Market Intelligence",
              ],
            },
            {
              name: "Distribution Optimization",
              description:
                "Plan shipments, routes, and allocations across cold-chain and ambient distribution networks -- including last-mile to specialty pharmacies and hospitals -- using AI on demand, capacity, and lane-cost data.",
              businessValue:
                "Lower distribution cost; improved cold-chain compliance.",
              typicalDataEntities: [
                "Lane Definitions",
                "Capacity",
                "Demand Forecasts",
                "Cold-Chain Telemetry",
              ],
              typicalSourceSystems: [
                "TMS",
                "WMS",
                "Carrier APIs",
                "Cold-Chain IoT",
              ],
            },
          ],
          kpis: [
            "Forecast accuracy",
            "OTIF delivery rate",
            "Inventory carrying cost",
          ],
          personas: [
            "VP Supply Chain",
            "Head of Manufacturing",
            "Chief Operating Officer",
          ],
        },
        {
          name: "Implement Smart Manufacturing",
          useCases: [
            {
              name: "Digital Twins",
              description:
                "Create digital twins of manufacturing processes (bioreactors, fill-finish lines, packaging) for simulation, optimisation, and quality assurance under different feed-stock and load conditions.",
              businessValue:
                "Higher batch yield; lower scale-up risk; supports continuous-process improvement against GMP constraints.",
              typicalDataEntities: [
                "Process Parameters",
                "Equipment State",
                "Batch Data",
                "Quality Attributes",
              ],
              typicalSourceSystems: ["MES", "SCADA", "LIMS"],
            },
            {
              name: "Overall Equipment Effectiveness",
              description:
                "Monitor OEE drivers (availability, performance, quality) in real-time across plants and CMOs to surface bottlenecks and direct improvement programs.",
              businessValue:
                "Higher OEE; reduced unplanned downtime; better-informed capital investment decisions.",
              typicalDataEntities: [
                "Equipment Runtime",
                "Production Output",
                "Quality Metrics",
                "Downtime Events",
              ],
              typicalSourceSystems: [
                "MES",
                "SCADA",
                "Quality Management System",
              ],
            },
            {
              name: "Predictive Maintenance",
              description:
                "Predict equipment failures in manufacturing facilities using sensor telemetry and maintenance history to minimise downtime and maintain GMP compliance.",
              businessValue:
                "Reduced unplanned downtime; lower maintenance cost; protected batch yield on critical equipment.",
              typicalDataEntities: [
                "Sensor Data",
                "Maintenance History",
                "Equipment Metadata",
                "Batch Records",
              ],
              typicalSourceSystems: ["MES", "CMMS", "SCADA"],
            },
          ],
          kpis: [
            "Batch yield",
            "OEE",
            "Right-first-time",
            "Cycle time",
            "Equipment uptime",
            "Batch rejection rate",
          ],
          personas: [
            "Chief Manufacturing Officer",
            "VP Supply Chain",
            "Site Director",
            "Head of Quality",
          ],
        },
      ],
    },
    {
      name: "Improve Commercial Effectiveness",
      whyChange:
        "Life-sciences companies need to generate real-world evidence at regulatory grade, deliver personalised omnichannel engagement to healthcare providers, and improve patient outcomes through data-driven commercial strategies. Pharmacovigilance demands have intensified, payer pressure on price and access continues to grow, and HCPs expect Amazon-grade contextual content from sales and medical teams. The commercial winners are those that operationalise RWE, build governed HCP/HCO 360s, and deploy compliant copilots into the field.",
      priorities: [
        {
          name: "Generate Real World Evidence",
          useCases: [
            {
              name: "Data Standardization with OMOP",
              description:
                "Map heterogeneous clinical and real-world data to OMOP common data model to enable cross-institutional analysis, evidence generation, and regulatory submission.",
              businessValue:
                "Faster RWE generation cycles; reusable analytics across therapeutic areas; lower per-study integration cost.",
              typicalDataEntities: [
                "Clinical Data",
                "EHR Data",
                "Claims Data",
                "OMOP Mappings",
              ],
              typicalSourceSystems: [
                "Electronic Health Records",
                "Claims Adjudication",
                "Clinical Data Warehouse",
              ],
            },
            {
              name: "Patient Cohorting & Propensity Score Matching",
              description:
                "Identify and match patient cohorts for comparative effectiveness studies using advanced analytics on EHR, claims, and registry data.",
              businessValue:
                "Faster RWE study cycles; better-matched comparator arms; higher acceptance from regulators and payers.",
              typicalDataEntities: [
                "Patient Cohorts",
                "Propensity Scores",
                "Clinical Outcomes",
                "Demographics",
              ],
              typicalSourceSystems: [
                "Clinical Data Warehouse",
                "Electronic Health Records",
                "Claims Adjudication",
              ],
            },
            {
              name: "Comparative Effectiveness",
              description:
                "Estimate treatment effects across real-world populations to support label expansion, payer negotiation, and clinical-guideline updates.",
              businessValue:
                "Stronger payer-negotiation positions; faster guideline acceptance; supports outcomes-based contracts.",
              typicalDataEntities: [
                "Treatment Cohorts",
                "Clinical Outcomes",
                "Confounders",
                "Effect Estimates",
              ],
              typicalSourceSystems: [
                "Clinical Data Warehouse",
                "Electronic Health Records",
                "Claims Adjudication",
              ],
            },
            {
              name: "Clinical Data Abstraction",
              description:
                "Extract structured data points (diagnoses, biomarkers, line of therapy, response) from unstructured clinical notes using NLP/LLM models with human-in-the-loop QA.",
              businessValue:
                "Higher coverage of structured outcomes; faster registry build; lower per-record abstraction cost.",
              typicalDataEntities: [
                "Clinical Notes",
                "Structured Extractions",
                "Validation Records",
              ],
              typicalSourceSystems: [
                "Electronic Health Records",
                "Clinical Data Warehouse",
                "NLP Platform",
              ],
            },
            {
              name: "Pharmacovigilance (Drug Safety & AE Detection)",
              description:
                "Detect, triage, and analyse adverse events from spontaneous reports, EHR data, claims, and social listening using AI to flag safety signals earlier and reduce manual case-processing burden.",
              businessValue:
                "Faster signal detection; lower per-case PV cost; improved regulatory posture.",
              typicalDataEntities: [
                "Adverse Event Reports",
                "Safety Signals",
                "Patient Data",
                "Product Labels",
                "Social Listening Signals",
              ],
              typicalSourceSystems: [
                "Safety Database",
                "Electronic Health Records",
                "Social Listening Platform",
              ],
            },
          ],
          kpis: [
            "HCP engagement rate",
            "Patient adherence",
            "Speed to launch peak",
            "Evidence generation speed",
            "Safety signal detection rate",
          ],
          personas: [
            "Head of Medical Affairs",
            "Chief Medical Officer",
            "Head of Pharmacovigilance",
            "VP Patient Services",
          ],
        },
        {
          name: "Deliver Provider Next-Best-Action",
          useCases: [
            {
              name: "Global Customer 360",
              description:
                "Unify HCP and HCO profiles, affiliations, prescribing behaviour, and engagement history across markets in a governed customer view used by sales, medical, and marketing.",
              businessValue:
                "Foundational for every downstream engagement use case; higher analytic coverage of HCP/HCO behaviour.",
              typicalDataEntities: [
                "HCP Profiles",
                "HCO Profiles",
                "Affiliations",
                "Prescribing Data",
                "Engagement History",
              ],
              typicalSourceSystems: [
                "CRM",
                "Sales Force Automation",
                "Reference Data Provider",
              ],
            },
            {
              name: "Brand Analytics (Provider Segmentation, Sales Forecasting)",
              description:
                "Segment HCPs by prescribing behaviour, influence, and responsiveness, and forecast brand demand by territory using ML on prescription, claims, and engagement data.",
              businessValue:
                "Higher sales-team productivity; better territory targeting; defensible growth forecasts.",
              typicalDataEntities: [
                "Prescribing Data",
                "Provider Profiles",
                "Engagement History",
                "Market Share",
              ],
              typicalSourceSystems: [
                "Sales Force Automation",
                "Claims Data",
                "CRM",
              ],
            },
            {
              name: "Sales Rep / Medical Science Assistant",
              description:
                "Deploy compliant AI copilots for field reps and MSLs that prepare call plans, surface relevant clinical evidence, and draft follow-ups -- with audit trails for compliance and medical review.",
              businessValue:
                "Higher rep productivity; better-prepared HCP interactions; lower compliance risk.",
              typicalDataEntities: [
                "Provider Profiles",
                "Prescribing Data",
                "Product Information",
                "Call History",
                "Approved Content",
              ],
              typicalSourceSystems: [
                "Sales Force Automation",
                "CRM",
                "Medical Information System",
              ],
            },
            {
              name: "Next-Best-Action Recommendations / Omnichannel",
              description:
                "Use ML to recommend the optimal next interaction with each provider across email, web, in-person, and digital channels honouring HCP preferences and consent.",
              businessValue:
                "Higher engagement rate per touch; reduced wasted media spend; improved share-of-voice on key brands.",
              typicalDataEntities: [
                "Provider Profiles",
                "Interaction History",
                "Propensity Scores",
                "Channel Preferences",
              ],
              typicalSourceSystems: [
                "Sales Force Automation",
                "CRM",
                "Marketing Automation",
              ],
            },
          ],
          kpis: [
            "HCP engagement rate",
            "Patient adherence",
            "Speed to launch peak",
            "Provider engagement rate",
            "Prescription growth",
          ],
          personas: [
            "Chief Commercial Officer",
            "VP Medical Affairs",
            "Head of Sales",
            "Head of Marketing",
          ],
        },
        {
          name: "Personalized Patient Engagement",
          useCases: [
            {
              name: "Deliver Digital Health Applications (eg., CGM)",
              description:
                "Provide AI-assisted insights and interventions from connected devices and apps (CGMs, inhalers, wearables) to support adherence, triage, and patient-services workflows.",
              businessValue:
                "Higher patient adherence; better outcomes evidence; differentiated patient-services offering.",
              typicalDataEntities: [
                "Device Telemetry",
                "Patient Profiles",
                "Adherence Logs",
                "Care Plans",
              ],
              typicalSourceSystems: [
                "Patient Services Platform",
                "Device Cloud",
                "CRM",
              ],
            },
            {
              name: "Support Patient Services (eg., Scheduling, Chatbot)",
              description:
                "Automate case intake, triage, and scheduling through compliant conversational interfaces -- routing high-risk cases to nurses and clinical pharmacists with full transcript audit.",
              businessValue:
                "Higher patient-service throughput; lower per-case cost; consistent script and disclosure compliance.",
              typicalDataEntities: [
                "Case Records",
                "Conversation Logs",
                "Triage Outcomes",
              ],
              typicalSourceSystems: [
                "Patient Services Platform",
                "CRM",
                "Conversational AI Platform",
              ],
            },
            {
              name: "Automate Adherence Reminders",
              description:
                "Identify non-adherent patients and trigger personalised reminders and escalations across SMS, voice, app, and care-team workflows.",
              businessValue:
                "Higher persistence at month-3 and month-6; better outcomes evidence to support payer access.",
              typicalDataEntities: [
                "Refill Data",
                "Adherence Scores",
                "Patient Profiles",
                "Engagement Logs",
              ],
              typicalSourceSystems: [
                "Patient Services Platform",
                "CRM",
                "Marketing Automation",
              ],
            },
            {
              name: "Digital Patient 360",
              description:
                "Build a unified, longitudinal patient view (with consent) for care management and patient services -- spanning devices, EHR, claims, and patient-service interactions.",
              businessValue:
                "Foundational for every patient-engagement use case; supports outcomes-based contracting evidence.",
              typicalDataEntities: [
                "Patient Profiles",
                "EHR Records",
                "Claims",
                "Device Telemetry",
                "Consent Records",
              ],
              typicalSourceSystems: [
                "Patient Services Platform",
                "Electronic Health Records",
                "Claims Adjudication",
                "Consent Management Platform",
              ],
            },
          ],
          kpis: [
            "HCP engagement rate",
            "Patient adherence",
            "Speed to launch peak",
          ],
          personas: [
            "Chief Commercial Officer",
            "VP Medical Affairs",
            "VP Patient Services",
          ],
        },
      ],
    },
  ],
};
