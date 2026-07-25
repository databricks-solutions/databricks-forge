import type { IndustryOutcome } from "./index";

export const WATER_UTILITIES: IndustryOutcome = {
  id: "water-utilities",
  name: "Water Utilities",
  subVerticals: [
    "Clean Water Supply",
    "Wastewater & Sewerage",
    "Water Retail",
    "Water Wholesale",
    "Integrated Water (Supply + Wastewater)",
    "Bulk Water & Dam Operations",
    "Irrigation & Scheme Water",
    "Recycled Water & Resource Recovery",
    "Water Grid Operations",
    "Capital Program Delivery",
  ],
  suggestedDomains: [
    "Network Operations",
    "Asset Management",
    "Customer Experience",
    "Environmental Compliance",
    "Water Quality",
    "Finance",
    "Water Security & Climate Resilience",
    "Bulk Water Operations",
    "Circular Economy",
    "Capital Delivery & Program Management",
    "Procurement & Supply Chain",
    "Cybersecurity & OT Resilience",
    "Digital Transformation & BI",
  ],
  suggestedPriorities: [
    "Optimize Operations",
    "Reduce Leakage",
    "Improve Water Quality",
    "Mitigate Risk",
    "Achieve ESG",
    "Ensure Water Security",
    "Enable Digital & Smart Networks",
    "Support Community Liveability",
    "Transform Capital Delivery",
    "Improve Financial Sustainability",
    "Strengthen OT Cybersecurity",
    "Automate Business Processes",
  ],
  objectives: [
    // ------------------------------------------------------------------
    // Objective 1 -- Network & Bulk Water Operations
    // ------------------------------------------------------------------
    {
      name: "Optimize Network & Bulk Water Operations",
      whyChange:
        "Water utilities lose an average of 20-30% of treated water to leakage and inefficiency in distribution networks, while bulk water providers face growing pressure to optimise dam, pipeline, and scheme operations under climate variability. Data-driven network management, predictive asset maintenance, demand forecasting, and scheme optimisation deliver substantial cost savings, improve service reliability, and reduce supply interruptions.",
      priorities: [
        {
          name: "Leakage Reduction & Network Efficiency",
          useCases: [
            {
              name: "Non-Revenue Water Detection",
              description:
                "Classify and locate leakage using sensor, DMA flow, and pressure data to prioritise repair and pressure management interventions.",
              businessValue:
                "Typical 10-15% reduction in leakage volumes, saving millions in treatment and pumping costs.",
              typicalDataEntities: [
                "Pressure Sensor Data",
                "Flow Meter Readings",
                "DMA Flow Data",
                "Pipe Network GIS",
              ],
              typicalSourceSystems: ["SCADA", "GIS Platform", "Asset Management System"],
            },
            {
              name: "Pipe Burst Prediction",
              description:
                "Predict burst risk from pipe age, material, soil conditions, weather, and historical failure patterns to enable proactive intervention.",
              typicalDataEntities: [
                "Pipe Asset Register",
                "Soil Condition Data",
                "Weather Records",
                "Historical Failure Logs",
              ],
              typicalSourceSystems: ["Asset Management System", "GIS Platform", "CMMS"],
            },
            {
              name: "Demand Forecasting",
              description:
                "Forecast water demand by DMA using weather, seasonality, population, and consumption patterns to optimise pumping schedules and reservoir levels.",
              typicalDataEntities: [
                "Historical Consumption by DMA",
                "Weather Forecasts",
                "Population Data",
                "Reservoir Levels",
              ],
              typicalSourceSystems: ["SCADA", "Billing System", "Meter Data Management"],
            },
          ],
          kpis: [
            "Leakage (Ml/d)",
            "Supply interruptions (customer minutes lost)",
            "Burst rate per km of mains",
            "Non-revenue water (%)",
          ],
          personas: ["Head of Leakage", "VP Network Operations", "Chief Operating Officer"],
        },
        {
          name: "Asset Management & Investment Planning",
          useCases: [
            {
              name: "Asset Deterioration Modelling",
              description:
                "Model remaining useful life of pipes, pumps, and treatment assets using age, material, condition, and operational history.",
              typicalDataEntities: [
                "Asset Register",
                "Condition Assessment Records",
                "Operational History",
                "Maintenance Logs",
              ],
              typicalSourceSystems: ["Asset Management System", "CMMS", "SCADA"],
            },
            {
              name: "Capital Investment Optimisation",
              description:
                "Prioritise mains renewal and asset replacement programmes to maximise risk reduction per dollar of capital investment.",
              businessValue:
                "Improved capital efficiency by targeting highest-risk assets first across regulatory and planning cycles.",
            },
            {
              name: "Predictive Maintenance for Pumping Stations",
              description:
                "Predict pump and motor failures from SCADA telemetry, vibration data, and energy consumption patterns to reduce unplanned outages.",
            },
          ],
          kpis: [
            "Asset health grade",
            "Cost per property",
            "Unplanned outage rate",
            "Capital efficiency ratio",
          ],
          personas: ["Head of Asset Strategy", "VP Engineering", "Chief Asset Officer"],
        },
        {
          name: "Bulk Water & Scheme Operations",
          useCases: [
            {
              name: "Dam Operations Optimisation",
              description:
                "Optimise dam release schedules, storage levels, and transfer operations across interconnected schemes using inflow forecasts, demand projections, and environmental flow requirements.",
              businessValue:
                "Maximise water availability while meeting environmental obligations and minimising spill losses.",
            },
            {
              name: "Channel Loss & Scheme Efficiency Monitoring",
              description:
                "Monitor and model conveyance losses across irrigation channels, pipelines, and open waterways to identify seepage, evaporation hotspots, and infrastructure upgrade priorities.",
            },
            {
              name: "Regional Water Grid Optimisation",
              description:
                "Model inter-connected bulk water transfers across dams, treatment plants, and desalination assets to optimise whole-of-grid supply reliability and cost.",
            },
          ],
          kpis: [
            "Scheme delivery efficiency (%)",
            "Conveyance loss (Ml/d)",
            "Allocation reliability (%)",
            "Storage utilisation vs capacity",
          ],
          personas: [
            "Head of Water Resources",
            "Bulk Water Operations Manager",
            "Chief Operating Officer",
          ],
        },
        {
          name: "Dam Safety & Major Infrastructure Risk",
          useCases: [
            {
              name: "Dam Safety Risk & Consequence-of-Failure Modelling",
              description:
                "Integrate structural condition, hydrology, seismicity, and downstream population data to model dam failure consequences and prioritise safety upgrade investments.",
              businessValue:
                "Proactive risk-based capital allocation for dam safety programmes, meeting regulatory guidelines and reducing residual risk.",
            },
            {
              name: "Spillway & Major Asset Condition Assessment",
              description:
                "Combine inspection data, sensor telemetry, and environmental loading to assess spillway, embankment, and outlet condition and predict intervention timing.",
            },
          ],
          kpis: [
            "Dam safety compliance (%)",
            "Overdue safety actions count",
            "Consequence category rating",
            "Major asset condition score",
          ],
          personas: ["Head of Dam Safety", "Chief Risk Officer", "VP Engineering"],
        },
        {
          name: "Treatment Plant Optimisation & Process Control",
          useCases: [
            {
              name: "Advanced Process Control for Chemical Dosing",
              description:
                "Deploy APC algorithms across treatment plants to optimise coagulant, disinfectant, and pH dosing in real-time based on continuous source water quality, turbidity, and flow telemetry, reducing chemical costs while maintaining compliance.",
              businessValue:
                "5-8% chemical cost reduction yielding $2-3M annually across a multi-plant portfolio.",
              typicalDataEntities: [
                "Source Water Quality Telemetry",
                "Chemical Dosage Rates",
                "Flow & Turbidity Data",
                "Compliance Thresholds",
              ],
              typicalSourceSystems: [
                "SCADA",
                "Treatment Plant DCS",
                "Laboratory Information System",
              ],
            },
            {
              name: "Treatment Plant Energy Optimisation",
              description:
                "Optimise blower staging, variable frequency drive control, pump scheduling, and backwash cycle timing to reduce electricity consumption by 8-15% across water treatment plant operations.",
              businessValue:
                "10% reduction on $40-50M annual energy spend generates $4-5M recurring savings.",
              typicalDataEntities: [
                "Energy Consumption by Asset",
                "Pump & Blower Run Hours",
                "VFD Operating Parameters",
                "Backwash Schedules",
              ],
              typicalSourceSystems: ["SCADA", "Energy Management System", "Treatment Plant DCS"],
            },
            {
              name: "IoT Condition-Based Maintenance",
              description:
                "Deploy vibration, temperature, flow, and power consumption sensors on critical rotating assets (pumps, blowers, motors) to transition from time-based preventive maintenance to condition-based and predictive maintenance.",
              businessValue:
                "30-40% reduction in reactive maintenance incidents; 20-30% decrease in preventive maintenance frequency; 15-20% total maintenance cost reduction.",
              typicalDataEntities: [
                "Vibration Sensor Data",
                "Temperature Readings",
                "Power Consumption Patterns",
                "Maintenance History",
              ],
              typicalSourceSystems: ["IoT Platform", "SCADA", "CMMS", "Asset Management System"],
            },
            {
              name: "Outsourced Maintenance Performance Analytics",
              description:
                "Monitor contracted maintenance partner KPIs, SLA adherence, reactive-vs-preventive ratio, cost-per-asset trends, and work order completion rates to ensure outsourced service delivery meets performance expectations.",
              typicalDataEntities: [
                "Work Order Records",
                "SLA Metrics",
                "Reactive vs Preventive Ratio",
                "Cost per Asset",
              ],
              typicalSourceSystems: [
                "CMMS",
                "Contract Management System",
                "Asset Management System",
              ],
            },
          ],
          kpis: [
            "Treatment plant energy intensity (kWh/Ml)",
            "Chemical cost per Ml treated",
            "Reactive maintenance ratio (%)",
            "Outsourced maintenance SLA compliance (%)",
          ],
          personas: [
            "Head of Treatment Operations",
            "Chief Operating Officer",
            "Asset Performance Manager",
            "Maintenance Contract Manager",
          ],
        },
      ],
    },
    // ------------------------------------------------------------------
    // Objective 2 -- Water Quality & Environmental Resilience
    // ------------------------------------------------------------------
    {
      name: "Protect Water Quality & Environmental Resilience",
      whyChange:
        "Regulatory scrutiny on water quality, pollution incidents, and environmental performance is intensifying globally. Climate variability increases source water risk and extreme weather events. Data-driven monitoring, catchment management, and predictive analytics enable proactive compliance, reduce pollution events, and support net-zero carbon targets.",
      priorities: [
        {
          name: "Water Quality Compliance",
          useCases: [
            {
              name: "Water Quality Anomaly Detection",
              description:
                "Detect quality exceedances at treatment works and in-network using continuous monitoring data, triggering early intervention before compliance breaches.",
              typicalDataEntities: [
                "Continuous Monitoring Data",
                "Quality Thresholds",
                "Treatment Works Parameters",
                "Compliance Limits",
              ],
              typicalSourceSystems: [
                "SCADA",
                "Laboratory Information System",
                "Water Quality Monitoring",
              ],
            },
            {
              name: "Chemical Dosing Optimisation",
              description:
                "Optimise coagulant, chlorine, and pH dosing using source water quality and flow data to reduce chemical costs while maintaining compliance.",
              typicalDataEntities: [
                "Source Water Quality",
                "Flow Rates",
                "Chemical Dosage Records",
                "Compliance Results",
              ],
              typicalSourceSystems: [
                "SCADA",
                "Laboratory Information System",
                "Treatment Plant DCS",
              ],
            },
            {
              name: "Catchment Risk Assessment",
              description:
                "Assess raw water quality risk from agricultural run-off, industrial discharges, and climate factors to inform catchment management programmes.",
              typicalDataEntities: [
                "Land Use Data",
                "Discharge Permits",
                "Rainfall Patterns",
                "Raw Water Quality Trends",
              ],
              typicalSourceSystems: [
                "GIS Platform",
                "Environmental Compliance System",
                "Laboratory Information System",
              ],
            },
          ],
          kpis: [
            "Drinking water compliance (%)",
            "Coliform detection failures",
            "Taste and odour complaints",
            "Treatment cost per Ml",
          ],
          personas: ["Head of Water Quality", "Chief Scientist", "Regulatory Director"],
        },
        {
          name: "Integrated Catchment & Source Management",
          useCases: [
            {
              name: "Catchment Health Monitoring & Intervention Planning",
              description:
                "Integrate satellite imagery, land-use data, rainfall patterns, and water quality trends to monitor catchment health and prioritise intervention programmes across source water areas.",
              businessValue:
                "Proactive source protection reduces treatment complexity and cost while safeguarding long-term water quality.",
              typicalDataEntities: [
                "Satellite Imagery",
                "Land Use Data",
                "Rainfall Records",
                "Water Quality Trends",
              ],
              typicalSourceSystems: [
                "GIS Platform",
                "Environmental Monitoring",
                "Laboratory Information System",
              ],
            },
            {
              name: "Source Water Quality Trend Analysis",
              description:
                "Analyse long-term trends in raw water quality across reservoirs and river abstractions, correlating with land-use change, climate patterns, and upstream activity to anticipate emerging risks.",
              typicalDataEntities: [
                "Raw Water Quality Records",
                "Land Use Change Data",
                "Climate Patterns",
                "Upstream Discharge Records",
              ],
              typicalSourceSystems: [
                "Laboratory Information System",
                "GIS Platform",
                "Environmental Monitoring",
              ],
            },
          ],
          kpis: [
            "Catchment health index",
            "Source water quality trend (improving/stable/declining)",
            "Intervention programme completion (%)",
          ],
          personas: [
            "Head of Catchment Management",
            "Head of Water Quality",
            "Environmental Scientist",
          ],
        },
        {
          name: "Climate, Environment & Sustainability Performance",
          useCases: [
            {
              name: "Sewer Overflow Prediction",
              description:
                "Predict sewer overflow events from rainfall forecasts, network level sensors, and flow data to enable proactive spill prevention.",
              businessValue:
                "Reduce overflow spill frequency and duration, directly impacting regulatory performance commitments.",
              typicalDataEntities: [
                "Rainfall Forecasts",
                "Network Level Sensors",
                "Flow Data",
                "CSO Event History",
              ],
              typicalSourceSystems: ["SCADA", "Weather Services", "Wastewater Management System"],
            },
            {
              name: "Carbon Emissions Tracking",
              description:
                "Automate Scope 1, 2, and 3 emissions reporting across pumping, treatment, transport, and fleet operations.",
              typicalDataEntities: [
                "Energy Consumption",
                "Fleet Fuel Records",
                "Treatment Process Data",
                "Supply Chain Emissions",
              ],
              typicalSourceSystems: [
                "SCADA",
                "Fleet Management System",
                "ERP",
                "Energy Management System",
              ],
            },
            {
              name: "Pollution Incident Prevention",
              description:
                "Identify high-risk discharge points using telemetry, event history, and network hydraulic models to prevent significant pollution incidents.",
              typicalDataEntities: [
                "Discharge Telemetry",
                "Event History",
                "Network Hydraulic Model",
                "Risk Assessments",
              ],
              typicalSourceSystems: ["SCADA", "Wastewater Management System", "GIS Platform"],
            },
            {
              name: "Climate Variability & Drought Scenario Modelling",
              description:
                "Model the impact of climate change scenarios on rainfall patterns, inflow projections, and demand to inform long-term infrastructure planning and drought response strategies.",
              typicalDataEntities: [
                "Climate Scenarios",
                "Rainfall Projections",
                "Inflow Forecasts",
                "Demand Projections",
              ],
              typicalSourceSystems: [
                "Climate Modelling",
                "Hydrological Modelling",
                "Billing System",
                "Bulk Water Planning",
              ],
            },
            {
              name: "Emissions Reduction & Net-Zero Pathway Analytics",
              description:
                "Track progress toward net-zero targets by modelling abatement options across energy use, process emissions, biogas capture, and renewable energy generation.",
            },
          ],
          kpis: [
            "Pollution incidents (by severity)",
            "Sewer overflow frequency and duration",
            "Carbon intensity (kgCO2e/Ml)",
            "Recreational water quality compliance",
            "Net-zero pathway progress (%)",
          ],
          personas: [
            "Head of Environment",
            "Chief Sustainability Officer",
            "Head of Climate & Resilience",
            "VP Wastewater",
          ],
        },
      ],
    },
    // ------------------------------------------------------------------
    // Objective 3 -- Customer, Commercial & Wholesale Performance
    // ------------------------------------------------------------------
    {
      name: "Improve Customer, Commercial & Wholesale Performance",
      whyChange:
        "Water utilities serve diverse customer bases -- from residential end-consumers to wholesale retailer utilities, irrigators, and industrial users. Growing expectations around experience, affordability, transparency, and service reliability require analytics that span retail billing, wholesale joint planning, and irrigation scheme delivery.",
      priorities: [
        {
          name: "Retail Customer Experience & Billing",
          useCases: [
            {
              name: "Smart Meter Consumption Analytics",
              description:
                "Segment customers by usage pattern, identify leaks on customer supply pipes, and detect meter under-registration using high-frequency smart meter data.",
            },
            {
              name: "Customer Vulnerability Identification",
              description:
                "Classify customers at risk of water poverty or requiring priority services using billing, demographic, and contact data to ensure targeted support.",
              businessValue:
                "Improved customer satisfaction scores and reduced bad debt through proactive vulnerability management.",
            },
            {
              name: "Meter-to-Cash Accuracy",
              description:
                "Detect billing anomalies, estimated-read drift, and unbilled consumption to improve revenue assurance and customer trust.",
            },
          ],
          kpis: [
            "Customer satisfaction score",
            "Per capita consumption (PCC)",
            "Billing accuracy (%)",
            "Customer contacts per 1000 connections",
          ],
          personas: ["VP Customer Experience", "Head of Retail", "Chief Commercial Officer"],
        },
        {
          name: "Wholesale & Irrigation Customer Outcomes",
          useCases: [
            {
              name: "Wholesale Customer Portal & Joint Planning Analytics",
              description:
                "Provide retailer utilities with shared demand forecasts, outage coordination dashboards, incident lessons-learnt reporting, and joint capital planning analytics through a collaborative portal.",
              businessValue:
                "Strengthened wholesale relationships, improved joint demand planning accuracy, and faster coordinated incident response.",
            },
            {
              name: "Allocation Forecasting & Delivery Reliability Reporting",
              description:
                "Forecast seasonal water allocations per scheme using storage, inflow, and demand data, and report delivery reliability against announced allocations for irrigation and industrial customers.",
            },
            {
              name: "Irrigator Self-Service & Scheme Performance Dashboards",
              description:
                "Give irrigators real-time visibility into their allocation balance, ordering status, channel delivery schedules, and historical usage via self-service dashboards.",
            },
          ],
          kpis: [
            "Allocation reliability (%)",
            "Delivery reliability (%)",
            "Wholesale customer satisfaction",
            "Irrigator portal adoption rate",
          ],
          personas: [
            "Irrigation Customer Manager",
            "Head of Wholesale Partnerships",
            "Chief Commercial Officer",
          ],
        },
        {
          name: "Stakeholder & Community Digital Engagement",
          useCases: [
            {
              name: "Community Engagement for Infrastructure Projects",
              description:
                "Operate a digital consultation platform for dam improvement and major infrastructure projects, managing community feedback, project communications, impact notifications, and sentiment analysis at scale across multiple concurrent programmes.",
              businessValue:
                "Avoiding a single 3-month infrastructure delay from community opposition saves $15-25M in extended mobilisation costs.",
              typicalDataEntities: [
                "Community Feedback Records",
                "Project Communications",
                "Stakeholder Contact Registry",
                "Sentiment Analysis Data",
              ],
              typicalSourceSystems: [
                "Consultation Manager Platform",
                "PPM Platform (Planisware)",
                "CRM",
              ],
            },
            {
              name: "Recreational Facility Booking & Management",
              description:
                "Manage dam-adjacent recreational areas with analytics covering bookings, visitor numbers, safety incidents, capacity utilisation, and maintenance scheduling to optimise visitor experience and compliance.",
              typicalDataEntities: [
                "Booking Records",
                "Visitor Counts",
                "Safety Incident Logs",
                "Facility Maintenance Schedules",
              ],
              typicalSourceSystems: [
                "Booking Platform",
                "Facility Management System",
                "Safety Reporting System",
              ],
            },
            {
              name: "Developer & Commercial Connection Portal",
              description:
                "Provide self-service portal for connection applications, agreement tracking, technical submissions, and project milestone visibility for developer and commercial customers.",
              businessValue:
                "30-40% reduction in manual application processing time; improved customer satisfaction through 24/7 self-service access.",
              typicalDataEntities: [
                "Connection Applications",
                "Agreement Status",
                "Technical Submissions",
                "Project Milestones",
              ],
              typicalSourceSystems: ["CRM", "Asset Management System", "GIS Platform"],
            },
            {
              name: "Retailer B2B Operational Coordination",
              description:
                "Enable data exchange with wholesale retailer utilities covering operational coordination, planned maintenance windows, incident management, joint demand planning, and shared performance reporting.",
              typicalDataEntities: [
                "Operational Coordination Events",
                "Maintenance Window Schedules",
                "Incident Records",
                "Shared Demand Forecasts",
              ],
              typicalSourceSystems: [
                "B2B Integration Platform",
                "SCADA",
                "Incident Management System",
              ],
            },
          ],
          kpis: [
            "Community engagement satisfaction score",
            "Digital self-service adoption rate (%)",
            "Application processing time (days)",
            "Retailer coordination response time (hours)",
          ],
          personas: [
            "Head of Stakeholder Engagement",
            "Community Relations Manager",
            "Chief Customer Officer",
            "Wholesale Partnerships Manager",
          ],
        },
      ],
    },
    // ------------------------------------------------------------------
    // Objective 4 -- Regional Water Security & Drought Resilience
    // ------------------------------------------------------------------
    {
      name: "Ensure Regional Water Security & Drought Resilience",
      whyChange:
        "Climate change is increasing the frequency and severity of drought events, threatening water supply security for communities, agriculture, and industry. Bulk water providers and regional utilities must plan across interconnected schemes, optimise diverse supply sources (dams, desalination, groundwater, recycled water), and coordinate drought response to maintain reliable supply.",
      priorities: [
        {
          name: "Water Security Planning & Grid Operations",
          useCases: [
            {
              name: "Drought Scenario Planning & Restrictions Modelling",
              description:
                "Model drought scenarios against storage trajectories, demand forecasts, and supply augmentation options to inform restriction trigger levels and contingency planning.",
              businessValue:
                "Earlier, evidence-based restriction decisions that balance community impact with supply security.",
              typicalDataEntities: [
                "Storage Trajectories",
                "Demand Forecasts",
                "Supply Augmentation Options",
                "Restriction Triggers",
              ],
              typicalSourceSystems: ["Bulk Water Planning", "SCADA", "Hydrological Modelling"],
            },
            {
              name: "Desalination Optimisation",
              description:
                "Optimise desalination plant dispatch, energy consumption, and maintenance scheduling based on grid demand, storage levels, and energy market conditions.",
              typicalDataEntities: [
                "Grid Demand",
                "Storage Levels",
                "Energy Market Prices",
                "Plant Capacity",
              ],
              typicalSourceSystems: ["SCADA", "Desalination Plant DCS", "Energy Market Data"],
            },
            {
              name: "Inter-connected Scheme Optimisation",
              description:
                "Model transfers and balancing across multiple dams, treatment plants, and distribution zones within a regional water grid to maximise whole-of-system reliability.",
              typicalDataEntities: [
                "Transfer Capacity",
                "Treatment Output",
                "Storage Levels",
                "Zone Demand",
              ],
              typicalSourceSystems: ["SCADA", "Bulk Water Planning", "Asset Management System"],
            },
            {
              name: "Water Security Index Forecasting",
              description:
                "Calculate and forecast a composite water security index per scheme incorporating storage, inflow trends, demand growth, climate outlook, and supply augmentation capacity.",
              typicalDataEntities: [
                "Storage Levels",
                "Inflow Trends",
                "Demand Growth",
                "Climate Outlook",
              ],
              typicalSourceSystems: ["SCADA", "Bulk Water Planning", "Climate Modelling"],
            },
            {
              name: "Supply Augmentation Sequencing & Investment Deferral",
              description:
                "Model optimal timing and sequencing for new supply sources (desalination expansion, dam-to-grid connections, advanced recycled water) to defer capital investment by 5-10 years through grid optimisation and demand management.",
              businessValue:
                "Optimal sequencing can defer $200-300M in capital expenditure compared to conservative static planning approaches.",
              typicalDataEntities: [
                "Supply Source Options",
                "Capital Cost Estimates",
                "Grid Capacity Models",
                "Demand Management Scenarios",
              ],
              typicalSourceSystems: [
                "Bulk Water Planning",
                "PPM Platform (Planisware)",
                "Financial Modelling",
              ],
            },
            {
              name: "Population Growth & Demand Corridor Modelling",
              description:
                "Project water demand by growth corridor integrating land-use planning, development approvals, and population forecasts to inform augmentation trigger points and infrastructure staging.",
              typicalDataEntities: [
                "Development Approvals",
                "Population Forecasts by Corridor",
                "Land Use Plans",
                "Connection Growth Rates",
              ],
              typicalSourceSystems: [
                "Planning & Development Data",
                "GIS Platform",
                "Bulk Water Planning",
              ],
            },
          ],
          kpis: [
            "Water security index / headroom by scheme",
            "Storage levels vs trigger thresholds",
            "Restrictions frequency and duration",
            "Supply augmentation readiness (%)",
          ],
          personas: [
            "Head of Water Resources",
            "Chief Water Security Officer",
            "Head of Climate & Resilience",
          ],
        },
      ],
    },
    // ------------------------------------------------------------------
    // Objective 5 -- Smart Networks & Regional Collaboration
    // ------------------------------------------------------------------
    {
      name: "Advance Smart Networks & Regional Collaboration",
      whyChange:
        "Digital metering, IoT sensor networks, and smart water platforms are transforming how utilities detect leaks, manage pressure, and engage customers. Leading utilities are also sharing platforms and data with smaller regional councils to lift capability across the sector.",
      priorities: [
        {
          name: "Digital & Smart Network Enablement",
          useCases: [
            {
              name: "AMI Rollout Analytics & Telemetry Quality",
              description:
                "Monitor smart meter deployment progress, communication reliability, and data quality to ensure the AMI programme delivers full network visibility on schedule.",
              businessValue:
                "Accelerated realisation of smart metering benefits through early detection of telemetry gaps and meter faults.",
              typicalDataEntities: [
                "Deployment Progress",
                "Communication Reliability",
                "Data Quality Metrics",
                "Meter Fault Records",
              ],
              typicalSourceSystems: [
                "AMI Head-End",
                "Meter Data Management",
                "Asset Management System",
              ],
            },
            {
              name: "Smart Network Event Correlation",
              description:
                "Correlate events across pressure, flow, acoustic, and meter telemetry to automatically detect, classify, and locate network anomalies such as bursts, leaks, and pressure transients.",
              typicalDataEntities: [
                "Pressure Telemetry",
                "Flow Data",
                "Acoustic Logs",
                "Meter Events",
              ],
              typicalSourceSystems: ["SCADA", "AMI Head-End", "GIS Platform"],
            },
            {
              name: "Digital Twin for Network Simulation",
              description:
                "Build and maintain a hydraulic digital twin of the distribution or bulk water network to simulate operational scenarios, optimise pressure management, and plan capital interventions.",
            },
          ],
          kpis: [
            "Smart meter coverage (%)",
            "Telemetry data completeness (%)",
            "Digital event detection rate",
            "Digital twin model accuracy",
          ],
          personas: [
            "Head of Digital",
            "Smart Network Program Manager",
            "Chief Technology Officer",
          ],
        },
        {
          name: "Regional Shared Services & Collaboration",
          useCases: [
            {
              name: "Shared Services & Data Hub for Regional Utilities",
              description:
                "Operate a shared analytics platform and data hub that enables smaller regional councils and utilities to access smart water capabilities without building bespoke infrastructure.",
              businessValue:
                "Economies of scale for smaller utilities and consistent data standards across the region.",
              typicalDataEntities: [
                "Operational Metrics",
                "Asset Data",
                "Customer Data",
                "Quality Standards",
              ],
              typicalSourceSystems: [
                "Data Hub",
                "Shared Analytics Platform",
                "Participating Utility Systems",
              ],
            },
            {
              name: "Cross-utility Benchmarking Analytics",
              description:
                "Aggregate anonymised operational, financial, and customer metrics across participating utilities to enable peer benchmarking and identify best-practice improvement opportunities.",
              typicalDataEntities: [
                "Operational KPIs",
                "Financial Metrics",
                "Customer Satisfaction",
                "Asset Performance",
              ],
              typicalSourceSystems: [
                "Data Hub",
                "Participating Utility Systems",
                "Regulatory Reporting",
              ],
            },
          ],
          kpis: [
            "Participating utilities count",
            "Shared platform adoption rate",
            "Benchmarking insight actions implemented",
          ],
          personas: [
            "Head of Regional Partnerships",
            "Chief Information Officer",
            "VP Network Operations",
          ],
        },
        {
          name: "OT Cybersecurity & Operational Resilience",
          useCases: [
            {
              name: "OT Asset Inventory & Vulnerability Assessment",
              description:
                "Maintain a comprehensive inventory of SCADA and OT assets with vulnerability scoring, firmware/patch status, external connectivity mapping, and default credential detection across treatment plants, pump stations, and dam infrastructure.",
              businessValue:
                "Foundation for cyber risk management; 83% of water utilities have undocumented external OT connections that represent unmanaged attack vectors.",
              typicalDataEntities: [
                "OT Asset Register",
                "Firmware & Patch Levels",
                "Vulnerability Scan Results",
                "Network Connectivity Maps",
              ],
              typicalSourceSystems: [
                "OT Asset Discovery Tool",
                "SCADA",
                "Vulnerability Scanner",
                "Network Management System",
              ],
            },
            {
              name: "OT/IT Network Segmentation Monitoring",
              description:
                "Continuously monitor segmentation boundaries between IT and OT networks, detecting policy violations, unauthorised access attempts, and configuration drift that could expose operational technology to cyber threats.",
              typicalDataEntities: [
                "Network Traffic Logs",
                "Segmentation Policy Rules",
                "Access Attempt Records",
                "Configuration Baselines",
              ],
              typicalSourceSystems: [
                "Firewall & Network Appliances",
                "SIEM",
                "Network Management System",
              ],
            },
            {
              name: "SCADA Threat Detection & Incident Response",
              description:
                "Deploy anomaly detection on OT network traffic and SCADA command sequences, identifying suspicious activity patterns and triggering automated incident response workflows to protect critical water infrastructure.",
              businessValue:
                "Prevented cyber incidents avoid $10-50M in estimated costs from service disruption, remediation, and regulatory penalties.",
              typicalDataEntities: [
                "SCADA Command Logs",
                "OT Network Traffic",
                "Anomaly Detection Alerts",
                "Incident Response Playbooks",
              ],
              typicalSourceSystems: [
                "OT Security Platform",
                "SCADA",
                "SIEM",
                "Incident Management System",
              ],
            },
          ],
          kpis: [
            "OT asset inventory completeness (%)",
            "Vulnerability remediation rate (%)",
            "Network segmentation policy compliance (%)",
            "Mean time to detect OT security incidents (hours)",
          ],
          personas: [
            "Chief Information Security Officer",
            "OT Security Manager",
            "Head of Digital",
            "Chief Risk Officer",
          ],
        },
        {
          name: "Enterprise Data & Analytics Platform",
          useCases: [
            {
              name: "Cross-System Data Integration & Warehousing",
              description:
                "Unify data from operational (SCADA, treatment plant DCS), commercial (billing, contracts), project management (PPM), procurement (source-to-pay), and financial systems into a governed enterprise data platform enabling cross-domain analytics.",
              businessValue:
                "Breaks data silos that limit enterprise visibility; foundation for all advanced analytics and AI use cases.",
              typicalDataEntities: [
                "Operational Telemetry",
                "Financial Data",
                "Project & Portfolio Data",
                "Procurement & Contract Data",
              ],
              typicalSourceSystems: [
                "SCADA",
                "ERP",
                "PPM Platform (Planisware)",
                "Source-to-Pay Platform (Zycus)",
                "Asset Management System",
              ],
            },
            {
              name: "Operational Benchmarking & KPI Framework",
              description:
                "Deliver pre-built water utility KPI dashboards enabling cross-domain performance monitoring, peer benchmarking against comparable utilities, and automated regulatory reporting with drill-down capability.",
              typicalDataEntities: [
                "Operational KPIs",
                "Financial Performance Metrics",
                "Peer Utility Benchmarks",
                "Regulatory Submission Data",
              ],
              typicalSourceSystems: [
                "Enterprise Data Platform",
                "Regulatory Reporting",
                "Industry Benchmarking Database",
              ],
            },
            {
              name: "AI-Driven Operational Scenario Modelling",
              description:
                "Combine demand, climate, asset condition, financial, and workforce data for AI-powered what-if scenario planning, enabling optimised capital programme timing, operational strategy selection, and long-term infrastructure planning.",
              businessValue:
                "Portfolio-level optimisation yields 3-5% efficiency gain ($20-30M annually) plus improved demand forecasting ($40-50M value from optimised capital timing).",
              typicalDataEntities: [
                "Demand Forecasts",
                "Climate Projections",
                "Asset Condition Data",
                "Financial Scenarios",
              ],
              typicalSourceSystems: [
                "Enterprise Data Platform",
                "Climate Modelling",
                "Asset Management System",
                "Financial Modelling",
              ],
            },
          ],
          kpis: [
            "Data platform coverage (% of source systems integrated)",
            "KPI dashboard adoption rate (%)",
            "Scenario model accuracy vs actuals (%)",
            "Time to generate regulatory reports (hours)",
          ],
          personas: [
            "Chief Data Officer",
            "Chief Information Officer",
            "VP Strategy & Performance",
            "Head of Digital",
          ],
        },
      ],
    },
    // ------------------------------------------------------------------
    // Objective 6 -- Community Liveability & Circular Economy
    // ------------------------------------------------------------------
    {
      name: "Support Community Liveability & Circular Economy",
      whyChange:
        "Water utilities play a central role in community liveability, public health, and the transition to a circular economy. Recycled water, biosolids reuse, energy recovery, and precinct-scale innovation create new value streams while reducing environmental impact. Utilities with strong social mandates must also demonstrate measurable community and affordability outcomes.",
      priorities: [
        {
          name: "Recycled Water & Resource Recovery",
          useCases: [
            {
              name: "Recycled Water Demand & Distribution Optimisation",
              description:
                "Forecast recycled water demand by customer segment and optimise production, storage, and distribution to maximise reuse rates and minimise discharge to waterways.",
              businessValue:
                "Increased recycled water revenue and reduced environmental discharge volumes.",
            },
            {
              name: "Biosolids Reuse & Energy Recovery Analytics",
              description:
                "Track biosolids production, quality, and beneficial reuse pathways (agriculture, land rehabilitation, energy generation) to optimise resource recovery and regulatory compliance.",
              typicalDataEntities: [
                "Biosolids Production",
                "Quality Test Results",
                "Reuse Pathways",
                "Energy Recovery",
              ],
              typicalSourceSystems: [
                "Treatment Plant DCS",
                "Laboratory Information System",
                "Waste Management System",
              ],
            },
            {
              name: "Precinct-scale Water Recycling Feasibility",
              description:
                "Model the financial and environmental viability of decentralised water recycling schemes for new precincts, factoring in demand density, treatment costs, and regulatory requirements.",
            },
          ],
          kpis: [
            "Recycled water reuse rate (%)",
            "Biosolids beneficial reuse (%)",
            "Energy recovered (MWh)",
            "Resource recovery revenue ($)",
          ],
          personas: [
            "Head of Circular Economy",
            "Resource Recovery Manager",
            "Chief Sustainability Officer",
          ],
        },
        {
          name: "Community & Social Value",
          useCases: [
            {
              name: "Liveability Impact Assessment",
              description:
                "Measure and report the utility's contribution to community liveability through water quality, green space irrigation, recreational water, flood mitigation, and public amenity outcomes.",
            },
            {
              name: "Hardship & Affordability Analytics",
              description:
                "Identify customers experiencing financial hardship using billing patterns, payment history, and demographic data to proactively offer support programmes and flexible payment arrangements.",
              businessValue:
                "Reduced bad debt and improved social outcomes through early intervention in hardship cases.",
            },
            {
              name: "Emergent Market Identification",
              description:
                "Analyse trends in water reuse, waste-to-energy, nutrient recovery, and carbon markets to identify new revenue streams and circular economy business models.",
            },
          ],
          kpis: [
            "Community satisfaction score",
            "Hardship programme participation rate",
            "Social value generated ($)",
            "New circular economy revenue streams",
          ],
          personas: [
            "Head of Community & Social Impact",
            "Chief Customer Officer",
            "Head of Strategy",
          ],
        },
      ],
    },
    // ------------------------------------------------------------------
    // Objective 7 -- Capital Delivery & Financial Sustainability
    // ------------------------------------------------------------------
    {
      name: "Transform Capital Delivery & Financial Sustainability",
      whyChange:
        "Water utilities face escalating capital programmes -- dam safety upgrades, grid expansion, supply augmentation -- while operating under regulatory price-path constraints and rising input costs. Portfolio-level capital management, procurement excellence, and financial resilience analytics are essential to deliver multi-billion-dollar infrastructure programmes on time and within budget, maintain investment-grade credit, and fund growth without unsustainable debt.",
      priorities: [
        {
          name: "Capital Program Portfolio Management",
          useCases: [
            {
              name: "Capital Program Performance Analytics",
              description:
                "Track budget-vs-actual, schedule variance, and delivery capacity across the full capital portfolio, detecting underspend patterns and resource bottlenecks to enable proactive reallocation across 250+ stakeholder programmes.",
              businessValue:
                "3-5% capital efficiency gain through portfolio-level optimisation, equating to $20-30M annually on a $500M+ programme.",
              typicalDataEntities: [
                "Project Budget & Actuals",
                "Schedule Milestones",
                "Resource Allocation",
                "Delivery Capacity Metrics",
              ],
              typicalSourceSystems: ["PPM Platform (Planisware)", "ERP", "Project Controls"],
            },
            {
              name: "Dam Improvement Program Scheduling & Compliance",
              description:
                "Model schedule, cost, and regulatory compliance across multi-year dam safety investment portfolios, tracking intervention sequencing against regulatory deadlines and risk ratings.",
              businessValue:
                "On-time delivery of dam safety programmes avoids regulatory penalties and protects social licence for annual revenue streams.",
              typicalDataEntities: [
                "Dam Safety Risk Ratings",
                "Regulatory Deadlines",
                "Intervention Schedules",
                "Capital Allocation",
              ],
              typicalSourceSystems: [
                "PPM Platform (Planisware)",
                "Dam Safety Database",
                "Regulatory Compliance System",
              ],
            },
            {
              name: "Capital Packaging & Strategic Sourcing",
              description:
                "Evaluate strategic project packaging options, early contractor involvement models, alliance structures, and risk-sharing mechanisms to capture procurement efficiencies across like-for-like capital works.",
              typicalDataEntities: [
                "Project Scope & Requirements",
                "Supplier Capability Register",
                "Historical Tender Outcomes",
                "Market Capacity Data",
              ],
              typicalSourceSystems: [
                "PPM Platform (Planisware)",
                "Source-to-Pay Platform (Zycus)",
                "Supplier Management System",
              ],
            },
            {
              name: "Portfolio Resource & Contractor Capacity Planning",
              description:
                "Model cross-project resource demand, contractor pipeline availability, and capability gaps to inform workforce planning and supplier engagement strategies across the capital programme.",
              typicalDataEntities: [
                "Resource Demand Profiles",
                "Contractor Capacity",
                "Skills & Capability Register",
                "Project Timeline Overlaps",
              ],
              typicalSourceSystems: [
                "PPM Platform (Planisware)",
                "HR System",
                "Supplier Management System",
              ],
            },
          ],
          kpis: [
            "Capital programme delivery rate (% of budget deployed)",
            "Schedule variance by project tier",
            "Dam improvement compliance (%)",
            "Capital efficiency ratio (risk reduction per $ invested)",
          ],
          personas: [
            "Head of Capital Delivery",
            "VP Infrastructure",
            "Chief Financial Officer",
            "Program Director",
          ],
        },
        {
          name: "Finance, Procurement & Business Process Automation",
          useCases: [
            {
              name: "RPA for Finance & Procurement Operations",
              description:
                "Deploy robotic process automation for invoice data extraction and validation, purchase order creation and routing, vendor master data updates, and monthly financial close activities, targeting 80% straight-through processing rates.",
              businessValue:
                "20-30% productivity improvement in targeted processes with 6-12 month payback; $1.5-2M annual labour redeployment value.",
              typicalDataEntities: [
                "Invoices",
                "Purchase Orders",
                "Vendor Master Data",
                "General Ledger Entries",
              ],
              typicalSourceSystems: [
                "ERP",
                "Source-to-Pay Platform (Zycus)",
                "Document Management System",
              ],
            },
            {
              name: "Procurement Category Management & Spend Analytics",
              description:
                "Establish 8-10 strategic procurement categories with AI-driven spend analysis, supplier performance benchmarking, demand aggregation, and total cost of ownership modelling to capture savings across $500M+ annual procurement.",
              businessValue:
                "5-8% addressable spend savings over 2-3 years; $18-20M annually on $500M procurement base.",
              typicalDataEntities: [
                "Spend Data by Category",
                "Supplier Performance Metrics",
                "Contract Terms",
                "Market Benchmarks",
              ],
              typicalSourceSystems: [
                "Source-to-Pay Platform (Zycus)",
                "ERP",
                "Contract Management System",
              ],
            },
            {
              name: "Source-to-Pay Process Optimisation",
              description:
                "Monitor end-to-end procurement workflow performance from requisition to payment, identifying bottlenecks, exception rates, and cross-system integration failures to continuously improve cycle times and compliance.",
              typicalDataEntities: [
                "Requisition-to-PO Cycle Times",
                "Approval Workflows",
                "Exception Rates",
                "Integration Error Logs",
              ],
              typicalSourceSystems: [
                "Source-to-Pay Platform (Zycus)",
                "ERP",
                "Workflow Management System",
              ],
            },
          ],
          kpis: [
            "Straight-through processing rate (%)",
            "Procurement cycle time (days)",
            "Addressable spend under management (%)",
            "Category savings vs baseline ($)",
          ],
          personas: [
            "Chief Procurement Officer",
            "Head of Finance",
            "VP Shared Services",
            "Automation Program Lead",
          ],
        },
        {
          name: "Financial Sustainability & Revenue Assurance",
          useCases: [
            {
              name: "Financial Sustainability Metrics & Scenario Modelling",
              description:
                "Model EBITDA interest coverage, gearing ratio, and return on equity trajectories under alternative capital expenditure, demand, and pricing scenarios to inform long-term financial strategy and debt management.",
              businessValue:
                "Maintaining financial sustainability provides capacity to self-fund $100-150M of capital through operating cashflows, reducing debt market reliance.",
              typicalDataEntities: [
                "Financial Statements",
                "Capital Program Forecasts",
                "Demand Scenarios",
                "Regulatory Price Path",
              ],
              typicalSourceSystems: ["ERP", "Treasury System", "PPM Platform (Planisware)"],
            },
            {
              name: "Demand-Driven Revenue Forecasting",
              description:
                "Reduce demand forecast error from +/-10% to +/-5% using real-time consumption telemetry, weather data, population growth models, and seasonal patterns to improve revenue certainty and operational planning.",
              businessValue:
                "Reducing forecast error prevents both over-investment in unused capacity and under-capacity emergencies, each carrying $50M+ consequences.",
              typicalDataEntities: [
                "Real-Time Consumption Data",
                "Weather Forecasts",
                "Population Growth Projections",
                "Historical Demand Patterns",
              ],
              typicalSourceSystems: [
                "SCADA",
                "Billing System",
                "Weather Services",
                "Planning & Development Data",
              ],
            },
            {
              name: "Productivity Improvement Tracking & Peer Benchmarking",
              description:
                "Track cost-to-serve ratio, annual productivity growth, and operating expenditure trends, benchmarking against peer utilities to identify efficiency opportunities and validate transformation ROI.",
              businessValue:
                "Matching peer productivity growth of 1.5% annually equates to $6-8M in avoided cost growth on a $400M+ operating base.",
              typicalDataEntities: [
                "Operating Cost Breakdown",
                "Productivity Metrics",
                "Peer Utility Benchmarks",
                "Regulatory Reporting Data",
              ],
              typicalSourceSystems: [
                "ERP",
                "Regulatory Reporting",
                "Industry Benchmarking Database",
              ],
            },
          ],
          kpis: [
            "EBITDA interest coverage ratio",
            "Gearing ratio (%)",
            "Return on equity (%)",
            "Demand forecast accuracy (+/- %)",
            "Annual productivity growth (%)",
          ],
          personas: [
            "Chief Financial Officer",
            "Head of Treasury",
            "VP Strategy & Performance",
            "Regulatory Affairs Director",
          ],
        },
      ],
    },
  ],
};
