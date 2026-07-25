/**
 * Consumer Goods -- Industry Outcome Map
 *
 * Strategic imperatives and pillars are sourced from the Master Repository
 * XLSX (Use Case Summaries sheet). Use case names match the Master Repo
 * canonical taxonomy so `consumer-goods.enrichment.ts` lookups (keyed by
 * lowercase name) keep resolving. Rich consultant-grade prose -- description,
 * businessValue, typicalDataEntities, typicalSourceSystems -- was lifted
 * from the legacy RCG outcome map during the May 2026 registry consolidation.
 * Benchmarks, model types, KPI targets, dataAssetIds, and economic patterns
 * remain in consumer-goods.enrichment.ts.
 */

import type { IndustryOutcome } from "./index";

export const CONSUMER_GOODS: IndustryOutcome = {
  id: "consumer-goods",
  name: "Consumer Goods",
  subVerticals: [
    "Food & Beverage",
    "Personal Care",
    "Household Products",
    "Apparel & Accessories",
    "Durables",
    "Consumer Goods / CPG",
  ],
  suggestedDomains: [
    "Marketing",
    "Sales",
    "Supply Chain",
    "Trade Promotion",
    "Innovation",
    "Workforce",
    "Field Operations",
    "Sustainability",
  ],
  suggestedPriorities: [
    "Increase Revenue",
    "Reduce Cost",
    "Optimize Operations",
    "Profitable Volume Growth",
    "Brand Equity",
    "Achieve ESG",
  ],
  objectives: [
    {
      name: "Improve Market Intelligence",
      whyChange:
        "The $8.6 trillion consumer-goods industry is being squeezed by private-label encroachment, retailer pressure on terms, and consumer fragmentation across channels. Faster, deeper shopper and brand insight closes the gap between consumer signal and shelf execution -- the brands that read trends, sentiment, and competitive moves in days rather than quarters protect both share and price. AI-driven panel synthesis, social listening, and competitive scraping turn slow quarterly research cycles into continuous intelligence.",
      priorities: [
        {
          name: "Shopper Insights",
          useCases: [
            {
              name: "Behavioral analytics",
              description:
                "Understand shopper journeys and friction across digital and physical touchpoints using behavioural events, panel data, and purchase signals to grow conversion and retention.",
              businessValue:
                "Higher conversion at shelf and online; lower CAC through better targeting on resolved consumer segments.",
              typicalDataEntities: [
                "Consumer Profiles",
                "Behavioural Events",
                "Purchase History",
                "Journey Stages",
                "Engagement Metrics",
              ],
              typicalSourceSystems: [
                "CDP",
                "E-Commerce Platform",
                "Panel Data Provider",
                "Loyalty Platform",
              ],
            },
            {
              name: "Trend monitoring",
              description:
                "Early detection of category, price, and seasonality shifts using social, search, and POS-syndicated data so brand and innovation teams can react before quarterly reviews.",
              businessValue:
                "Faster trend response; lower risk of missing emerging consumer needs to private-label or DTC challengers.",
              typicalDataEntities: [
                "Social Listening Signals",
                "Search Trends",
                "POS Syndicated Sales",
                "Competitor Activity",
              ],
              typicalSourceSystems: [
                "Social Listening Platform",
                "Search Trends Provider",
                "Retail Data Syndication",
                "Trend Intelligence Platform",
              ],
            },
            {
              name: "Shopper insights",
              description:
                "Build segment, need-state, and occasion understanding to inform the 4Ps -- product, price, place, and promotion -- across channels and retailer banners.",
              businessValue:
                "Sharper segmentation and occasion-based marketing; higher trade-promotion ROI through banner-specific activation.",
              typicalDataEntities: [
                "Shopper Segments",
                "Need-State Definitions",
                "Occasion Mapping",
                "Banner-Level Sales",
              ],
              typicalSourceSystems: [
                "Panel Data Provider",
                "Retail Data Syndication",
                "CRM",
                "Marketing Platform",
              ],
            },
            {
              name: "Customer data management",
              description:
                "Create governed 360 degree consumer profiles with consent and preference enforcement so analytics, modelling, and activation share a single auditable view.",
              businessValue:
                "Foundational for every downstream personalisation, modelling, and DTC use case; regulatory readiness for GDPR/CCPA/CPRA.",
              typicalDataEntities: [
                "Consumer Profiles",
                "Consent Records",
                "Preference Data",
                "Identity Graph",
              ],
              typicalSourceSystems: [
                "CDP",
                "Consent Management Platform",
                "CRM",
                "DTC Platform",
              ],
            },
          ],
          kpis: [
            "Brand health score",
            "Share of voice",
            "Time-to-insight",
            "Distribution velocity",
          ],
          personas: ["Chief Marketing Officer", "VP Insights", "Brand Director"],
        },
        {
          name: "Brand Insights",
          useCases: [
            {
              name: "Brand Equity",
              description:
                "Track brand equity, consideration, purchase intent, and sentiment across panels and social to guide brand investment with high-frequency signal rather than quarterly trackers.",
              businessValue:
                "Better-allocated brand spend; faster identification of equity erosion or recovery.",
              typicalDataEntities: [
                "Brand Tracker Surveys",
                "Social Sentiment",
                "Purchase Intent Signals",
                "NPS / CSAT",
              ],
              typicalSourceSystems: [
                "Brand Tracker Platform",
                "Social Listening Platform",
                "Survey Tool",
              ],
            },
            {
              name: "Marketing Mix",
              description:
                "Quantify channel ROI with MMM/MTA blends and optimise 4P budgets across paid, owned, retail-media, and trade-promotion levers.",
              businessValue:
                "Higher marketing ROI; cleaner reallocation between brand, performance, and trade dollars.",
              typicalDataEntities: [
                "Media Spend",
                "Sales Transactions",
                "Promotional Calendar",
                "Trade Promotion Spend",
                "Audience Exposures",
              ],
              typicalSourceSystems: [
                "Marketing Platform",
                "DSP",
                "ERP",
                "Trade Promotion Management",
              ],
            },
            {
              name: "Competitive Intelligence",
              description:
                "Monitor competitor pricing, promotions, assortment, and shelf presence using web scraping, syndicated retail data, and field audits to inform strategic decisions.",
              businessValue:
                "Faster competitive response; defended share at key price-point and pack-architecture battlegrounds.",
              typicalDataEntities: [
                "Competitor Pricing",
                "Market Share Data",
                "Promotional Activity",
                "Assortment Mix",
                "Shelf Audits",
              ],
              typicalSourceSystems: [
                "Retail Data Syndication",
                "Web Scraping",
                "Third-Party Market Data",
                "Field Audit Platform",
              ],
            },
            {
              name: "Consumer Sentiment Analysis",
              description:
                "Analyse social media, reviews, and surveys to understand consumer sentiment and emerging trends -- with named-entity tagging at brand, SKU, and attribute level.",
              businessValue:
                "Earlier signal on PR risks, product issues, and emerging unmet needs; faster crisis response.",
              typicalDataEntities: [
                "Social Media Posts",
                "Product Reviews",
                "Survey Responses",
                "Brand Mentions",
                "Sentiment Scores",
              ],
              typicalSourceSystems: [
                "Social Listening Platform",
                "E-Commerce Platform",
                "Survey Tool",
                "Review Aggregators",
              ],
            },
          ],
          kpis: [
            "Brand health score",
            "Share of voice",
            "Time-to-insight",
            "Distribution velocity",
          ],
          personas: ["Chief Marketing Officer", "VP Insights", "Brand Director"],
        },
        {
          name: "Retailer Logistics",
          useCases: [
            {
              name: "Collaborative performance management",
              description:
                "Build shared scorecards with retailers and suppliers to drive Joint Business Plan outcomes -- on-shelf availability, promotional execution, share, and growth -- at banner level.",
              businessValue:
                "Aligned commercial activity with key retail partners; better promotional execution; cleaner attribution of growth drivers.",
              typicalDataEntities: [
                "Joint Business Plans",
                "Banner-Level Sales",
                "Promotional Performance",
                "On-Shelf Availability",
              ],
              typicalSourceSystems: [
                "Retail Data Syndication",
                "ERP",
                "Trade Promotion Management",
                "Customer Collaboration Portal",
              ],
            },
            {
              name: "RMN effectiveness",
              description:
                "Prove incrementality of retail-media investments and optimise placements across retailer networks using clean-room measurement and exposure-to-sale linkage.",
              businessValue:
                "Better-allocated retail-media spend; defensible incrementality numbers for trade and brand teams.",
              typicalDataEntities: [
                "Media Exposures",
                "Sales Transactions",
                "Audience Definitions",
                "Identity Graph",
                "Experiment Cells",
              ],
              typicalSourceSystems: [
                "Retail Media Platform",
                "Clean Room",
                "DSP",
                "Marketing Platform",
              ],
            },
          ],
          kpis: [
            "Brand health score",
            "Share of voice",
            "Time-to-insight",
            "Distribution velocity",
          ],
          personas: ["Chief Marketing Officer", "VP Insights", "Brand Director"],
        },
      ],
    },
    {
      name: "Improve Employee Productivity",
      whyChange:
        "Consumer-goods firms face rising labour costs and persistent talent shortages across commercial, R&D, and supply-chain teams. Productivity uplift compounds across portfolios and geographies -- a 5% efficiency gain in field merchandising or category management directly translates to margin in a low-single-digit-growth industry. AI copilots, agentic assistants, and self-service knowledge tools shrink time-to-insight and time-to-action for everyone from R&D scientists to field reps.",
      priorities: [
        {
          name: "Employee Lifecycle",
          useCases: [
            {
              name: "Candidate Screening",
              description:
                "Prioritise applicants with compliant, explainable models that score against structured competency criteria while controlling bias and meeting EEOC/equivalent obligations.",
              businessValue:
                "Lower time-to-hire; reduced unconscious bias risk through audited model scoring.",
              typicalDataEntities: [
                "Job Applications",
                "Competency Assessments",
                "Resume Parsing Output",
                "Hiring Outcomes",
              ],
              typicalSourceSystems: ["ATS", "HRIS"],
            },
            {
              name: "Workforce Scheduling & Onboarding",
              description:
                "Optimise labour to demand across plants, DCs, and field operations; automate onboarding tasks (compliance, training, system access) so new hires reach productivity faster.",
              businessValue:
                "Reduced labour cost percentage; faster new-hire ramp.",
              typicalDataEntities: [
                "Demand Forecasts",
                "Employee Availability",
                "Onboarding Checklists",
                "Roster History",
              ],
              typicalSourceSystems: [
                "Workforce Management",
                "HRIS",
                "Learning Platform",
              ],
            },
            {
              name: "Employee Self Service HR",
              description:
                "Employee-facing assistants for leave, benefits, pay, and policy Q&A grounded in HR knowledge with consent and PII controls.",
              businessValue:
                "Deflected HR ticket volume; faster resolution of routine employee questions.",
              typicalDataEntities: [
                "HR Policy Library",
                "Employee Records",
                "Benefits Catalog",
                "Ticket History",
              ],
              typicalSourceSystems: [
                "HRIS",
                "Service Management",
                "Knowledge Base",
              ],
            },
            {
              name: "Employee Lifecycle",
              description:
                "Attrition, performance, and mobility analytics across commercial, R&D, and operations functions to retain top performers and surface internal promotion fit.",
              businessValue:
                "Lower voluntary turnover among top performers; better internal mobility match-rate.",
              typicalDataEntities: [
                "Employee Records",
                "Performance Reviews",
                "Engagement Survey Results",
                "Promotion History",
              ],
              typicalSourceSystems: ["HRIS", "Performance Management", "ATS"],
            },
          ],
          kpis: ["Cycle time", "Capacity per FTE", "Voluntary turnover"],
          personas: ["Chief People Officer", "VP Operations"],
        },
        {
          name: "Employee Productivity",
          useCases: [
            {
              name: "Onboarding & knowledge management",
              description:
                "Speed time-to-productivity with tailored learning paths and SOP retrieval grounded in the company's policy and process library.",
              businessValue:
                "Faster ramp on new hires; consistent execution of operating standards across geographies.",
              typicalDataEntities: [
                "SOP Library",
                "Training Modules",
                "Compliance Records",
                "Role Definitions",
              ],
              typicalSourceSystems: [
                "Learning Platform",
                "Knowledge Base",
                "HRIS",
              ],
            },
            {
              name: "Internal knowledge agents",
              description:
                "Tool-using agents that fetch data, draft documents, and execute tasks -- pricing approvals, trade-spend templates, R&D bench reports -- with governed access to enterprise systems.",
              businessValue:
                "Time saved on rote knowledge work; faster cycle on category, R&D, and finance deliverables.",
              typicalDataEntities: [
                "Knowledge Articles",
                "Pricing Rules",
                "Product Specs",
                "Trade Spend Templates",
              ],
              typicalSourceSystems: [
                "Knowledge Base",
                "ERP",
                "PLM",
                "Trade Promotion Management",
              ],
            },
            {
              name: "AI-driven BI",
              description:
                "Natural-language BI, automated insights, and anomaly detection across commercial, supply-chain, and finance KPIs -- so a category manager can ask 'why did velocity drop in Banner X last week?' and get a grounded answer.",
              businessValue:
                "Faster decision cycles; broader analytic coverage of long-tail business questions.",
              typicalDataEntities: [
                "Sales Transactions",
                "Inventory Positions",
                "Trade Promotion Performance",
                "Finance Metrics",
              ],
              typicalSourceSystems: [
                "Data Warehouse",
                "Genie / NL2SQL",
                "BI Platform",
              ],
            },
            {
              name: "IT augmentation/automation",
              description:
                "Automate IT ops, ticket triage, data pipelines, and testing across the corporate, manufacturing, and DTC IT estate.",
              businessValue:
                "Reduced MTTR on outages; lower IT operating cost per ticket.",
              typicalDataEntities: [
                "Incident Tickets",
                "Telemetry Logs",
                "Runbooks",
                "CMDB",
              ],
              typicalSourceSystems: [
                "Service Management",
                "Observability Platform",
                "AIOps Platform",
              ],
            },
          ],
          kpis: ["Cycle time", "Capacity per FTE", "Voluntary turnover"],
          personas: ["Chief People Officer", "VP Operations"],
        },
        {
          name: "Field Operations & Knowledge Management",
          useCases: [
            {
              name: "AI-Powered Field Operations",
              description:
                "Equip field sales and merchandising teams with AI tools for route optimisation, shelf-compliance monitoring (computer vision on phone-captured shelf imagery), and automated reporting against planogram and contract standards.",
              businessValue:
                "Higher field visit effectiveness; better compliance against retailer JBP commitments; reduced admin time per rep.",
              typicalDataEntities: [
                "Visit Plans",
                "Shelf Images",
                "Planogram Definitions",
                "Order History",
                "Geo-Coordinates",
              ],
              typicalSourceSystems: [
                "Field Sales App",
                "Computer Vision Platform",
                "CRM",
                "Trade Promotion Management",
              ],
            },
            {
              name: "Knowledge Management AI",
              description:
                "Deploy AI assistants to help employees find and apply organisational knowledge quickly across departments -- product specs, regulatory documents, customer playbooks, and internal best practice.",
              businessValue:
                "Faster ramp on new hires; less time spent locating tribal knowledge; consistent answers across geographies.",
              typicalDataEntities: [
                "Knowledge Articles",
                "Product Specs",
                "Regulatory Filings",
                "Customer Playbooks",
              ],
              typicalSourceSystems: [
                "Knowledge Base",
                "PLM",
                "GRC Platform",
                "CRM",
              ],
            },
          ],
          kpis: [
            "Employee productivity index",
            "Field visit effectiveness",
            "Knowledge retrieval time",
          ],
          personas: [
            "Chief Human Resources Officer",
            "VP Field Operations",
            "Head of IT",
          ],
        },
      ],
    },
    {
      name: "Build Supply Chain Resiliency",
      whyChange:
        "Consumer-goods supply chains absorb tariff shocks, tier-1 disruptions, and demand volatility on a continuous basis. Stockouts at retailer DCs and shelves drive an estimated $1.5 trillion in lost sales annually across the industry, and 6-10% of revenue can be eroded by supply-chain failures. Multi-tier supplier risk monitoring, AI-driven demand forecasting, and digital twins of plants and DCs are becoming foundational capabilities -- not optional add-ons. ESG and Scope-3 reporting demands additional layers of supplier and product traceability that legacy ERP integrations cannot deliver.",
      priorities: [
        {
          name: "Supply Chain Risk Management",
          useCases: [
            {
              name: "Supplier Risk monitoring",
              description:
                "Monitor supplier risk across multiple tiers in real-time using financial, geopolitical, ESG, and cyber data to identify vulnerabilities before disruptions cascade into out-of-stocks at retailer DCs.",
              businessValue:
                "40% fewer supply-chain disruptions; 65% faster risk response times when alerts trigger automated playbooks.",
              typicalDataEntities: [
                "Supplier Master Data",
                "Financial Health Indicators",
                "Geopolitical Risk Index",
                "ESG Compliance Scores",
                "Cyber Threat Intel",
              ],
              typicalSourceSystems: [
                "ERP",
                "Supplier Risk Platforms",
                "Third-Party Risk Data Providers",
                "SRM",
              ],
            },
            {
              name: "Supplier Performance Scoring",
              description:
                "Score and rank suppliers on quality, delivery, cost, and sustainability metrics to optimise sourcing decisions and renegotiate with underperformers using data-backed scorecards.",
              businessValue:
                "Lower input cost; higher OTIF from tier-1 suppliers; cleaner audit trail for procurement decisions.",
              typicalDataEntities: [
                "Purchase Orders",
                "Goods Receipt Records",
                "Quality Inspections",
                "Supplier Master",
                "Sustainability Scores",
              ],
              typicalSourceSystems: ["ERP", "SRM", "Quality Management System"],
            },
            {
              name: "Product & Supplier ESG Analytics",
              description:
                "Measure and report sustainability attributes -- materials provenance, recyclability, ethical sourcing -- at product, category, and supplier level to support sustainability frameworks and UNGC/CSRD commitments.",
              businessValue:
                "Improved ESG reporting accuracy; reduced reputational risk; stronger supplier accountability against published standards.",
              typicalDataEntities: [
                "Product BOM",
                "Materials Provenance",
                "Supplier Sustainability Certifications",
                "Recyclability Attributes",
                "Scope-3 Emissions",
              ],
              typicalSourceSystems: [
                "PLM",
                "ERP",
                "Supplier Sustainability Platforms",
                "Carbon Accounting Platform",
              ],
            },
            {
              name: "Logistics & Transport Risk",
              description:
                "Predict delays, spoilage, and lane disruptions across temperature-controlled and ambient lanes; mitigate proactively by re-routing shipments before SLA breach.",
              businessValue:
                "Higher OTIF; lower expedite spend; reduced spoilage on temperature-sensitive product.",
              typicalDataEntities: [
                "Shipment Events",
                "Telematics Streams",
                "Temperature Logs",
                "Carrier Performance",
                "Weather Data",
              ],
              typicalSourceSystems: [
                "TMS",
                "Carrier APIs",
                "WMS",
                "Cold-Chain IoT",
              ],
            },
            {
              name: "Network simulation",
              description:
                "Build a digital twin for supply planning, capacity testing, and policy testing across plants, DCs, and co-pack partners -- so capex decisions are stress-tested against demand shocks.",
              businessValue:
                "Lower risk on network redesigns; better capital allocation across plant and DC investments.",
              typicalDataEntities: [
                "Plant / DC Topology",
                "Capacity Constraints",
                "Demand Forecasts",
                "Inventory Positions",
              ],
              typicalSourceSystems: [
                "Digital Twin Platform",
                "WMS",
                "ERP",
                "MES",
              ],
            },
            {
              name: "Regulatory compliance",
              description:
                "Demonstrate lawful basis, lineage, DSR fulfilment, and retention across consumer and operational data -- meeting GDPR/CCPA/CPRA, AI governance, and product-safety regulations with auditable controls.",
              businessValue:
                "Reduced regulatory exposure; faster audit cycles; demonstrable AI governance for regulators and partners.",
              typicalDataEntities: [
                "Lineage Records",
                "Consent Logs",
                "DSR Tickets",
                "Model Inventory",
                "Audit Trails",
              ],
              typicalSourceSystems: [
                "Unity Catalog",
                "Consent Management Platform",
                "Model Registry",
                "GRC Platform",
              ],
            },
          ],
          kpis: [
            "Supplier risk score",
            "Disruption response time",
            "Supplier diversification index",
            "Supplier ESG compliance rate",
          ],
          personas: [
            "Chief Supply Chain Officer",
            "VP Procurement",
            "Head of Risk Management",
          ],
        },
        {
          name: "Demand & Inventory Optimization",
          useCases: [
            {
              name: "Demand forecasting & planning",
              description:
                "Improve forecast accuracy and consensus planning using ML models that incorporate weather, events, social media, promotional calendars, and economic indicators -- delivering 30-50% higher accuracy than baseline statistical methods.",
              businessValue:
                "20-30% reduction in carrying costs; 18% reduction in stockouts at retailer DCs.",
              typicalDataEntities: [
                "Sales Transactions",
                "Inventory Levels",
                "Promotional Calendar",
                "Weather Data",
                "Economic Indicators",
              ],
              typicalSourceSystems: [
                "POS System",
                "ERP",
                "Demand Planning System",
                "Weather / Event Feeds",
              ],
            },
            {
              name: "Inventory control & optimization",
              description:
                "Set targets, safety stock, and replenishment policies to cut Out-of-Stock (OOS) and Days-on-Hand (DOH) across the supply network using AI-balanced service-level vs carrying-cost trade-offs.",
              businessValue:
                "Higher in-stock rate at lower working-capital intensity; reduced markdown burden on aged inventory.",
              typicalDataEntities: [
                "Inventory Positions",
                "Demand Forecasts",
                "Lead Times",
                "Safety Stock Parameters",
                "Replenishment Rules",
              ],
              typicalSourceSystems: [
                "ERP",
                "WMS",
                "Demand Planning System",
                "Replenishment Engine",
              ],
            },
            {
              name: "SAP Collaboration",
              description:
                "Integrate ERP signals with analytics and workflows so the planning, supply, and finance teams operate from one shared, governed view of inventory, orders, and capacity.",
              businessValue:
                "Faster cycle times across plan-to-deliver; reduced reconciliation effort between commercial and supply teams.",
              typicalDataEntities: [
                "Material Master",
                "Sales Orders",
                "Production Orders",
                "Inventory Movements",
              ],
              typicalSourceSystems: [
                "SAP ECC / S4",
                "Data Warehouse",
                "Demand Planning System",
              ],
            },
          ],
          kpis: [
            "Forecast accuracy",
            "OTIF (on-time-in-full)",
            "Service level",
            "Working capital days",
          ],
          personas: [
            "Chief Supply Chain Officer",
            "VP Procurement",
            "Head of S&OP",
          ],
        },
        {
          name: "Retailer Collaboration",
          useCases: [
            {
              name: "Supplier data sharing & collaboration",
              description:
                "Share forecasts, quality, and performance securely with suppliers via clean rooms or governed shares so suppliers can flex production and shipment plans against demand reality.",
              businessValue:
                "Higher supplier OTIF; lower expedite freight; tighter supplier-CPG alignment on promotions and innovation.",
              typicalDataEntities: [
                "Demand Forecasts",
                "Inventory Positions",
                "ASN / Shipment Events",
                "Quality Inspections",
              ],
              typicalSourceSystems: [
                "ERP",
                "EDI / VAN",
                "Clean Room",
                "Demand Planning System",
              ],
            },
            {
              name: "Data sharing & monetization",
              description:
                "Package privacy-safe insights and products for partners (retailers, distributors, agencies) with auditable contracts and consent enforcement -- opening a high-margin data revenue line.",
              businessValue:
                "New data-monetisation revenue stream; deeper retailer JBP without raw-PII exchange.",
              typicalDataEntities: [
                "Aggregated Sales",
                "Audience Definitions",
                "Promotional Performance",
                "Identity Graph",
              ],
              typicalSourceSystems: [
                "Clean Room",
                "Data Marketplace",
                "Retail Media Platform",
              ],
            },
            {
              name: "Elevate Data Sharing Alliance",
              description:
                "Establish cross-company clean-room alliance standards and operating models -- so brands, retailers, and agencies share signal at scale without bilateral integration burden.",
              businessValue:
                "Network-effect data advantages; faster onboarding of new partners into shared measurement and audience programs.",
              typicalDataEntities: [
                "Alliance Schema",
                "Shared Audiences",
                "Shared Measurement Outputs",
                "Consent Records",
              ],
              typicalSourceSystems: [
                "Clean Room",
                "Data Marketplace",
                "Identity Resolution Platform",
              ],
            },
            {
              name: "Collaborative Planning and Replenishment",
              description:
                "Enable real-time data sharing between CPGs and retailers (CPFR) for coordinated demand planning and replenishment, shrinking category-review cycles from weeks to days.",
              businessValue:
                "OTIF delivery rate uplift; collaborative forecast accuracy improvement; faster category-review cycles.",
              typicalDataEntities: [
                "Demand Forecasts",
                "Inventory Positions",
                "Purchase Orders",
                "Shipment Schedules",
              ],
              typicalSourceSystems: [
                "ERP",
                "EDI/VAN",
                "Demand Planning System",
                "Customer Collaboration Portal",
              ],
            },
          ],
          kpis: [
            "OTIF delivery rate",
            "Collaborative forecast accuracy",
            "Category growth rate",
            "Working capital days",
          ],
          personas: [
            "VP Category Management",
            "Head of Trade Marketing",
            "VP Supply Chain",
          ],
        },
      ],
    },
    {
      name: "Profitable Volume Growth",
      whyChange:
        "Disciplined pricing, promotion, and portfolio innovation unlock profitable share growth in a category-by-category battle for shelf space and consumer wallet. Net-revenue-management (NRM) capabilities -- price-pack architecture, promo guardrails, assortment optimisation -- are now the highest-ROI lever in CPG. Brands that price scientifically, prune ruthlessly, and innovate on both pack and product hold margin even as private-label pressure intensifies.",
      priorities: [
        {
          name: "Dynamic Pricing & Promotion",
          useCases: [
            {
              name: "Price analytics",
              description:
                "Measure elasticity, price thresholds, and competitive response by SKU/banner using POS-syndicated and panel data to inform list-price and net-price decisions.",
              businessValue:
                "Higher revenue per unit through scientific pricing; defended share at key price-point battlegrounds.",
              typicalDataEntities: [
                "Price History",
                "Sales Volumes",
                "Competitor Pricing",
                "Elasticity Models",
                "Margin Targets",
              ],
              typicalSourceSystems: [
                "ERP",
                "Pricing System",
                "Retail Data Syndication",
                "Panel Data Provider",
              ],
            },
            {
              name: "Promotion optimization",
              description:
                "Plan mechanics, depth, and timing to maximise lift and profit -- balancing trade-spend dollars against lift, cannibalisation, and margin impact across SKU and banner.",
              businessValue:
                "Higher promotional ROI; reduced unprofitable trade-spend allocation.",
              typicalDataEntities: [
                "Promotional Calendar",
                "Trade Promotion Spend",
                "Sales Lift",
                "Cannibalisation Matrices",
              ],
              typicalSourceSystems: [
                "Trade Promotion Management",
                "ERP",
                "Retail Data Syndication",
                "Pricing System",
              ],
            },
          ],
          kpis: [
            "Net revenue management uplift",
            "Promotion ROI",
            "New product success rate",
          ],
          personas: [
            "Chief Revenue Officer",
            "VP Trade Marketing",
            "Head of Innovation",
          ],
        },
        {
          name: "Portfolio Optimization & Innovation",
          useCases: [
            {
              name: "SKU rationalization",
              description:
                "Prune low-value SKUs while protecting revenue, shelf presence, and consumer choice -- using ML to identify substitutability and net-incremental contribution.",
              businessValue:
                "Lower complexity cost; freed working capital; cleaner shelf execution for retailer partners.",
              typicalDataEntities: [
                "SKU Master",
                "Sales Volumes",
                "Substitution Matrices",
                "Margin Contribution",
              ],
              typicalSourceSystems: ["ERP", "PLM", "Retail Data Syndication"],
            },
            {
              name: "Price pack architecture",
              description:
                "Optimise size, pack, and price ladders for margin and reach -- across channels (grocery, mass, club, convenience, e-commerce) to maximise both share-of-shelf and gross-margin contribution.",
              businessValue:
                "Higher gross margin per unit; better channel-specific pack mix.",
              typicalDataEntities: [
                "SKU Master",
                "Pack Size Definitions",
                "Channel Sales",
                "Price Ladders",
                "Margin Per Pack",
              ],
              typicalSourceSystems: ["ERP", "PLM", "Pricing System"],
            },
            {
              name: "Assortment optimization",
              description:
                "Tailor range by banner, store cluster, and shopping mission using cluster-level POS data and shopper-segment behaviour to right-size assortment per location.",
              businessValue:
                "Higher distribution velocity; reduced delisting risk at key retail partners.",
              typicalDataEntities: [
                "Banner-Level Sales",
                "Store Cluster Definitions",
                "Mission Mix",
                "Assortment Mix",
              ],
              typicalSourceSystems: [
                "Retail Data Syndication",
                "ERP",
                "Trade Promotion Management",
              ],
            },
          ],
          kpis: [
            "Net revenue management uplift",
            "Promotion ROI",
            "New product success rate",
          ],
          personas: [
            "Chief Revenue Officer",
            "VP Trade Marketing",
            "Head of Innovation",
          ],
        },
      ],
    },
  ],
};
