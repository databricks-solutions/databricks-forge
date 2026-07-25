import type { IndustryOutcome } from "./index";

export const AUTOMOTIVE_MOBILITY: IndustryOutcome = {
  id: "automotive-mobility",
  name: "Automotive & Mobility",
  subVerticals: [
    "OEMs & Vehicle Manufacturers",
    "Importers & Distributors",
    "Dealer Groups & Retail",
    "Fleet & Leasing",
    "Mobility Services (Car Share, Subscription)",
    "Aftermarket & Service",
    "Used Vehicle Superstores & Independents",
  ],
  suggestedDomains: [
    "Sales & Marketing",
    "Retail Operations",
    "Aftersales & Service",
    "Connected Vehicle & Telematics",
    "Supply Chain & Manufacturing",
    "Finance & Risk",
    "Customer Experience",
    "Workforce & People",
    "Used Vehicle Operations",
  ],
  suggestedPriorities: [
    "Increase Revenue",
    "Enhance Customer Experience",
    "Optimize Retail Operations",
    "Grow Aftersales Profitability",
    "Accelerate Digital & Direct-to-Consumer",
    "Improve Asset Utilization",
    "Achieve ESG Targets",
    "Drive Operational Excellence",
    "Scale Multi-Franchise Operations",
  ],
  objectives: [
    {
      name: "Transform Retail & Omnichannel Sales",
      whyChange:
        "Vehicle sales are shifting online faster than most OEMs and dealer groups anticipated. Customers now research, configure, and finance vehicles digitally before visiting a showroom — if they visit at all. Agency and direct-to-consumer models are reshaping the OEM–dealer relationship, compressing margins and demanding seamless omnichannel journeys. Retailers that cannot unify online and in-store experiences risk losing buyers to competitors or new entrants who can.",
      priorities: [
        {
          name: "Omnichannel Retail & E-Commerce",
          useCases: [
            {
              name: "Digital Retail & Self-Serve Purchase Journeys",
              description:
                "Enable end-to-end online vehicle purchase including build-and-price configuration, finance pre-approval, trade-in valuation, and delivery scheduling. The platform unifies data from CRM, DMS, and inventory systems so the customer can start online and complete in-store — or vice versa — without losing context.",
              businessValue:
                "15–25% increase in online sales penetration; 30% reduction in showroom transaction time.",
            },
            {
              name: "Online-to-Offline Handoff Tracking",
              description:
                "Track every customer interaction across web, app, call centre, and showroom into a single journey timeline. Sales teams see exactly where a prospect dropped off online so they can resume the conversation without repetition.",
              businessValue:
                "10–15% improvement in lead-to-sale conversion through reduced journey friction.",
            },
            {
              name: "Dynamic Vehicle Pricing & Incentive Optimization",
              description:
                "Apply ML models to real-time inventory age, regional demand signals, competitor pricing, and OEM incentive programmes to recommend optimal transaction prices and discount allocation at a VIN level.",
              businessValue: "1–3% improvement in front-end gross margin per vehicle retailed.",
            },
            {
              name: "Trade-In Valuation & Instant Offer Engine",
              description:
                "Use auction data, condition-adjusted book values, and local demand models to generate accurate, real-time trade-in offers customers can receive online before visiting the dealership, increasing appraisal transparency and trust.",
              businessValue:
                "20% increase in trade-in capture rate; reduced customer negotiation time.",
            },
            {
              name: "Conversational AI & Virtual Sales Assistants",
              description:
                "Deploy AI-powered chatbots, SMS/WhatsApp commerce, and voice assistants that handle inventory inquiries, financing questions, appointment scheduling, and lead qualification 24/7. Complex interactions are seamlessly escalated to human sales consultants with full conversation context, ensuring no lead is lost outside business hours.",
              businessValue:
                "20–30% improvement in lead response time; 15–25% increase in after-hours lead capture.",
              typicalDataEntities: [
                "Inventory",
                "CRM Profiles",
                "Finance Products",
                "Appointment Calendar",
              ],
              typicalSourceSystems: ["DMS", "CRM", "Chat Platform", "Telephony"],
            },
          ],
          kpis: [
            "Online sales penetration (%)",
            "Lead-to-sale conversion rate",
            "Average days to sell (new & used)",
            "Front-end gross profit per unit",
            "Digital journey completion rate",
          ],
          personas: [
            "Chief Commercial Officer",
            "Head of Retail Operations",
            "Dealer Principal",
            "Head of Digital Sales",
            "eCommerce Director",
          ],
        },
        {
          name: "Lead & Demand Management",
          useCases: [
            {
              name: "AI-Powered Lead Scoring & Routing",
              description:
                "Score inbound leads in real time using behavioural signals (web activity, configurator usage, finance calculator engagement) and route them to the best-matched sales consultant or digital channel, reducing response time and improving close rates.",
              businessValue:
                "20–30% improvement in lead response time; 10–15% uplift in conversion rate.",
            },
            {
              name: "Demand Sensing & Model-Mix Forecasting",
              description:
                "Combine order-bank data, web traffic, macro-economic indicators, and regional preference trends to forecast demand by model, derivative, and colour at a dealer or market level, feeding production planning and allocation decisions.",
              businessValue:
                "15–20% improvement in forecast accuracy; reduced stock imbalance across the network.",
            },
            {
              name: "Conquest & Retention Campaign Targeting",
              description:
                "Build lookalike and propensity models that identify high-value conquest prospects from competitor brands and score existing customers by predicted in-market probability within 30–90 days using vehicle age, mileage trajectory, equity position, service visit frequency, and digital engagement signals. Generate predictive vehicle recommendations (make/model/trim) for highest-propensity prospects and trigger precision marketing campaigns timed to individual purchase readiness.",
              businessValue:
                "30–40% improvement in marketing ROI; industry leaders achieve 80% accuracy predicting next vehicle purchase make/model/trim.",
              typicalDataEntities: [
                "Customer Purchase History",
                "Vehicle Age & Mileage",
                "Equity Position",
                "Service Visit Frequency",
                "Digital Engagement Signals",
              ],
              typicalSourceSystems: ["CDP", "CRM", "DMS", "Marketing Platform", "Web Analytics"],
            },
            {
              name: "Customer Data Platform & Unified Customer 360",
              description:
                "Consolidate identity resolution, transactional, behavioural, and demographic data from every dealership, brand, and channel into a single customer profile. Enable cross-brand engagement, equity position tracking, and lifecycle stage classification for 360-degree customer visibility that powers personalisation, retention, and conquest strategies across the entire network.",
              businessValue:
                "15–25% increase in customer lifetime value; 20–30% improvement in marketing efficiency through targeted vs. mass campaigns.",
              typicalDataEntities: [
                "Customer Profiles",
                "Transaction History",
                "Behavioural Events",
                "Identity Graph",
                "Vehicle Ownership",
              ],
              typicalSourceSystems: [
                "DMS",
                "CRM",
                "CDP",
                "E-Commerce Platform",
                "Marketing Platform",
                "Service Scheduling",
              ],
            },
          ],
          kpis: [
            "Lead response time (minutes)",
            "Lead-to-appointment rate",
            "Marketing cost per sale",
            "Demand forecast accuracy (%)",
            "Conquest-to-total sales ratio",
            "Customer 360 profile completeness (%)",
            "In-market prediction accuracy (%)",
          ],
          personas: [
            "Chief Marketing Officer",
            "Head of Sales Performance",
            "Regional Sales Director",
            "CRM Manager",
            "Head of Customer Data",
          ],
        },
        {
          name: "F&I Optimization",
          useCases: [
            {
              name: "Personalised Finance & Insurance Product Recommendation",
              description:
                "Use customer credit profile, vehicle selection, and behavioural data to recommend the optimal F&I product bundle (finance plan, GAP, service plan, tyre-and-rim) at the right moment in the purchase journey, whether online or in the business office.",
              businessValue:
                "10–20% increase in F&I income per unit; higher product penetration rates.",
              typicalDataEntities: [
                "Credit Profile",
                "Vehicle Selection",
                "F&I Product Catalog",
                "Penetration History",
              ],
              typicalSourceSystems: ["DMS", "F&I Platform", "Credit Bureau", "CRM"],
            },
            {
              name: "Credit Risk Pre-Qualification & Decisioning",
              description:
                "Integrate credit bureau data and internal payment history to pre-qualify customers for financing before they arrive at the dealership, reducing deal fallout and accelerating the approval cycle.",
              businessValue:
                "25–35% reduction in finance approval cycle time; lower deal cancellation rate.",
              typicalDataEntities: [
                "Credit Bureau Data",
                "Payment History",
                "Pre-Qualification Results",
                "Approval Workflow",
              ],
              typicalSourceSystems: ["Credit Bureau", "F&I Platform", "DMS", "Finance Company"],
            },
            {
              name: "F&I Compliance Monitoring",
              description:
                "Automatically audit every F&I transaction for regulatory compliance — rate mark-up limits, disclosure requirements, and fair-lending rules — flagging exceptions in real time to reduce legal and reputational risk.",
              businessValue:
                "Significant reduction in compliance-related fines and audit remediation costs.",
              typicalDataEntities: [
                "F&I Transactions",
                "Compliance Rules",
                "Audit Exceptions",
                "Disclosure Records",
              ],
              typicalSourceSystems: [
                "F&I Platform",
                "DMS",
                "Compliance System",
                "Regulatory Database",
              ],
            },
          ],
          kpis: [
            "F&I income per vehicle retailed",
            "Finance penetration rate (%)",
            "Product penetration rate (service plans, GAP, etc.)",
            "Deal cancellation / fallout rate",
            "Compliance exception rate",
          ],
          personas: [
            "Head of Financial Services",
            "F&I Director",
            "Dealer Principal",
            "Chief Risk Officer",
          ],
        },
      ],
    },
    {
      name: "Grow Aftersales & Lifetime Value",
      whyChange:
        "Aftersales contributes the majority of dealer group profits yet faces pressure from independent workshops, online parts retailers, and longer vehicle service intervals. At the same time, the shift to EVs reduces traditional service revenue streams (oil changes, exhaust, transmission). Growing lifetime value requires optimising service throughput, expanding accessory and parts revenue, and proactively managing warranty and recall processes.",
      priorities: [
        {
          name: "Service Lane Optimization",
          useCases: [
            {
              name: "Predictive Service Booking & Capacity Planning",
              description:
                "Forecast service demand by day, bay type, and technician skill using historical RO data, seasonal patterns, and connected-vehicle alerts to optimise appointment scheduling and reduce idle capacity.",
              businessValue:
                "10–15% improvement in service bay utilization; reduced customer wait times.",
              typicalDataEntities: [
                "Repair Order History",
                "Bay Capacity",
                "Technician Skills",
                "Connected Vehicle Alerts",
              ],
              typicalSourceSystems: [
                "DMS",
                "Service Scheduling",
                "Connected Vehicle Platform",
                "CRM",
              ],
            },
            {
              name: "Digital Check-In & Vehicle Health Inspection",
              description:
                "Enable customers to check in via mobile, pre-approve estimated work, and receive a digital multi-point inspection report with photos and video. Technicians use tablet-based workflows that auto-populate findings into the DMS.",
              businessValue:
                "20–30% increase in service upsell acceptance rate; improved CSI scores.",
            },
            {
              name: "Technician Productivity & Skill-Based Routing",
              description:
                "Match repair orders to technicians based on certification, proficiency, and current workload, while tracking effective labour rate and hours-per-RO to identify coaching opportunities.",
              businessValue:
                "5–10% increase in effective labour rate; improved technician retention.",
              typicalDataEntities: [
                "Technician Certifications",
                "Repair Order Complexity",
                "Workload",
                "Labour Metrics",
              ],
              typicalSourceSystems: ["DMS", "HR System", "Service Scheduling", "Training Platform"],
            },
            {
              name: "Service Retention & Lifecycle Marketing",
              description:
                "Trigger personalised service reminders and offers based on vehicle age, mileage, warranty expiry, and past service history to retain customers beyond the warranty period and win back lapsed service customers.",
              businessValue: "8–12% improvement in service retention rate beyond year three.",
              typicalDataEntities: ["Vehicle Age", "Mileage", "Warranty Status", "Service History"],
              typicalSourceSystems: ["DMS", "CRM", "Marketing Platform", "Warranty System"],
            },
            {
              name: "Service Loyalty & Prepaid Maintenance Plans",
              description:
                "Operate points-based loyalty programmes incentivising service frequency, referrals, and repurchase behaviour. Offer prepaid maintenance packages with transparent pricing that compete against independent workshops on value while guaranteeing OEM-quality parts and certified technicians, targeting the critical post-warranty retention window.",
              businessValue:
                "8–12% improvement in post-warranty retention rate; 5–10% increase in customer repurchase likelihood.",
              typicalDataEntities: [
                "Loyalty Accounts",
                "Points Balances",
                "Prepaid Plan Enrolments",
                "Redemption History",
                "Competitive Pricing",
              ],
              typicalSourceSystems: ["Loyalty Platform", "DMS", "CRM", "Marketing Platform"],
            },
          ],
          kpis: [
            "Service retention rate (%)",
            "Hours per repair order",
            "Service bay utilization (%)",
            "Customer satisfaction index (CSI) — service",
            "Effective labour rate",
            "Loyalty programme active membership (%)",
            "Prepaid plan penetration rate (%)",
          ],
          personas: [
            "Head of Aftersales",
            "Service Manager",
            "Dealer Principal",
            "Customer Experience Director",
          ],
        },
        {
          name: "Parts & Accessories Revenue",
          useCases: [
            {
              name: "Parts Demand Forecasting & Inventory Optimization",
              description:
                "Use historical consumption, VIN parc data, seasonal trends, and service booking forecasts to set optimal stocking levels at each location, minimising lost sales from stock-outs while reducing obsolescence.",
              businessValue:
                "15–20% reduction in parts inventory carrying cost; 10% improvement in fill rate.",
              typicalDataEntities: [
                "Consumption History",
                "VIN Parc Data",
                "Service Forecasts",
                "Inventory Levels",
              ],
              typicalSourceSystems: ["Parts System", "DMS", "OEM Parts Catalog", "ERP"],
            },
            {
              name: "Accessory Attachment & Bundling at Point of Sale",
              description:
                "Recommend accessories and protection products at vehicle handover using a propensity model trained on past attachment rates by model, trim, and customer segment, presenting bundles through the sales or online configurator workflow.",
              businessValue: "20–30% increase in accessory revenue per vehicle sold.",
              typicalDataEntities: [
                "Accessory Catalog",
                "Attachment Rates",
                "Model Trim Data",
                "Customer Segments",
              ],
              typicalSourceSystems: ["DMS", "Configurator", "Parts System", "CRM"],
            },
            {
              name: "Competitive Parts Pricing Intelligence",
              description:
                "Monitor aftermarket and online competitor pricing for high-volume part numbers, enabling dynamic price adjustments that protect margin while remaining competitive against independent alternatives.",
              businessValue:
                "3–5% improvement in parts gross margin while maintaining market share.",
              typicalDataEntities: [
                "Part Numbers",
                "Competitor Prices",
                "Cost Data",
                "Margin Targets",
              ],
              typicalSourceSystems: [
                "Parts System",
                "Pricing Intelligence",
                "ERP",
                "Competitor Scraping",
              ],
            },
          ],
          kpis: [
            "Accessory penetration per vehicle sold",
            "Parts gross margin (%)",
            "Parts fill rate / first-pick availability (%)",
            "Inventory days of supply",
            "Obsolescence write-off as % of parts revenue",
          ],
          personas: [
            "Parts Director",
            "Head of Aftersales",
            "Supply Chain Manager",
            "Dealer Principal",
          ],
        },
        {
          name: "Warranty & Recall Management",
          useCases: [
            {
              name: "Warranty Claims Analytics & Fraud Detection",
              description:
                "Analyse warranty claim patterns across the dealer network to identify anomalous claim rates, repeat repairs, and potential fraud, enabling targeted audits and reducing warranty cost leakage.",
              businessValue:
                "5–10% reduction in warranty cost per vehicle; faster audit resolution.",
              typicalDataEntities: [
                "Warranty Claims",
                "Claim Patterns",
                "Repeat Repairs",
                "Dealer Metrics",
              ],
              typicalSourceSystems: ["Warranty System", "DMS", "OEM Portal", "ERP"],
            },
            {
              name: "Early Warning Quality Feedback Loop",
              description:
                "Aggregate field failure data, connected-vehicle DTCs, and customer complaint text to detect emerging quality issues weeks before they trigger formal recalls, enabling proactive containment and engineering fixes.",
              businessValue: "30–50% faster defect detection; reduced recall scope and cost.",
              typicalDataEntities: [
                "Field Failures",
                "DTC Codes",
                "Complaint Text",
                "Component History",
              ],
              typicalSourceSystems: [
                "Connected Vehicle Platform",
                "Warranty System",
                "CRM",
                "Quality System",
              ],
            },
            {
              name: "Recall Completion Rate Optimization",
              description:
                "Use owner contact data, vehicle location, and communication preference models to maximise recall completion rates through targeted outreach campaigns across mail, email, SMS, and app notifications.",
              businessValue:
                "10–20% improvement in recall completion rate; reduced regulatory exposure.",
              typicalDataEntities: [
                "Owner Contact Data",
                "Vehicle Location",
                "Communication Preferences",
                "Recall Status",
              ],
              typicalSourceSystems: ["CRM", "DMS", "Recall System", "Marketing Platform"],
            },
          ],
          kpis: [
            "Warranty cost per vehicle",
            "Claim rejection / adjustment rate (%)",
            "Recall completion rate (%)",
            "Time from defect detection to field action (days)",
            "Repeat repair rate (%)",
          ],
          personas: [
            "Head of Quality",
            "Warranty Manager",
            "VP Aftersales",
            "Chief Safety Officer",
          ],
        },
        {
          name: "Fixed Operations Analytics",
          useCases: [
            {
              name: "Fixed Absorption & Departmental Profitability Tracking",
              description:
                "Calculate and monitor fixed absorption rate — the ratio of parts and service gross profit to total fixed operating expenses — in real time across every location. Benchmark each dealership against industry targets (45–50%) and flag sites requiring intervention, enabling leadership to prioritise improvement actions where profit impact is greatest.",
              businessValue:
                "3–5 percentage point improvement in fixed absorption rate; earlier identification of underperforming locations.",
              typicalDataEntities: [
                "Parts Gross Profit",
                "Service Gross Profit",
                "Fixed Operating Expenses",
                "Departmental P&L",
              ],
              typicalSourceSystems: ["DMS", "ERP", "Financial System"],
            },
            {
              name: "Labour Rate Realisation & Technician Efficiency Analytics",
              description:
                "Compare quoted versus billed hours, track effective labour rate, unapplied time, and comeback rates by individual technician. Identify coaching opportunities, top-performer patterns, and scheduling inefficiencies that erode labour productivity across the service network.",
              businessValue:
                "2–3 percentage point improvement in labour rate realisation; 5% reduction in unapplied time as cost of sales.",
              typicalDataEntities: [
                "Quoted Hours",
                "Billed Hours",
                "Effective Labour Rate",
                "Unapplied Time",
                "Comeback Records",
              ],
              typicalSourceSystems: ["DMS", "Service Scheduling", "HR System"],
            },
            {
              name: "Service Mix & Revenue Optimisation",
              description:
                "Analyse service type distribution (maintenance, warranty, internal, customer-pay) across each location to identify margin improvement opportunities. Recommend menu pricing adjustments, upsell strategies, and high-margin service promotions that shift the revenue mix toward more profitable work categories.",
              businessValue:
                "10% shift toward high-margin service categories; $3–4M incremental gross profit for a large dealer network.",
              typicalDataEntities: [
                "Service Type Distribution",
                "Margin by Category",
                "Menu Pricing",
                "Upsell Conversion Rates",
              ],
              typicalSourceSystems: ["DMS", "Service Scheduling", "Financial System"],
            },
          ],
          kpis: [
            "Fixed absorption rate (%)",
            "Effective labour rate",
            "Labour hours per repair order",
            "Unapplied time (%)",
            "Service gross profit per location",
          ],
          personas: [
            "Head of Aftersales",
            "Fixed Operations Director",
            "Service Manager",
            "Dealer Principal",
            "Chief Financial Officer",
          ],
        },
      ],
    },
    {
      name: "Monetize Connected Vehicles & Data",
      whyChange:
        "Modern vehicles generate terabytes of data per day from sensors, infotainment, and connectivity modules. This data represents a largely untapped revenue stream — from subscription services and usage-based insurance to predictive maintenance alerts and personalised in-car experiences. OEMs that build scalable data platforms and clear customer consent frameworks will unlock recurring revenue and deeper customer relationships well beyond the point of sale.",
      priorities: [
        {
          name: "Connected Vehicle Services & Subscriptions",
          useCases: [
            {
              name: "Over-the-Air Update Orchestration & Analytics",
              description:
                "Manage OTA software and firmware deployments across the fleet, tracking update success rates, rollback events, and feature adoption to optimise release cadence and reduce dealer workshop interventions.",
              businessValue:
                "40–60% reduction in recall-related workshop visits for software-fixable issues.",
            },
            {
              name: "Connected Vehicle Subscription Management",
              description:
                "Operate a subscription platform for in-car digital services — navigation, Wi-Fi hotspot, advanced driver assistance features — tracking attach rates, churn, and lifetime value by cohort to inform packaging and pricing decisions.",
              businessValue:
                "Incremental recurring revenue stream; target 20–30% subscription attach rate on eligible fleet.",
            },
            {
              name: "Remote Diagnostics & Proactive Service Alerts",
              description:
                "Ingest real-time DTC and telemetry data from connected vehicles to detect degradation, alert owners, and pre-schedule service appointments at their preferred dealer, converting reactive breakdowns into planned visits.",
              businessValue:
                "15–25% increase in service lane throughput from pre-diagnosed appointments.",
            },
            {
              name: "In-Vehicle Experience Personalisation",
              description:
                "Use driver preference data, location context, and usage patterns to personalise infotainment recommendations, cabin settings, and contextual offers (charging, parking, drive-through), building engagement and brand stickiness.",
              businessValue:
                "Improved NPS and brand loyalty; enabler for third-party partnership revenue.",
              typicalDataEntities: [
                "Driver Preferences",
                "Location Context",
                "Usage Patterns",
                "Offer Catalog",
              ],
              typicalSourceSystems: [
                "Connected Vehicle Platform",
                "Infotainment System",
                "CRM",
                "Partner APIs",
              ],
            },
          ],
          kpis: [
            "Connected vehicle subscription attach rate (%)",
            "Subscription churn rate (monthly/annual)",
            "OTA update success rate (%)",
            "Average revenue per connected vehicle per month",
            "Remote diagnostic conversion-to-service rate (%)",
          ],
          personas: [
            "Head of Connected Vehicle",
            "Chief Digital Officer",
            "VP Product (Software)",
            "Head of Customer Experience",
          ],
        },
        {
          name: "Usage-Based & Personalised Offerings",
          useCases: [
            {
              name: "Usage-Based Insurance Partnerships",
              description:
                "Share anonymised driving behaviour data (mileage, braking, time-of-day patterns) with insurance partners to enable pay-how-you-drive policies, creating value for safe drivers and generating data-partnership revenue for the OEM.",
              businessValue:
                "New revenue channel; 10–20% premium reduction for qualifying drivers increases brand value proposition.",
            },
            {
              name: "Fleet Telematics & Driver Behaviour Analytics",
              description:
                "Provide fleet operators with dashboards covering utilisation, fuel/energy efficiency, driver safety scores, and geofencing, enabling operational optimisation and duty-of-care compliance.",
              businessValue:
                "5–10% reduction in fleet operating costs; improved driver safety outcomes.",
              typicalDataEntities: [
                "Utilisation Metrics",
                "Fuel Efficiency",
                "Driver Safety Scores",
                "Geofence Events",
              ],
              typicalSourceSystems: [
                "Fleet Telematics",
                "Connected Vehicle Platform",
                "Fleet Management System",
                "HR System",
              ],
            },
            {
              name: "Vehicle Data Monetisation & Partner Ecosystem",
              description:
                "Build a consent-managed data marketplace that enables third-party developers, insurers, smart-city platforms, and energy providers to access anonymised, aggregated vehicle data for product innovation.",
              businessValue: "Opens new B2B revenue streams; strengthens ecosystem partnerships.",
            },
          ],
          kpis: [
            "Data partnership revenue",
            "Consent opt-in rate (%)",
            "Fleet telematics adoption rate (%)",
            "Driver safety score improvement (%)",
            "Third-party API transaction volume",
          ],
          personas: [
            "Chief Data Officer",
            "VP Business Development",
            "Fleet Operations Director",
            "Head of Partnerships",
          ],
        },
      ],
    },
    {
      name: "Optimize Fleet, Remarketing & Asset Utilization",
      whyChange:
        "Residual values, remarketing speed, and asset utilization rates directly impact profitability for OEM financial-services arms, leasing companies, fleet operators, and subscription providers. Volatile used-vehicle markets, rising EV depreciation uncertainty, and the growth of flexible-ownership models all demand better data-driven decision-making on when to acquire, hold, reprice, and dispose of vehicles.",
      priorities: [
        {
          name: "Fleet & Subscription Operations",
          useCases: [
            {
              name: "Fleet Utilization & Right-Sizing Analytics",
              description:
                "Analyse vehicle utilisation rates, idle time, and demand patterns across a rental, subscription, or corporate fleet to recommend optimal fleet size, mix, and rebalancing actions by location.",
              businessValue:
                "5–10% improvement in fleet utilization; reduced capital tied up in under-used assets.",
            },
            {
              name: "Subscription & Flexible-Ownership Lifecycle Management",
              description:
                "Track each vehicle through its subscription lifecycle — onboarding, swap, extension, return — using data to optimise swap timing, minimise damage charges, and predict subscriber churn.",
              businessValue:
                "15–20% reduction in subscriber churn; improved vehicle residual at de-fleet.",
            },
            {
              name: "Total Cost of Ownership Modelling",
              description:
                "Build TCO models that factor in depreciation, maintenance, fuel/energy, insurance, and downtime for each vehicle class, enabling data-driven fleet procurement and contract pricing decisions.",
              businessValue:
                "More accurate lease and subscription pricing; reduced end-of-contract losses.",
            },
          ],
          kpis: [
            "Fleet utilization rate (%)",
            "Subscriber churn rate (monthly)",
            "Average revenue per vehicle per month",
            "Vehicle turnaround time (days between users)",
            "End-of-contract gain/loss per unit",
          ],
          personas: [
            "Fleet Operations Director",
            "Head of Mobility Services",
            "VP Financial Services",
            "Remarketing Manager",
          ],
        },
        {
          name: "Residual Value & Remarketing",
          useCases: [
            {
              name: "AI-Driven Residual Value Forecasting",
              description:
                "Predict future residual values at a VIN level using vehicle specification, mileage trajectory, condition data, regional market trends, and macro-economic indicators, feeding lease pricing, provisioning, and risk models.",
              businessValue:
                "20–30% improvement in residual value forecast accuracy; reduced book-to-market variance.",
            },
            {
              name: "Used Vehicle Sourcing & Pricing Intelligence",
              description:
                "Scan auction, trade-in, and wholesale market data in real time to identify acquisition opportunities that match retail demand profiles, recommending buy/pass decisions and optimal bid prices.",
              businessValue:
                "5–8% improvement in used-vehicle gross margin through smarter sourcing.",
            },
            {
              name: "Remarketing Channel Optimization",
              description:
                "Determine the highest-return disposition channel — retail, wholesale, auction, export, or certified pre-owned — for each returning vehicle based on condition, market demand, and holding cost, minimising time-to-sale.",
              businessValue: "10–15% reduction in average days to sell for de-fleeted vehicles.",
            },
            {
              name: "Certified Pre-Owned Programme Analytics",
              description:
                "Identify returning lease and fleet vehicles that meet CPO criteria, forecast reconditioning cost versus retail uplift, and target marketing to high-propensity CPO buyers to maximise programme volume and margin.",
              businessValue:
                "Higher CPO volume and penetration; improved customer retention into the brand ecosystem.",
            },
            {
              name: "Used Vehicle Digital Retailing & Superstore Operations",
              description:
                "Operate consumer-grade online used vehicle purchasing with 360-degree vehicle tours, transparent condition reporting, instant finance applications, home delivery logistics, and click-and-collect scheduling. Manage multi-location used inventory allocation, reconditioning workflows, and quality assurance across the superstore network to maximise retail conversion of trade-in and acquisition stock.",
              businessValue:
                "15–20% higher retail conversion vs. wholesale auction; 10–15% faster inventory turn through digital merchandising.",
              typicalDataEntities: [
                "Vehicle Condition Reports",
                "360-Degree Media",
                "Finance Applications",
                "Delivery Routes",
                "Reconditioning Tasks",
              ],
              typicalSourceSystems: [
                "Inventory Platform",
                "Digital Retailing",
                "Logistics System",
                "Finance Aggregator",
                "Quality Control",
              ],
            },
          ],
          kpis: [
            "Residual value forecast accuracy (% variance)",
            "Average days to sell (used/remarketed vehicles)",
            "Used vehicle gross profit per unit",
            "CPO penetration rate (%)",
            "Book-to-market value ratio",
            "Used vehicle digital retailing conversion rate (%)",
            "Reconditioning cycle time (days)",
          ],
          personas: [
            "Head of Remarketing",
            "VP Used Vehicles",
            "Chief Financial Officer",
            "Dealer Principal",
            "Pricing Analytics Manager",
          ],
        },
      ],
    },
    {
      name: "Lead in Sustainable Mobility",
      whyChange:
        "Regulatory mandates on fleet-average CO2 emissions, rising consumer demand for electric vehicles, and investor focus on ESG performance are making sustainability a board-level priority. OEMs face ZEV-sales quotas, dealers must build EV-ready showrooms and service capabilities, and the entire value chain needs transparent emissions and circularity reporting. Those who move early will capture EV-intender demand, qualify for green financing, and avoid non-compliance penalties.",
      priorities: [
        {
          name: "EV Adoption & Charging",
          useCases: [
            {
              name: "EV Demand Forecasting & Network Readiness",
              description:
                "Model EV adoption curves by region using registration data, incentive structures, charging infrastructure density, and demographic profiles to align production allocation, dealer stock, and training investment with anticipated demand.",
              businessValue:
                "Reduced EV stock imbalance; faster dealer readiness in high-growth markets.",
            },
            {
              name: "Charging Network Analytics & Site Selection",
              description:
                "Analyse connected-vehicle trip data, energy consumption patterns, and third-party POI data to identify optimal locations for branded or partner charging stations and forecast utilisation rates.",
              businessValue:
                "Higher charger utilization; improved owner charging satisfaction and brand loyalty.",
            },
            {
              name: "EV Battery Health Monitoring & Second-Life Assessment",
              description:
                "Track battery state-of-health over time using BMS telemetry, predicting remaining useful life for warranty, residual-value, and second-life repurposing decisions.",
              businessValue:
                "More accurate EV residual values; new revenue from battery second-life programmes.",
            },
            {
              name: "EV Owner Experience & Range Confidence",
              description:
                "Provide personalised range predictions, smart charging schedules, and route planning that factor in driving style, weather, payload, and real-time charger availability, reducing range anxiety and improving EV ownership satisfaction.",
              businessValue: "Improved EV NPS; higher EV re-purchase intent.",
            },
          ],
          kpis: [
            "EV sales mix (%)",
            "Charger utilization rate (%)",
            "EV customer satisfaction / NPS",
            "Battery state-of-health at lease return (%)",
            "EV stock turn vs. ICE stock turn",
          ],
          personas: [
            "Chief Sustainability Officer",
            "Head of EV Strategy",
            "VP Product Planning",
            "Charging Infrastructure Manager",
            "Dealer Principal",
          ],
        },
        {
          name: "Emissions & Circularity Reporting",
          useCases: [
            {
              name: "Fleet CO2 & Emissions Compliance Dashboard",
              description:
                "Aggregate production, registration, and real-world emissions data to track fleet-average CO2 against regulatory targets (EU, CAFE), modelling the impact of sales-mix changes and credit-trading scenarios.",
              businessValue:
                "Avoid non-compliance penalties that can reach hundreds of millions; optimise credit trading strategy.",
            },
            {
              name: "Supply Chain Carbon Footprint Tracking",
              description:
                "Collect Scope 1-3 emissions data from tier-1 and tier-2 suppliers, mapping the carbon footprint of each vehicle programme and identifying reduction levers aligned with science-based targets.",
              businessValue:
                "Transparent ESG reporting; identification of decarbonisation savings opportunities.",
            },
            {
              name: "Circular Economy & End-of-Life Vehicle Analytics",
              description:
                "Track material composition, recycled content, and end-of-life recovery rates per vehicle to support EU Battery Regulation and ELV Directive reporting, and identify circular design improvements.",
              businessValue:
                "Regulatory compliance; reduced raw material costs through increased recycled content.",
            },
          ],
          kpis: [
            "Fleet-average CO2 (g/km) vs. regulatory target",
            "Scope 1-3 emissions (tonnes CO2e)",
            "Recycled content rate (%)",
            "End-of-life vehicle recovery rate (%)",
            "ESG rating / score improvement",
          ],
          personas: [
            "Chief Sustainability Officer",
            "VP Regulatory Affairs",
            "Head of Supply Chain",
            "ESG Reporting Manager",
            "Chief Financial Officer",
          ],
        },
      ],
    },
    {
      name: "Drive Operational Excellence & Workforce Productivity",
      whyChange:
        "Labour costs represent 35–45% of gross profit in automotive retail, and multi-location dealer groups face compounding workforce complexity: inconsistent training across brands, chronic technician shortages, scheduling inefficiency, and high turnover that erodes institutional knowledge. Groups executing rapid M&A expansion must standardise processes across disparate DMS platforms, franchise requirements, and regional operations while maintaining service quality. Organisations that master workforce productivity and operational standardisation gain decisive cost advantages in a margin-compressed market.",
      priorities: [
        {
          name: "Workforce Management & Capability Building",
          useCases: [
            {
              name: "Multi-Location Workforce Scheduling & Optimisation",
              description:
                "Forecast staffing needs by department — sales floor, service lane, parts counter, BDC — using historical sales patterns, service bookings, seasonal demand, and local events. Optimise rosters across the dealership network to minimise labour cost while maintaining coverage targets and compliance with award/union requirements.",
              businessValue:
                "5–10% reduction in labour cost as a percentage of gross profit; improved roster accuracy and employee satisfaction.",
              typicalDataEntities: [
                "Sales Patterns",
                "Service Bookings",
                "Employee Availability",
                "Award/Union Rules",
                "Seasonal Demand",
              ],
              typicalSourceSystems: [
                "Workforce Management",
                "DMS",
                "HR System",
                "Service Scheduling",
              ],
            },
            {
              name: "Learning Management & Competency Tracking",
              description:
                "Deliver standardised training across product knowledge, sales techniques, customer service, compliance, and technical skills via a centralised LMS. Track certifications, skill levels, and training completion across the entire workforce, ensuring consistent capability development regardless of location or franchise brand.",
              businessValue:
                "20–30% reduction in training time through standardised digital content; improved compliance with OEM certification requirements.",
              typicalDataEntities: [
                "Training Courses",
                "Certifications",
                "Skill Assessments",
                "Completion Records",
                "OEM Requirements",
              ],
              typicalSourceSystems: ["LMS", "HR System", "OEM Training Portal", "DMS"],
            },
            {
              name: "Employee Engagement & Retention Analytics",
              description:
                "Monitor employee engagement through pulse surveys, sentiment analysis, and behavioural signals such as absenteeism and productivity trends. Identify retention risks at individual and team level, predict turnover, and trigger proactive interventions before high-value employees leave.",
              businessValue:
                "3–5 percentage point reduction in employee turnover; $2–3M annual savings in recruitment and training costs for a large dealer group.",
              typicalDataEntities: [
                "Survey Responses",
                "Absenteeism Records",
                "Productivity Metrics",
                "Tenure Data",
                "Exit Interview Themes",
              ],
              typicalSourceSystems: ["HR System", "Survey Platform", "DMS", "Payroll System"],
            },
            {
              name: "Technician Recruitment Pipeline & Skill Gap Analysis",
              description:
                "Analyse workforce demographics, certification coverage, and upcoming retirements to forecast technician and specialist hiring needs by location. Match apprentice and graduate pipelines with projected demand, prioritising EV/hybrid technical skills as the powertrain mix shifts.",
              businessValue:
                "Reduced time-to-fill for critical technician roles; proactive pipeline development aligned with electrification skill requirements.",
              typicalDataEntities: [
                "Workforce Demographics",
                "Certification Coverage",
                "Retirement Projections",
                "Apprentice Pipeline",
                "EV Skill Requirements",
              ],
              typicalSourceSystems: ["HR System", "Training Platform", "OEM Certification Portal"],
            },
          ],
          kpis: [
            "Labour cost as % of gross profit",
            "Employee turnover rate (%)",
            "Training completion rate (%)",
            "Gross profit per employee per month",
            "Technician fill rate (%)",
          ],
          personas: [
            "Chief Operating Officer",
            "Head of People & Culture",
            "Regional Operations Director",
            "Service Manager",
            "Head of Learning & Development",
          ],
        },
        {
          name: "Multi-Franchise Integration & Standardisation",
          useCases: [
            {
              name: "Post-Acquisition DMS & Data Integration",
              description:
                "Consolidate disparate dealer management systems, data models, and reporting structures into a unified enterprise platform following acquisitions. Establish consistent KPI definitions, chart of accounts, and data governance across all locations and brands to enable group-wide performance visibility.",
              businessValue:
                "50–70% reduction in time-to-integrate post-acquisition; consistent reporting across the entire network within months rather than years.",
              typicalDataEntities: [
                "DMS Data Models",
                "Chart of Accounts",
                "KPI Definitions",
                "Data Governance Rules",
                "Migration Logs",
              ],
              typicalSourceSystems: ["Legacy DMS", "Target DMS", "ERP", "Data Warehouse"],
            },
            {
              name: "Multi-Location Performance Benchmarking",
              description:
                "Normalise and compare operational metrics across dealerships by brand, region, size, and maturity. Identify top performers, surface transferable best practices, and flag underperforming locations for targeted intervention using automated variance analysis and peer-group ranking.",
              businessValue:
                "5–8% improvement in bottom-quartile dealership performance through best-practice transfer; faster identification of operational issues.",
              typicalDataEntities: [
                "Dealership KPIs",
                "Peer Group Definitions",
                "Variance Analysis",
                "Best Practice Library",
              ],
              typicalSourceSystems: ["DMS", "Financial System", "Data Warehouse", "BI Platform"],
            },
            {
              name: "Shared Services Automation",
              description:
                "Centralise and automate back-office functions — financial reconciliation, payroll processing, procurement, compliance reporting — across all locations to reduce duplication, improve consistency, and free dealership staff for customer-facing activities.",
              businessValue:
                "15–25% reduction in back-office cost per dealership; improved processing accuracy and compliance audit readiness.",
              typicalDataEntities: [
                "Financial Transactions",
                "Payroll Records",
                "Procurement Orders",
                "Compliance Documents",
              ],
              typicalSourceSystems: ["ERP", "Payroll System", "Procurement Platform", "DMS"],
            },
          ],
          kpis: [
            "Process standardisation rate (%)",
            "Time-to-integrate post-acquisition (months)",
            "Shared services cost per transaction",
            "Inter-dealership reporting consistency score",
            "Back-office cost per dealership",
          ],
          personas: [
            "Chief Operating Officer",
            "Chief Information Officer",
            "Chief Financial Officer",
            "Integration Programme Director",
          ],
        },
      ],
    },
  ],
};
