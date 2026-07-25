/**
 * Retail -- Industry Outcome Map
 *
 * Strategic imperatives and pillars are sourced from the Master Repository
 * XLSX (Use Case Summaries sheet). Use case names match the Master Repo
 * canonical taxonomy so `retail.enrichment.ts` lookups (keyed by lowercase
 * name) keep resolving. Rich consultant-grade prose -- description,
 * businessValue, typicalDataEntities, typicalSourceSystems -- was lifted
 * from the legacy RCG outcome map during the May 2026 registry consolidation.
 * Benchmarks, model types, KPI targets, dataAssetIds, and economic patterns
 * remain in retail.enrichment.ts.
 */

import type { IndustryOutcome } from "./index";

export const RETAIL: IndustryOutcome = {
  id: "retail",
  name: "Retail",
  subVerticals: [
    "Grocery Retail",
    "Fashion & Apparel",
    "Specialty Retail",
    "E-Commerce",
    "Multi-Brand Retail",
    "Travel & Hospitality",
  ],
  suggestedDomains: [
    "Customer Experience",
    "Merchandising",
    "Supply Chain",
    "Store Operations",
    "Marketing",
    "Loyalty",
    "Omni-Channel",
    "Retail Media",
    "Workforce",
  ],
  suggestedPriorities: [
    "Increase Revenue",
    "Reduce Cost",
    "Optimize Operations",
    "Enhance Experience",
  ],
  objectives: [
    {
      name: "Personalize & Monetize CX",
      whyChange:
        "Retail is being reshaped by digital-native commerce, omnichannel customer expectations, and the rise of retail media networks. Consumers expect Netflix-grade personalisation across web, app, and store; failing to deliver costs share-of-wallet to pure-play e-tailers. At the same time, first-party data has become the most defensible competitive asset of the decade -- privacy-safe activation through CDPs, identity graphs, and clean rooms unlocks both higher conversion and an entirely new high-margin retail-media revenue line. Retailers that treat customer data as a governed product, not a marketing exhaust, will widen the gap on incumbents that don't.",
      priorities: [
        {
          name: "Customer Data Management",
          useCases: [
            {
              name: "Customer Data Enrichment",
              description:
                "Append, infer, and normalize customer attributes across transactional, behavioural, demographic, and consent data to lift the quality of every downstream personalisation, segmentation, and analytics use case.",
              businessValue:
                "30%+ uplift in conversion through better targeting; reduced spend on third-party enrichment vendors as first-party signal coverage grows.",
              typicalDataEntities: [
                "Customer Profiles",
                "Transaction History",
                "Behavioural Events",
                "Demographic Attributes",
                "Consent Records",
              ],
              typicalSourceSystems: [
                "CDP",
                "CRM",
                "POS System",
                "E-Commerce Platform",
                "Loyalty Platform",
              ],
            },
            {
              name: "Identity Resolution",
              description:
                "Unify identifiers across devices, channels, and brands to a single person/household graph while honouring consent. Resolves cookied web sessions, app installs, loyalty cards, POS swipes, and email/SMS engagement to one canonical id.",
              businessValue:
                "15% conversion uplift and meaningful reduction in duplicated paid-media impressions; foundational for closed-loop attribution and retail-media measurement.",
              typicalDataEntities: [
                "Identity Graph",
                "Device Fingerprints",
                "Loyalty Card Events",
                "Customer Profiles",
                "Consent Records",
              ],
              typicalSourceSystems: [
                "CDP",
                "Loyalty Platform",
                "POS System",
                "E-Commerce Platform",
                "Tag Management / CMP",
              ],
            },
            {
              name: "Customer Data Management",
              description:
                "Govern, unify, and activate first-party data with auditable controls -- a group-wide CDP with cross-brand identity resolution unifying transactional, behavioural, and demographic data into a single customer view backed by lineage, consent, and DSR fulfilment.",
              businessValue:
                "10%+ operating efficiency gain across marketing and service; regulatory readiness for GDPR/CCPA/CPRA and AI governance regimes.",
              typicalDataEntities: [
                "Customer Profiles",
                "Transaction History",
                "Behavioural Events",
                "Consent & Preference Records",
                "Demographic Attributes",
              ],
              typicalSourceSystems: [
                "POS System",
                "E-Commerce Platform",
                "CRM",
                "Loyalty Platform",
                "Consent Management Platform",
              ],
            },
            {
              name: "Real-Time Personalization",
              description:
                "Deliver personalised product recommendations, offers, and content in real-time across digital and physical channels -- driven by streaming behavioural events, current cart context, and the live product catalog.",
              businessValue:
                "10-20% lift in digital conversion and average order value; meaningful reduction in cart abandonment.",
              typicalDataEntities: [
                "Customer Profiles",
                "Real-Time Behavioural Events",
                "Product Catalog",
                "Recommendation Models",
                "Inventory Positions",
              ],
              typicalSourceSystems: [
                "CDP",
                "E-Commerce Platform",
                "POS System",
                "Recommendation Engine",
              ],
            },
          ],
          kpis: [
            "Conversion rate",
            "Customer lifetime value",
            "Retail media revenue per impression",
            "Customer acquisition cost",
          ],
          personas: ["Chief Customer Officer", "VP Marketing", "VP Retail Media"],
        },
        {
          name: "Customer Insights & Activation",
          useCases: [
            {
              name: "Customer Insights",
              description:
                "Build segments, lifetime value, and journey insights across channels using ML-driven clustering, propensity modelling, and journey-stitching.",
              businessValue:
                "Higher-converting campaigns and lower CAC through segment-specific creative and offer strategies; foundational for next-best-action programs.",
              typicalDataEntities: [
                "Customer Profiles",
                "Segment Definitions",
                "LTV Scores",
                "Journey Events",
                "Engagement Metrics",
              ],
              typicalSourceSystems: [
                "CDP",
                "CRM",
                "Marketing Platform",
                "Analytics Platform",
              ],
            },
            {
              name: "Recommendation",
              description:
                "Serve next-best products and content across web, app, and email using collaborative-filtering plus session-aware deep-learning models grounded in the live catalog and inventory state.",
              businessValue:
                "5-15% revenue uplift on recommendation-attributed orders; higher units per transaction.",
              typicalDataEntities: [
                "Customer Profiles",
                "Behavioural Events",
                "Product Catalog",
                "Co-Purchase Graph",
                "Inventory Positions",
              ],
              typicalSourceSystems: [
                "E-Commerce Platform",
                "Recommendation Engine",
                "POS System",
                "CDP",
              ],
            },
            {
              name: "Activation (Content & Audience)",
              description:
                "Build and activate high-value audiences and creative variants across paid and owned channels with privacy-safe identifiers and consent enforcement.",
              businessValue:
                "Reduced wasted media spend; higher ROAS through suppression and look-alike modelling on first-party seeds.",
              typicalDataEntities: [
                "Audience Definitions",
                "Creative Variants",
                "Activation Logs",
                "Consent Records",
                "Identity Graph",
              ],
              typicalSourceSystems: [
                "CDP",
                "DSP",
                "Email Platform",
                "Marketing Platform",
              ],
            },
            {
              name: "Content Generation",
              description:
                "Generate on-brand product copy, ad creative, and channel-specific variants at scale using GenAI, then route through human review and A/B testing.",
              businessValue:
                "5-10x throughput on copy production; consistent brand voice across thousands of SKUs and locales.",
              typicalDataEntities: [
                "Product Catalog",
                "Brand Guidelines",
                "Creative Asset Library",
                "Approval Workflow",
                "A/B Test Results",
              ],
              typicalSourceSystems: [
                "DAM",
                "PIM",
                "E-Commerce Platform",
                "Marketing Platform",
              ],
            },
            {
              name: "Promotions",
              description:
                "Optimise promotional design, depth, cadence, and guardrails to protect margin -- balancing redemption rate, gross-margin impact, and cannibalisation across categories.",
              businessValue:
                "Improved promotional ROI; reduced unprofitable discount stacking through guardrail enforcement.",
              typicalDataEntities: [
                "Promotional Calendar",
                "Sales History",
                "Margin Targets",
                "Customer Segments",
                "Redemption Logs",
              ],
              typicalSourceSystems: [
                "Promotion Engine",
                "POS System",
                "ERP",
                "Marketing Platform",
              ],
            },
            {
              name: "Competitive Intelligence Analytics",
              description:
                "Monitor competitor pricing, promotions, and assortment in near real-time using web scraping, syndicated data, and ML to inform pricing, ranging, and merchandising decisions.",
              businessValue:
                "Faster reaction to competitor moves; protected price index on key value items.",
              typicalDataEntities: [
                "Competitor Pricing",
                "Market Share Data",
                "Promotional Activity",
                "Category Benchmarks",
                "Assortment Mix",
              ],
              typicalSourceSystems: [
                "Retail Data Syndication",
                "Web Scraping",
                "Third-Party Market Data",
                "Pricing System",
              ],
            },
          ],
          kpis: [
            "Conversion rate",
            "Customer lifetime value",
            "Retail media revenue per impression",
            "Customer acquisition cost",
          ],
          personas: ["Chief Customer Officer", "VP Marketing", "VP Retail Media"],
        },
        {
          name: "Loyalty & Retail Media",
          useCases: [
            {
              name: "Data sharing & clean rooms",
              description:
                "Collaborate with advertisers, suppliers, and media partners in privacy-safe clean-room environments where neither party exposes raw PII but both can run joins, attribution, and audience overlap analysis.",
              businessValue:
                "Unlocks high-margin retail-media revenue; deepens supplier joint-business plans without breaching privacy regulations.",
              typicalDataEntities: [
                "First-Party Audiences",
                "Campaign Exposures",
                "Sales Transactions",
                "Identity Graph",
                "Consent Records",
              ],
              typicalSourceSystems: [
                "Clean Room (Habu / LiveRamp / AWS)",
                "CDP",
                "Retail Media Platform",
              ],
            },
            {
              name: "Closed loop attribution",
              description:
                "Link media exposures to in-store and online sales and quantify true incrementality across channels using control groups, geo-experiments, and MMM/MTA blends.",
              businessValue:
                "Re-allocation of paid spend toward incremental channels; defensible incrementality numbers for advertiser and supplier reporting.",
              typicalDataEntities: [
                "Media Exposure Logs",
                "Sales Transactions",
                "Audience Definitions",
                "Identity Graph",
                "Experiment Cells",
              ],
              typicalSourceSystems: [
                "Retail Media Platform",
                "DSP",
                "POS System",
                "E-Commerce Platform",
                "Clean Room",
              ],
            },
            {
              name: "Loyalty Program Optimization",
              description:
                "Optimise loyalty program design, tiering, and reward economics using transaction, redemption, and segment-performance data to maximise retention and lifetime value while controlling program cost.",
              businessValue:
                "Higher retention among the high-value tier; lower cost-per-redemption through targeted offer design.",
              typicalDataEntities: [
                "Loyalty Transactions",
                "Member Profiles",
                "Redemption History",
                "Segment Performance",
                "Tier Membership",
              ],
              typicalSourceSystems: ["Loyalty Platform", "POS System", "CRM"],
            },
            {
              name: "Multi-Brand Loyalty & Offer Optimization",
              description:
                "For multi-banner retailers: design offers and benefits that optimise engagement across brands, targeting cross-banner shoppers to grow share-of-wallet and program ROI without cannibalising single-brand activity.",
              businessValue:
                "Higher cross-brand conversion, increased loyalty member spend, improved offer redemption rates.",
              typicalDataEntities: [
                "Loyalty Transactions",
                "Cross-Brand Purchase History",
                "Offer Redemptions",
                "Member Segments",
                "Banner Affinity Scores",
              ],
              typicalSourceSystems: [
                "Loyalty Platform",
                "POS System",
                "E-Commerce Platform",
                "CDP",
              ],
            },
          ],
          kpis: [
            "Retail media revenue per impression",
            "Loyalty program ROI",
            "Closed-loop incrementality lift",
            "Cross-brand engagement rate",
          ],
          personas: [
            "VP Retail Media",
            "Head of Loyalty",
            "Chief Marketing Officer",
            "Head of CRM",
          ],
        },
      ],
    },
    {
      name: "Improve Employee Productivity",
      whyChange:
        "Retailers operate the largest frontline workforce of any industry: a 1% lift in associate productivity per shift compounds across thousands of stores and tens of thousands of associates. Wage inflation, persistent skills shortages, and rising scheduling complexity (omnichannel fulfilment, click-and-collect, ship-from-store) make AI-driven workforce optimisation table stakes. Internal copilots and natural-language BI shrink the gap between question and answer for store managers and category buyers, while automated onboarding and self-service HR remove friction from the highest-turnover roles in the business.",
      priorities: [
        {
          name: "Employee Lifecycle",
          useCases: [
            {
              name: "Candidate Screening",
              description:
                "Screen retail applicants with compliant, explainable models that score against structured competency criteria and fairness constraints.",
              businessValue:
                "Lower time-to-hire; reduced unconscious bias risk through audited, model-based scoring.",
              typicalDataEntities: [
                "Job Applications",
                "Competency Assessments",
                "Resume Parsing Output",
                "Hiring Outcomes",
              ],
              typicalSourceSystems: [
                "ATS",
                "HRIS",
                "Workforce Management",
              ],
            },
            {
              name: "Workforce Scheduling & Onboarding",
              description:
                "Optimise associate staffing against forecast demand and streamline onboarding tasks (compliance training, system access, store-walk checklists) so new hires reach productivity faster.",
              businessValue:
                "Reduced labour cost percentage of sales; faster ramp on new hires.",
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
                "Conversational self-service for HR policies, benefits, leave, pay, and document requests using a governed LLM grounded in HR knowledge.",
              businessValue:
                "Deflects HR ticket volume; faster resolution of routine employee questions.",
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
                "Predict attrition, promotion-readiness, and develop career paths with longitudinal employee data, performance reviews, and engagement signals.",
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
          kpis: ["Time-to-hire", "Voluntary turnover", "Tickets per associate"],
          personas: ["Chief People Officer", "VP Store Operations"],
        },
        {
          name: "Employee Productivity",
          useCases: [
            {
              name: "Onboarding & knowledge mgmt",
              description:
                "Centralise SOPs, planograms, and policy docs and surface them via just-in-time guidance to new hires and seasonal associates.",
              businessValue:
                "Faster time-to-productivity on new hires; consistent execution of operating standards.",
              typicalDataEntities: [
                "SOP Library",
                "Planogram Definitions",
                "Compliance Records",
                "Training Completion",
              ],
              typicalSourceSystems: [
                "Knowledge Base",
                "Learning Platform",
                "Store Operations App",
              ],
            },
            {
              name: "Internal knowledge agents",
              description:
                "Agentic assistants that search, summarise, and action internal knowledge -- pricing rules, product availability, return policies, escalation paths -- for store associates and corporate buyers.",
              businessValue:
                "Faster issue resolution at the shelf; corporate productivity gains across category and operations teams.",
              typicalDataEntities: [
                "SOP Library",
                "Pricing Rules",
                "Product Catalog",
                "Return Policies",
                "Inventory Positions",
              ],
              typicalSourceSystems: [
                "Knowledge Base",
                "ERP",
                "Merchandising System",
                "POS System",
              ],
            },
            {
              name: "AI-driven BI",
              description:
                "Natural-language BI plus automated insight generation spanning sales, inventory, marketing, and operations -- so a regional manager can ask 'why is shrink up at store 412?' and get a grounded answer.",
              businessValue:
                "Faster decision cycles; higher analytic coverage across the long-tail of business questions.",
              typicalDataEntities: [
                "Sales Transactions",
                "Inventory Positions",
                "Marketing Campaign Performance",
                "Store Operations Metrics",
              ],
              typicalSourceSystems: [
                "Data Warehouse",
                "Genie / NL2SQL",
                "BI Platform",
              ],
            },
            {
              name: "IT augmentation / automation",
              description:
                "AIOps and copilots for incident triage, root-cause analysis, runbook automation, and ticket deflection across the store, e-commerce, and corporate IT estate.",
              businessValue:
                "Reduced MTTR on store/e-commerce outages; lower IT operating cost per ticket.",
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
          kpis: ["Time-to-decision", "Tickets per associate", "MTTR"],
          personas: ["Chief People Officer", "VP Store Operations", "VP IT"],
        },
        {
          name: "Store Operations & Workforce Optimization",
          useCases: [
            {
              name: "Store Labour Forecasting & Rostering",
              description:
                "Forecast and optimise store staffing using foot traffic, sales patterns, seasonality, local events, and promotional calendars to keep labour cost as a percent of sales in line while protecting service levels.",
              businessValue:
                "5-10% reduction in labour cost as a percentage of sales; improved roster accuracy and associate satisfaction.",
              typicalDataEntities: [
                "Foot Traffic",
                "Sales History",
                "Promotional Calendar",
                "Employee Availability",
                "Local Event Calendars",
              ],
              typicalSourceSystems: [
                "POS System",
                "Workforce Management",
                "Store Traffic Sensors",
                "Weather / Event Feeds",
              ],
            },
            {
              name: "In-Store Execution Analytics",
              description:
                "Monitor planogram compliance, click-and-collect pick efficiency, and service queue wait times using shelf imagery, OMS events, and queue sensors to drive consistent execution across the store network.",
              businessValue:
                "Higher on-shelf availability; faster click-and-collect cycle times; lower lost sales from execution gaps.",
              typicalDataEntities: [
                "Planogram Definitions",
                "Shelf Images",
                "Pick Times",
                "Queue Metrics",
                "Service SLAs",
              ],
              typicalSourceSystems: [
                "Merchandising System",
                "OMS",
                "Store Operations App",
                "Computer Vision Platform",
              ],
            },
          ],
          kpis: [
            "Labour cost as % of sales",
            "Roster accuracy",
            "Click-and-collect pick efficiency",
            "On-shelf availability",
          ],
          personas: [
            "Head of Retail Operations",
            "Regional Manager",
            "Workforce Planning Manager",
          ],
        },
      ],
    },
    {
      name: "Build Supply Chain Resiliency",
      whyChange:
        "Stockouts, excess inventory, and supplier disruptions destroy retail margin in equal measure -- the industry loses an estimated $1.5 trillion annually to stockouts alone, and 6-10% of revenue can be eroded by supply-chain failures across a typical retailer's planning cycle. Resilient supplier networks, AI-driven demand forecasting, and digital twins of stores/DCs protect both revenue and ESG commitments. Retailers that invest in joint forecasting (CPFR), real-time inventory visibility, and omnichannel order routing turn the supply chain from a cost centre into a competitive moat.",
      priorities: [
        {
          name: "Supply Chain Risk Management",
          useCases: [
            {
              name: "Supplier Risk monitoring",
              description:
                "Monitor multi-tier supplier risk in real-time across financial, geopolitical, ESG, and cyber dimensions using third-party feeds plus internal performance signals to flag vulnerabilities before they cascade into stockouts.",
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
              name: "Logistics & Transport Risk",
              description:
                "Predict ETAs, lane disruptions, and delivery exceptions across middle-mile and last-mile networks using telematics, weather, traffic, and historical OTIF data to enable proactive mitigation.",
              businessValue:
                "Higher OTIF; lower expedite spend; improved customer delivery promise accuracy.",
              typicalDataEntities: [
                "Shipment Events",
                "Telematics Streams",
                "Weather Data",
                "Carrier Performance",
                "OTIF History",
              ],
              typicalSourceSystems: [
                "TMS",
                "Carrier APIs",
                "WMS",
                "Weather / Traffic Feeds",
              ],
            },
            {
              name: "Network simulation",
              description:
                "Build a digital twin of stores, DCs, and fulfilment nodes to simulate layouts, inventory placement, and order-flow policies under demand shocks before committing capex.",
              businessValue:
                "Lower risk on network redesigns; better capital allocation across DC and store-network investments.",
              typicalDataEntities: [
                "Store / DC Topology",
                "Inventory Positions",
                "Order Events",
                "Capacity Constraints",
                "Demand Forecasts",
              ],
              typicalSourceSystems: [
                "Digital Twin Platform",
                "WMS",
                "OMS",
                "ERP",
              ],
            },
            {
              name: "Regulatory compliance",
              description:
                "Enforce GDPR/PCI/CPRA, AI governance, and product-safety regulations across the data and AI lifecycle with auditable lineage, consent enforcement, and DSR fulfilment.",
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
            "Stockout rate",
            "Inventory turn",
            "Forecast accuracy",
            "Supplier on-time-in-full",
          ],
          personas: [
            "Chief Supply Chain Officer",
            "VP Merchandising",
            "VP Procurement",
          ],
        },
        {
          name: "Demand & Inventory Optimization",
          useCases: [
            {
              name: "Demand forecasting & planning",
              description:
                "Forecast SKU-by-location demand using ML models that ingest weather, events, social media, promotional calendars, and economic indicators -- delivering 30-50% higher accuracy than baseline statistical methods.",
              businessValue:
                "20-30% reduction in carrying costs; 18% reduction in stockouts; enables consensus planning across merchandising, supply chain, and finance.",
              typicalDataEntities: [
                "Sales Transactions",
                "Inventory Levels",
                "Promotional Calendar",
                "Weather Data",
                "Local Event Calendars",
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
                "Optimise inventory levels across the supply network -- safety stock, replenishment cycles, and placement -- using AI to balance service levels with carrying costs across DCs, stores, and fulfilment nodes.",
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
              name: "Markdown and Pricing Optimization",
              description:
                "Optimise markdown timing and pricing strategies across multi-channel promotional calendars and gross-margin targets for distinct retail formats, maximising revenue recovery on slow-moving inventory.",
              businessValue:
                "Higher margin recovery on aged stock; lower end-of-life write-offs.",
              typicalDataEntities: [
                "Inventory Positions",
                "Sales History",
                "Promotional Calendar",
                "Margin Targets",
                "Competitor Pricing",
              ],
              typicalSourceSystems: [
                "ERP",
                "POS System",
                "Merchandising System",
                "Pricing System",
              ],
            },
            {
              name: "Category & Pricing Architecture Analytics",
              description:
                "Identify Key Value Items, analyse traffic drivers and cross-seller relationships, and measure promotional effectiveness across categories and brands to inform assortment and pricing decisions.",
              businessValue:
                "Improved promotional ROI; better category margin mix; reduced cannibalisation across brand and price tiers.",
              typicalDataEntities: [
                "Category Sales",
                "Product Assortment",
                "Promotional Events",
                "Cross-Sell Matrices",
                "Price Indices",
              ],
              typicalSourceSystems: [
                "POS System",
                "ERP",
                "Merchandising System",
                "Pricing System",
              ],
            },
          ],
          kpis: [
            "Forecast accuracy",
            "Inventory turn",
            "Stockout rate",
            "Markdown rate",
          ],
          personas: [
            "VP Demand Planning",
            "Head of Merchandising",
            "Chief Supply Chain Officer",
          ],
        },
        {
          name: "Supplier Collaboration",
          useCases: [
            {
              name: "Supplier data sharing & collaboration",
              description:
                "Share forecasts, ASN/quality, and replenishment plans securely with vendors via clean rooms or governed shares so suppliers can flex production and shipment plans against demand reality.",
              businessValue:
                "Higher supplier OTIF; lower expedite freight; tighter supplier-retailer alignment on promotions.",
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
                "Package privacy-safe first-party insights for partners and retail-media networks under contractual controls, opening a high-margin data revenue line.",
              businessValue:
                "New data-monetisation revenue stream; deeper supplier joint-business plans without raw-PII exchange.",
              typicalDataEntities: [
                "Aggregated Sales",
                "Audience Definitions",
                "Promotional Performance",
                "Identity Graph",
              ],
              typicalSourceSystems: [
                "Clean Room",
                "Retail Media Platform",
                "Data Marketplace",
              ],
            },
            {
              name: "Supplier Collaborative Planning",
              description:
                "Enable real-time data sharing between retailers and suppliers for coordinated demand planning and replenishment (CPFR), shrinking category review cycles from weeks to hours.",
              businessValue:
                "72-hour category review cycles versus six weeks with manual methods; reduced stockouts and lower cost-to-serve.",
              typicalDataEntities: [
                "Demand Forecasts",
                "Inventory Positions",
                "Purchase Orders",
                "Shipment Schedules",
                "Joint Business Plans",
              ],
              typicalSourceSystems: [
                "ERP",
                "EDI / VAN",
                "Demand Planning System",
                "Supplier Collaboration Portal",
              ],
            },
            {
              name: "Category Performance Analytics",
              description:
                "Analyse category performance collaboratively with trading partners to optimise assortment, pricing, and promotions using shared scorecards and benchmark data.",
              businessValue:
                "Faster category resets; better margin mix; aligned trade-spend allocation between retailer and supplier.",
              typicalDataEntities: [
                "Category Sales",
                "Market Share",
                "Assortment Mix",
                "Promotional Performance",
              ],
              typicalSourceSystems: [
                "POS System",
                "Retail Data Syndication",
                "ERP",
              ],
            },
          ],
          kpis: [
            "Stockout rate",
            "Inventory turn",
            "Forecast accuracy",
            "Supplier on-time-in-full",
            "Category review cycle time",
          ],
          personas: [
            "Chief Supply Chain Officer",
            "VP Merchandising",
            "VP Procurement",
            "VP Category Management",
          ],
        },
        {
          name: "Omni-Channel Fulfilment Optimization",
          useCases: [
            {
              name: "Unified Inventory Visibility & Order Routing",
              description:
                "Optimise order routing across DCs, stores, ship-from-store, and click-and-collect channels using real-time inventory positions, store capacity, and delivery-zone constraints to minimise fulfilment cost and meet promise times.",
              businessValue:
                "15-25% reduction in fulfilment cost; improved on-time delivery rates and lower split-shipment incidence.",
              typicalDataEntities: [
                "Inventory Positions",
                "Order Events",
                "Store Capacity",
                "Delivery Zones",
                "Promise-Time Models",
              ],
              typicalSourceSystems: [
                "WMS",
                "OMS",
                "Store Inventory System",
                "Carrier APIs",
              ],
            },
            {
              name: "DC-to-Store Replenishment Optimization",
              description:
                "Optimise slotting and DC-to-store replenishment cycles for promotional and seasonal peaks (Black Friday, Christmas, key sporting seasons) so peak demand is met without excess on-hand at troughs.",
              businessValue:
                "Lower peak-period stockout incidence; reduced post-peak inventory overhang and markdowns.",
              typicalDataEntities: [
                "Demand Forecasts",
                "DC Inventory",
                "Store Sales",
                "Promotional Calendar",
                "Slotting Definitions",
              ],
              typicalSourceSystems: [
                "WMS",
                "ERP",
                "Demand Planning System",
                "Replenishment Engine",
              ],
            },
          ],
          kpis: [
            "Fulfilment cost per order",
            "Click-and-collect SLA attainment",
            "Ship-from-store utilisation",
            "Order promise accuracy",
          ],
          personas: [
            "Head of Omni Fulfilment",
            "GM DC Operations",
            "Head of Transport",
          ],
        },
      ],
    },
  ],
};
