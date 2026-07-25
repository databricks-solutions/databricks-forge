/**
 * Capital Markets -- Industry Outcome Map
 *
 * Strategic imperatives and pillars are sourced verbatim from the Master
 * Repository XLSX (Use Case Summaries sheet). Use case names and short
 * descriptions come from the same source. Rich enrichment fields (model
 * type, KPI, benchmarks, data asset linkage, MC/VA, economic patterns)
 * live in capital-markets.enrichment.ts and are produced by the master repo seed.
 */

import type { IndustryOutcome } from "./index";

export const CAPITAL_MARKETS: IndustryOutcome = {
  id: "capital-markets",
  name: "Capital Markets",
  subVerticals: ["Investment Banks","Asset Managers","Hedge Funds","Broker-Dealers","Custody & Clearing"],
  suggestedDomains: ["Trading","Risk","Compliance","Investment Research","Operations","Treasury"],
  suggestedPriorities: ["Drive Growth","Protect the Firm","Be More Efficient"],
  objectives: [
    {
      name: "Drive Growth",
      whyChange:
        "Capital-markets revenue is concentrated in fewer, larger franchises while alpha in traditional strategies has decayed. Asset managers face a structural shift toward passive products, advisory businesses are pressured by fee compression, and trading desks compete with quant funds, HFTs, and electronic market makers. The growth path runs through three reinforcing capabilities: institutional-grade investment analytics that combine fundamental, alternative, and ESG data with rigorous backtesting; advisory experiences that personalize at portfolio-level and automate diligence; and trading analytics that quantify execution quality and operationalize ML-driven strategy. Firms that invest in this analytical core unlock sustainable alpha, retain advisory wallet share, and convert flow data into trading P&L.",
      priorities: [
        {
          name: "Investment Analytics",
          useCases: [
            {
              name: "Market Intelligence",
              description:
                "Build a consolidated, queryable view of markets, sectors, issuers, and macro themes -- combining structured market data, news, filings, and alternative datasets -- to surface actionable signals for sales, trading, and research within the working day.",
              businessValue:
                "Faster idea-generation cycle; broader coverage of long-tail issuers; foundation for downstream alpha and risk use cases.",
              typicalDataEntities: [
                "Market Prices",
                "Issuer Reference Data",
                "News & Filings Corpus",
                "Sector Hierarchies",
                "Macroeconomic Indicators",
              ],
              typicalSourceSystems: [
                "Market Data Vendor",
                "News Provider",
                "Reference Data Service",
                "Research Platform",
              ],
            },
            {
              name: "Backtesting",
              description:
                "Evaluate trading and investment strategies across historical regimes with robust slippage, latency, capacity, and survivorship-bias-aware simulations -- producing defensible performance attribution before any capital is at risk.",
              businessValue:
                "Higher hit rate on strategy launches; eliminated spurious-alpha incidents; faster strategy-research cycle.",
              typicalDataEntities: [
                "Historical Tick Data",
                "Strategy Definitions",
                "Slippage / Cost Models",
                "Performance Attribution",
                "Regime Tags",
              ],
              typicalSourceSystems: [
                "Market Data Vendor",
                "Strategy Library",
                "Tick Database",
                "Risk System",
              ],
            },
            {
              name: "Portfolio construction & Optimization",
              description:
                "Build efficient portfolios under client constraints, risk budgets, factor exposures, and ESG mandates using mean-variance, risk-parity, factor, and ML-augmented optimization -- with full reproducibility and explainability for compliance.",
              businessValue:
                "Improved Sharpe / IR; tighter constraint adherence; faster client-bespoke portfolio delivery.",
              typicalDataEntities: [
                "Security Universe",
                "Risk Factor Models",
                "Constraint Definitions",
                "Client Objectives",
                "Optimization Outputs",
              ],
              typicalSourceSystems: [
                "Risk System",
                "Order Management System",
                "Portfolio Management System",
                "Reference Data Service",
              ],
            },
            {
              name: "Alternative Data & ESG Analytics",
              description:
                "Harvest alpha and risk insights from non-traditional sources -- satellite imagery, transaction data, web scraping, supply-chain telemetry, ESG ratings -- with auditability, vendor governance, and decay tracking.",
              businessValue:
                "Differentiated alpha sources; better-grounded ESG/sustainability claims; defensible audit trail for AI-derived signals.",
              typicalDataEntities: [
                "Alternative Datasets",
                "ESG Ratings",
                "Vendor Metadata",
                "Signal Decay Metrics",
                "Lineage Records",
              ],
              typicalSourceSystems: [
                "Alt-Data Vendor Platform",
                "ESG Data Provider",
                "Lakehouse",
                "Data Catalog",
              ],
            },
          ],
          kpis: [
            "Alpha generated",
            "AUM growth",
            "Trade execution quality",
            "Advisory revenue",
            "Strategy backtest-to-live-IR ratio",
          ],
          personas: [
            "Head of Trading",
            "Chief Investment Officer",
            "Head of Research",
            "Head of Quantitative Research",
          ],
        },
        {
          name: "Investment Advisory",
          useCases: [
            {
              name: "Personalized Investment Advice",
              description:
                "Tailor portfolio-level recommendations to client goals, suitability, tax situation, ESG preferences, and risk tolerance -- with full explainability and auditable reasoning -- delivered via advisor cockpits and self-serve digital channels.",
              businessValue:
                "Higher advisor productivity; better client outcomes; defensible suitability documentation.",
              typicalDataEntities: [
                "Client Profiles",
                "Goal & Suitability Data",
                "Holdings",
                "Recommendation Logs",
                "Explainability Records",
              ],
              typicalSourceSystems: [
                "CRM",
                "Portfolio Management System",
                "Suitability Platform",
                "Advisor Workstation",
              ],
            },
            {
              name: "Sales & Trading Intelligences",
              description:
                "Surface client opportunities (axes, flows, idea-fit) and execution improvements (better routing, internalization opportunities) to sales and trading desks -- using ML on order flow, holdings, and behavioural signals to drive wallet share.",
              businessValue:
                "Higher wallet share with target clients; improved cross-sell rates; better conversion of client flow into P&L.",
              typicalDataEntities: [
                "Client Holdings",
                "Order Flow",
                "Axes / Inventory",
                "Behavioural Signals",
                "Conversion Outcomes",
              ],
              typicalSourceSystems: [
                "Order Management System",
                "CRM",
                "Sales Platform",
                "Internalization Engine",
              ],
            },
            {
              name: "M&A Automation and Integration",
              description:
                "Automate diligence, clause extraction, and post-merger data mapping using LLMs grounded in deal corpora and entity-resolution -- reducing the cycle time and human-cost of M&A advisory and integration work.",
              businessValue:
                "Shorter diligence cycles; faster fee realisation; lower error rate in clause extraction and integration mapping.",
              typicalDataEntities: [
                "Deal Documents",
                "Clause Catalog",
                "Entity Mapping",
                "Comparable Transactions",
                "Integration Plans",
              ],
              typicalSourceSystems: [
                "Document Management",
                "Deal Room",
                "M&A Database",
                "LLM / Vector Store",
              ],
            },
          ],
          kpis: [
            "Advisory revenue",
            "Client wallet share",
            "Suitability compliance rate",
            "Diligence cycle time",
          ],
          personas: [
            "Head of Wealth",
            "Head of M&A",
            "Chief Investment Officer",
            "Head of Sales & Trading",
          ],
        },
        {
          name: "Trading Analytics",
          useCases: [
            {
              name: "Real-Time Market Analysis",
              description:
                "Monitor moves and drivers across asset classes, venues, and order-book levels with low-latency analytics and alerting -- supporting human traders and feeding inputs to algo strategy logic.",
              businessValue:
                "Faster reaction to market dislocations; better-informed manual trading; reduced slippage on large orders.",
              typicalDataEntities: [
                "Tick Data",
                "Order Book Snapshots",
                "Trade Flow",
                "Cross-Asset Signals",
                "Alert Rules",
              ],
              typicalSourceSystems: [
                "Market Data Vendor",
                "Tick Database",
                "Order Management System",
                "Alerting Platform",
              ],
            },
            {
              name: "Transaction Cost Analysis (TCA)",
              description:
                "Quantify execution quality across venues, brokers, and algorithms -- decomposing slippage into market impact, timing, and venue effects -- to optimize order routing, algo selection, and broker negotiation.",
              businessValue:
                "5-15 bps improvement in execution quality on large orders; data-driven broker / algo selection.",
              typicalDataEntities: [
                "Parent / Child Order Records",
                "Venue Fills",
                "Benchmark Prices",
                "Slippage Decomposition",
                "Algo Performance",
              ],
              typicalSourceSystems: [
                "Order Management System",
                "Execution Management System",
                "Tick Database",
                "Broker Reports",
              ],
            },
            {
              name: "Predictive Analytics and Forecasting",
              description:
                "Forecast returns, volatility, liquidity, and order-flow imbalances using ML on time-series, order-book, and alternative-data inputs -- supplying signals for risk management and alpha generation.",
              businessValue:
                "Higher Sharpe on signal-driven strategies; better-calibrated risk parameters.",
              typicalDataEntities: [
                "Forecast Models",
                "Feature Stores",
                "Realised vs Predicted Outcomes",
                "Backtest Records",
              ],
              typicalSourceSystems: [
                "Model Serving",
                "Feature Store",
                "Lakehouse",
                "Risk System",
              ],
            },
            {
              name: "Algorithmic Trading",
              description:
                "Design and orchestrate low-latency execution and proprietary strategies with codified risk controls, kill switches, and automated regulatory surveillance -- supporting both client execution and principal trading.",
              businessValue:
                "Lower per-trade execution cost; higher capacity in target strategies; cleaner regulator audit trail.",
              typicalDataEntities: [
                "Strategy Definitions",
                "Risk Limits",
                "Real-Time Positions",
                "Algo Performance",
                "Kill-Switch Events",
              ],
              typicalSourceSystems: [
                "Execution Management System",
                "Risk System",
                "Algo Orchestration Platform",
                "Surveillance System",
              ],
            },
          ],
          kpis: [
            "Trade execution quality",
            "Slippage bps",
            "Algo Sharpe ratio",
            "Surveillance alert turnaround",
          ],
          personas: [
            "Head of Trading",
            "Head of Execution",
            "Head of Quantitative Research",
            "Head of Surveillance",
          ],
        },
      ],
    },
    {
      name: "Protect the Firm",
      whyChange:
        "Capital-markets firms face a relentless protect surface: market and credit risk that can vaporise capital in volatile regimes, cybersecurity threats from sophisticated nation-state and criminal actors, AML/sanctions and trade-surveillance obligations enforced with multi-billion-dollar penalties, and increasing scrutiny on model risk and AI explainability. The cost of getting this wrong is existential: a single VAR breach, surveillance gap, or sanctions miss can end the franchise. Modern data and AI capabilities -- intraday risk, behavioural anomaly detection, automated KYC / transaction monitoring, and rigorous model risk management -- are now table-stakes; firms that do not invest face higher capital charges, regulatory consent decrees, and the steady drift of clients to better-controlled competitors.",
      priorities: [
        {
          name: "Risk Management",
          useCases: [
            {
              name: "Market Risk",
              description:
                "Compute daily VaR, stress losses, and sensitivities (Greeks, factor exposures) across portfolios with intraday refresh capability and full attribution from instrument to capital metric.",
              businessValue:
                "Lower regulatory capital charges from cleaner, more frequent risk; faster reaction to volatility regime shifts.",
              typicalDataEntities: [
                "Positions",
                "Market Data",
                "Risk Factor Models",
                "Sensitivity Reports",
                "Stress Scenarios",
              ],
              typicalSourceSystems: [
                "Risk System",
                "Market Data Vendor",
                "Position Database",
                "Stress Testing Engine",
              ],
            },
            {
              name: "Credit Risk",
              description:
                "Estimate probability of default, loss-given-default, and exposure-at-default for counterparties and exposures using ML-augmented PD/LGD/EAD models with full lineage and validation evidence.",
              businessValue:
                "More accurate provisioning; better-calibrated limits; reduced loss event severity.",
              typicalDataEntities: [
                "Counterparty Reference",
                "Exposure Records",
                "Credit Ratings",
                "Default History",
                "PD/LGD/EAD Models",
              ],
              typicalSourceSystems: [
                "Credit System",
                "Risk System",
                "Counterparty Database",
                "Model Registry",
              ],
            },
            {
              name: "Counterparty Risk",
              description:
                "Calculate potential future exposure (PFE) and wrong-way risk under multiple scenarios, plus concentration monitoring across counterparties, sectors, and geographies.",
              businessValue:
                "Lower CVA / FVA reserves; cleaner counterparty selection; reduced concentration losses.",
              typicalDataEntities: [
                "Counterparty Exposures",
                "PFE Scenarios",
                "Concentration Metrics",
                "Wrong-Way Indicators",
              ],
              typicalSourceSystems: [
                "Risk System",
                "Counterparty Database",
                "Collateral Management System",
              ],
            },
          ],
          kpis: ["VaR exceedances", "Loss events", "Capital charge", "Time-to-recompute risk"],
          personas: [
            "Chief Risk Officer",
            "Head of Market Risk",
            "Head of Credit Risk",
            "Head of Counterparty Risk",
          ],
        },
        {
          name: "Cybersecurity",
          useCases: [
            {
              name: "User & Entity Behavior Analytics",
              description:
                "Detect anomalous employee, client, and system behaviours using ML on identity, access, and activity telemetry -- catching insider risk, compromised credentials, and lateral movement that rule-based controls miss.",
              businessValue:
                "Faster detection of insider threats and credential compromise; lower MTTR on identity-based attacks.",
              typicalDataEntities: [
                "Identity Events",
                "Access Logs",
                "Behavioural Baselines",
                "Anomaly Scores",
              ],
              typicalSourceSystems: ["SIEM", "Identity Provider", "EDR", "DLP"],
            },
            {
              name: "Threat Hunting & Advanced Detection",
              description:
                "Proactively hunt for novel tactics, techniques, and procedures across the estate using a security data lake -- combining endpoint, network, identity, and cloud telemetry with ML and rule-based detections.",
              businessValue:
                "Earlier detection of novel attacks; cleaner audit trail for incident response.",
              typicalDataEntities: [
                "Hunt Hypotheses",
                "Telemetry Data",
                "Indicator Catalogs",
                "Detection Rules",
              ],
              typicalSourceSystems: ["Security Data Lake", "SIEM", "EDR", "Threat Intelligence Platform"],
            },
            {
              name: "Network Analysis & Inventory",
              description:
                "Map network topology, asset dependencies, and external exposure surfaces continuously to identify risky paths and enforce segmentation policy.",
              businessValue:
                "Lower attack-surface area; cleaner audit posture for network controls.",
              typicalDataEntities: [
                "Asset Inventory",
                "Network Topology",
                "Dependency Maps",
                "Exposure Records",
              ],
              typicalSourceSystems: ["CMDB", "Network Monitoring", "Cloud Provider", "Asset Discovery"],
            },
            {
              name: "Phishing & Email Security",
              description:
                "Detect and remediate phishing, BEC, and credential-harvest emails using ML on email content, sender reputation, and user-reporting signals -- with automated takedown and user-coaching loops.",
              businessValue:
                "Lower successful-phishing rate; reduced incident-response cost.",
              typicalDataEntities: [
                "Email Headers",
                "URL Reputation",
                "User Reports",
                "Detection Verdicts",
              ],
              typicalSourceSystems: ["Email Security Gateway", "SIEM", "User Reporting Portal"],
            },
            {
              name: "SIEM Augmentation",
              description:
                "Prioritize and triage SIEM alerts with ML-driven scoring, automated enrichment, and LLM-generated summaries -- letting analysts focus on the alerts that matter and reducing alert-fatigue churn.",
              businessValue:
                "20-40% reduction in analyst handle time per alert; lower true-positive miss rate.",
              typicalDataEntities: [
                "SIEM Alerts",
                "Enrichment Data",
                "Triage Outcomes",
                "Analyst Notes",
              ],
              typicalSourceSystems: ["SIEM", "SOAR", "Threat Intelligence Platform", "LLM Service"],
            },
          ],
          kpis: ["Time-to-detect", "Mean time to respond", "Phishing success rate", "Critical alert backlog"],
          personas: ["CISO", "Head of Detection & Response", "Head of Threat Intelligence"],
        },
        {
          name: "Fraud Prevention",
          useCases: [
            {
              name: "Card Transaction Fraud Prevention",
              description:
                "Score card-not-present and card-present transactions in real time using ML on velocity, device, geo, and behavioural signals -- interdicting suspicious activity within sub-100ms latency budgets to keep checkout friction low.",
              businessValue:
                "Lower fraud loss bps; better-than-industry false-positive rate at the same true-positive recall.",
              typicalDataEntities: [
                "Transactions",
                "Device Fingerprints",
                "Behavioural Signals",
                "Fraud Verdicts",
                "Chargebacks",
              ],
              typicalSourceSystems: [
                "Payment Gateway",
                "Fraud Platform",
                "Risk System",
                "Device Intelligence",
              ],
            },
            {
              name: "Application Fraud",
              description:
                "Detect first-party and synthetic-identity application fraud using identity-graph and document-fraud models -- catching mules, synthetic identities, and bonus-abuse rings before account opening.",
              businessValue:
                "Reduced first-party / synthetic identity loss; cleaner regulator posture on KYC adequacy.",
              typicalDataEntities: [
                "Application Records",
                "Identity Graph",
                "Document Fraud Flags",
                "Verification Results",
              ],
              typicalSourceSystems: [
                "Onboarding Platform",
                "Identity Verification Provider",
                "Fraud Platform",
              ],
            },
            {
              name: "Identity Theft",
              description:
                "Flag account-takeover and impersonation using behavioural biometrics, device intelligence, and step-up authentication signals -- protecting the highest-value cohorts most targeted by fraudsters.",
              businessValue:
                "Lower ATO loss; protected high-value clients and reduced regulator complaint volume.",
              typicalDataEntities: [
                "Login Events",
                "Behavioural Biometrics",
                "Device Reputation",
                "Step-Up Outcomes",
              ],
              typicalSourceSystems: [
                "Auth Platform",
                "Behavioural Biometrics Vendor",
                "Fraud Platform",
              ],
            },
          ],
          kpis: ["Fraud loss bps", "False positive rate", "Chargeback rate", "ATO incidents"],
          personas: ["Head of Fraud", "Head of Financial Crime", "Chief Risk Officer"],
        },
        {
          name: "Regulatory Compliance",
          useCases: [
            {
              name: "Transaction monitoring",
              description:
                "Detect AML typologies (structuring, mule networks, smurfing, trade-based laundering) using rules + ML hybrids on transaction graphs and customer behaviour -- producing prioritized cases with full investigator audit trails and regulatory-ready reports.",
              businessValue:
                "Lower SAR/SMR backlog; higher conviction of true positives; cleaner regulator submissions.",
              typicalDataEntities: [
                "Transactions",
                "Customer Profiles",
                "Network Graphs",
                "Typology Rules",
                "Case Records",
              ],
              typicalSourceSystems: [
                "AML/CTF Platform",
                "Core Banking",
                "Customer Database",
                "Case Management",
              ],
            },
            {
              name: "Screening (KYC)",
              description:
                "Run real-time and entity-level screening against sanctions, PEP, and adverse-media lists with case management, fuzzy matching, and remediation workflows -- supporting onboarding, periodic refresh, and event-driven re-screening.",
              businessValue:
                "Lower screening false-positive rate; faster onboarding; defensible adverse-media posture.",
              typicalDataEntities: [
                "Customer Records",
                "Sanctions / PEP Lists",
                "Match Decisions",
                "Investigator Notes",
              ],
              typicalSourceSystems: [
                "Screening Platform",
                "List Provider",
                "Onboarding System",
                "Case Management",
              ],
            },
            {
              name: "Credit Recognition (CECL)",
              description:
                "Estimate lifetime expected credit loss and provisioning under CECL/IFRS 9 using ML-augmented PD/LGD/EAD models with macroeconomic overlays and full lineage to source data.",
              businessValue:
                "More accurate provisioning; cleaner accounting close cycle; reduced restatement risk.",
              typicalDataEntities: [
                "Loan Portfolios",
                "Macro Scenarios",
                "Loss History",
                "Provisioning Outputs",
              ],
              typicalSourceSystems: ["Credit System", "Risk System", "ERP / Finance"],
            },
            {
              name: "Model Risk Management",
              description:
                "Maintain a complete inventory of models, validate them on schedule, monitor performance and drift, and produce regulatory-grade documentation for SR 11-7 / TRIM / equivalent -- including LLM and AI agent governance for the new generation of models.",
              businessValue:
                "Faster MRM cycle; reduced regulator-driven model takedowns; defensible AI governance posture.",
              typicalDataEntities: [
                "Model Inventory",
                "Validation Reports",
                "Performance Monitors",
                "Drift Signals",
                "AI / LLM Risk Assessments",
              ],
              typicalSourceSystems: [
                "Model Registry",
                "Validation Platform",
                "GRC Platform",
                "MLflow",
              ],
            },
          ],
          kpis: ["AML alert turnaround", "False positive rate", "CECL forecast accuracy", "MRM cycle time"],
          personas: [
            "Chief Compliance Officer",
            "Head of Financial Crime",
            "Money Laundering Reporting Officer",
            "Head of Model Risk",
          ],
        },
      ],
    },
    {
      name: "Be More Efficient",
      whyChange:
        "Capital markets cost-to-income ratios are stubbornly high, with revenue growth lagging cost growth across most franchises. Manual processes in treasury, finance, performance reporting, and back/middle office consume millions of hours that could be automated; legacy systems and brittle integrations cause reconciliation breaks; and market-data, technology, and vendor spend balloons without commensurate visibility. AI-driven document processing, intelligent automation, and analytics-native operating models deliver durable cost-to-income improvement -- 5-15 percentage points typical for firms that commit to a multi-year transformation. Without it, fee compression eats margin and opex grows faster than revenue.",
      priorities: [
        {
          name: "CFO & Treasury",
          useCases: [
            {
              name: "Financial Projections & Reporting",
              description:
                "Produce top-down and bottom-up forecasts, close packs, and management reporting using AI-driven driver-based models on operational and market data -- replacing spreadsheet-bound budgets with continuously refreshed scenarios.",
              businessValue:
                "Faster close cycle; better-informed capital allocation; cleaner external reporting posture.",
              typicalDataEntities: [
                "Financial Actuals",
                "Forecast Drivers",
                "Scenario Definitions",
                "Close Packs",
              ],
              typicalSourceSystems: ["ERP / Finance", "Planning System", "Trading Platform"],
            },
            {
              name: "Operational Dashboarding",
              description:
                "Provide cross-functional KPI dashboards for technology, operations, and risk -- consolidating disparate operational data sources into a single, lineage-traced view used by the executive committee and board.",
              businessValue:
                "Better-informed operating decisions; lower analyst time spent on report-building.",
              typicalDataEntities: [
                "Operational KPIs",
                "SLA / SLO Metrics",
                "Incident Data",
                "Dashboard Catalog",
              ],
              typicalSourceSystems: ["BI Platform", "Operational Systems", "ITSM", "Lakehouse"],
            },
            {
              name: "Performance reporting and analysis",
              description:
                "Generate GIPS-compliant performance reporting, attribution analysis, and client packs -- automating production of advisory and asset-management deliverables with full audit lineage.",
              businessValue:
                "Lower per-client reporting cost; faster client-facing publication; cleaner audit posture.",
              typicalDataEntities: [
                "Holdings",
                "Returns / Attribution",
                "Benchmarks",
                "Client Hierarchy",
                "Report Templates",
              ],
              typicalSourceSystems: [
                "Performance System",
                "Portfolio Management System",
                "CRM",
                "Reporting Platform",
              ],
            },
            {
              name: "Expense and Cost management",
              description:
                "Optimize vendor, market-data, and technology spend with usage analytics -- identifying redundant feeds, under-utilized licences, and renegotiation leverage points.",
              businessValue:
                "5-15% reduction in market-data and technology vendor spend; cleaner contract renewals.",
              typicalDataEntities: [
                "Vendor Contracts",
                "Usage Metrics",
                "Spend by Category",
                "Renewal Schedules",
              ],
              typicalSourceSystems: ["Vendor Management", "ERP / Finance", "Telemetry / Usage Logs"],
            },
          ],
          kpis: ["Cost-to-income ratio", "Forecast accuracy", "Vendor spend reduction"],
          personas: ["Chief Operating Officer", "Chief Financial Officer", "Head of Treasury", "Head of Procurement"],
        },
        {
          name: "Back- Middle office automation",
          useCases: [
            {
              name: "Intelligent Document Processing",
              description:
                "Automate intake, classification, clause extraction, and structured-data extraction from confirmations, ISDA agreements, term sheets, and operational correspondence using LLMs grounded in domain corpora and validated by human-in-the-loop workflows.",
              businessValue:
                "60-80% reduction in manual processing time; lower exception rate; faster trade-confirmation cycle.",
              typicalDataEntities: [
                "Document Corpus",
                "Extraction Schemas",
                "Validation Results",
                "Workflow Tickets",
              ],
              typicalSourceSystems: [
                "Document Management",
                "OCR / IDP Platform",
                "LLM Service",
                "Operational Systems",
              ],
            },
            {
              name: "Customer Onboarding (AML/KYC)",
              description:
                "Digitize end-to-end onboarding with identity verification, KYC document collection, sanctions / PEP screening, and risk scoring -- delivering institutional and wealth onboarding at fintech speed with bank-grade controls.",
              businessValue:
                "50-70% reduction in onboarding cycle time; lower abandonment; cleaner regulatory posture.",
              typicalDataEntities: [
                "Customer Records",
                "Identity Documents",
                "Verification Outcomes",
                "Risk Scores",
                "Onboarding Workflow",
              ],
              typicalSourceSystems: [
                "Onboarding Platform",
                "Identity Verification Provider",
                "Screening Platform",
                "CRM",
              ],
            },
            {
              name: "Workforce Analytics",
              description:
                "Provide headcount, productivity, attrition risk, and skills-gap insights using HR data combined with operational telemetry -- supporting workforce planning, succession, and learning-and-development investment.",
              businessValue:
                "Better-allocated headcount; reduced unwanted attrition; targeted skills investment.",
              typicalDataEntities: [
                "Employee Records",
                "Productivity Metrics",
                "Skill Inventories",
                "Attrition Risk Scores",
              ],
              typicalSourceSystems: ["HRIS", "Learning Management", "Performance Management"],
            },
          ],
          kpis: ["Cost-to-income ratio", "Reconciliation breaks", "STP rate", "Onboarding cycle time"],
          personas: ["Chief Operating Officer", "Head of Operations", "Head of HR", "Head of Onboarding"],
        },
      ],
    },
  ],
};
