import type { IndustryOutcome } from "./index";

export const MINING: IndustryOutcome = {
  id: "mining",
  name: "Mining & Resources",
  subVerticals: [
    "Iron Ore",
    "Coal (Metallurgical & Thermal)",
    "Copper & Base Metals",
    "Gold & Precious Metals",
    "Lithium & Battery Minerals",
    "Alumina & Aluminium",
    "Nickel & Cobalt",
    "Manganese & Alloys",
  ],
  suggestedDomains: [
    "Mining Operations",
    "Processing & Metallurgy",
    "Supply Chain & Logistics",
    "Safety & Environment",
    "Exploration & Geoscience",
    "Finance & Commercial",
  ],
  suggestedPriorities: [
    "Optimize Operations",
    "Reduce Cost",
    "Achieve Zero Harm",
    "Achieve ESG",
    "Increase Revenue",
    "Drive Autonomous Operations",
  ],
  objectives: [
    {
      name: "Optimize Mine Operations",
      whyChange:
        "Mining productivity has stagnated despite rising capital intensity. Equipment utilisation rates across the industry average 40-60%, and unplanned downtime costs large operators hundreds of millions annually. Data-driven mine planning, fleet management, and processing optimisation unlock step-change improvements in throughput and unit cost.",
      priorities: [
        {
          name: "Mine Planning & Grade Control",
          useCases: [
            {
              name: "Grade Control Optimisation",
              description:
                "Integrate blast-hole sampling, assay results, and block model data to minimise ore dilution and loss at the dig face, ensuring planned versus actual grade reconciliation.",
              businessValue: "2-5% improvement in head grade recovery.",
              typicalDataEntities: [
                "Block Models",
                "Blast-Hole Assays",
                "Grade Control Samples",
                "Dig Plans",
              ],
              typicalSourceSystems: ["Mine Planning System", "LIMS", "Fleet Management System"],
            },
            {
              name: "Drill & Blast Optimisation",
              description:
                "Use ML models on geology, explosive properties, and fragmentation outcomes to optimise drill patterns, charge designs, and blast timing for target fragmentation at minimum cost.",
              businessValue: "10-15% reduction in drilling and blasting costs.",
              typicalDataEntities: [
                "Drill Logs",
                "Blast Design Parameters",
                "Fragmentation Analysis",
                "Vibration Monitoring",
              ],
              typicalSourceSystems: ["Drill Control System", "Blast Design Software", "Geotechnical System"],
            },
            {
              name: "Short-Range Mine Scheduling",
              description:
                "Dynamically optimise weekly and daily dig schedules by blending grade, material movement, equipment availability, and processing plant requirements.",
              typicalDataEntities: [
                "Block Model Inventory",
                "Equipment Availability",
                "Plant Feed Requirements",
                "Haulage Constraints",
              ],
              typicalSourceSystems: ["Mine Planning System", "Fleet Management System", "ERP"],
            },
            {
              name: "Stockpile Management & Blending",
              description:
                "Track stockpile grades, volumes, and locations in real-time to optimise blending strategies that meet product quality specifications while maximising value.",
              typicalDataEntities: [
                "Stockpile Surveys",
                "Assay Results",
                "Product Specifications",
                "Reclaim History",
              ],
              typicalSourceSystems: ["LIMS", "Survey System", "Mine Planning System"],
            },
          ],
          kpis: [
            "Head grade vs plan (%)",
            "Ore dilution (%)",
            "Material movement (BCM/hr)",
            "Blast fragmentation P80",
          ],
          personas: ["VP Mining", "Chief Mining Engineer", "Head of Mine Planning"],
        },
        {
          name: "Fleet Management & Autonomous Operations",
          useCases: [
            {
              name: "Fleet Dispatch Optimisation",
              description:
                "Optimise real-time allocation of haul trucks, loaders, and ancillary equipment across pits, dumps, and crushers to maximise fleet productivity and minimise queuing.",
              businessValue: "8-12% improvement in fleet utilisation.",
              typicalDataEntities: [
                "Truck GPS/Telemetry",
                "Load/Cycle Times",
                "Queue Times",
                "Road Conditions",
              ],
              typicalSourceSystems: ["Fleet Management System", "Dispatch System", "GPS Platform"],
            },
            {
              name: "Autonomous Haulage Analytics",
              description:
                "Monitor and optimise autonomous haul truck fleets using telemetry, path planning, and interaction zone data to maximise throughput and safety.",
              businessValue: "15-20% improvement in haulage productivity.",
              typicalDataEntities: [
                "AHS Telemetry",
                "Path Plans",
                "Interaction Zone Events",
                "Payload Data",
              ],
              typicalSourceSystems: ["AHS Platform", "Fleet Management System", "Safety System"],
            },
            {
              name: "Tyre & Component Life Prediction",
              description:
                "Predict tyre and major component remaining useful life using load, speed, road condition, and temperature data to optimise replacement scheduling.",
              typicalDataEntities: [
                "Tyre Pressure/Temperature",
                "TKPH Data",
                "Road Condition Scores",
                "Component Life History",
              ],
              typicalSourceSystems: ["TPMS", "Fleet Management System", "CMMS"],
            },
          ],
          kpis: [
            "Fleet utilisation (%)",
            "Tonnes per operating hour",
            "Truck queue time",
            "Tyre cost per tonne",
          ],
          personas: ["Head of Mining Operations", "Autonomous Operations Manager", "Chief Operating Officer"],
        },
        {
          name: "Processing Plant Optimisation",
          useCases: [
            {
              name: "Throughput & Recovery Optimisation",
              description:
                "Use real-time process data and ML models to optimise crusher, mill, and concentrator settings for maximum throughput and mineral recovery within quality constraints.",
              businessValue: "1-3% improvement in processing recovery.",
              typicalDataEntities: [
                "Process Sensor Readings",
                "Feed Grade/Tonnage",
                "Recovery Metrics",
                "Reagent Consumption",
              ],
              typicalSourceSystems: ["SCADA/DCS", "Historian", "LIMS"],
            },
            {
              name: "Mill Liner & Wear Part Optimisation",
              description:
                "Predict wear rates on mill liners, crusher mantles, and screen media using throughput, ore hardness, and sensor data to optimise replacement timing.",
              typicalDataEntities: [
                "Wear Measurements",
                "Throughput History",
                "Ore Hardness (BWi/Ai)",
                "Maintenance History",
              ],
              typicalSourceSystems: ["CMMS", "Historian", "LIMS"],
            },
            {
              name: "Energy Intensity Reduction",
              description:
                "Identify and reduce energy waste in comminution, pumping, and ventilation circuits through granular metering, benchmarking, and AI-driven setpoint optimisation.",
              businessValue: "10-15% reduction in processing energy costs.",
              typicalDataEntities: [
                "Energy Metering",
                "Process Parameters",
                "Production Volumes",
                "Energy Benchmarks",
              ],
              typicalSourceSystems: ["EMS/BMS", "SCADA", "Historian"],
            },
          ],
          kpis: [
            "Processing recovery (%)",
            "Throughput (t/hr)",
            "Energy per tonne (kWh/t)",
            "Reagent cost per tonne",
          ],
          personas: ["VP Processing", "Metallurgical Manager", "Head of Technical Services"],
        },
      ],
    },
    {
      name: "Achieve Zero Harm",
      whyChange:
        "Mining remains one of the most hazardous industries globally. Fatigue, vehicle interactions, ground control failures, and exposure to hazardous substances cause serious injuries and fatalities. AI-driven safety systems, predictive risk analytics, and tailings monitoring are critical to protecting workers and communities.",
      priorities: [
        {
          name: "Safety & Risk Prediction",
          useCases: [
            {
              name: "Safety Event Prediction",
              description:
                "Use ML models on near-miss reports, hazard observations, operational telemetry, and environmental conditions to predict high-risk shifts, locations, and activities before incidents occur.",
              businessValue: "20-30% reduction in recordable safety incidents.",
              typicalDataEntities: [
                "Incident/Near-Miss Reports",
                "Hazard Observations",
                "Operational Parameters",
                "Environmental Conditions",
              ],
              typicalSourceSystems: ["HSE System", "Fleet Management System", "SCADA"],
            },
            {
              name: "Fatigue & Fitness-for-Duty Management",
              description:
                "Integrate fatigue monitoring devices, roster patterns, travel data, and sleep assessments to predict fatigue risk and intervene proactively.",
              typicalDataEntities: [
                "Fatigue Monitoring Alerts",
                "Roster/Shift Patterns",
                "Travel Records",
                "Fitness Assessments",
              ],
              typicalSourceSystems: ["Fatigue Management System", "HRIS", "Access Control"],
            },
            {
              name: "Vehicle Interaction & Collision Avoidance",
              description:
                "Analyse proximity detection data, traffic patterns, and near-miss events to identify high-risk interaction zones and optimise traffic management plans.",
              typicalDataEntities: [
                "Proximity Detection Events",
                "Vehicle Telemetry",
                "Traffic Zone Data",
                "Interaction Alerts",
              ],
              typicalSourceSystems: ["CAS/PDS System", "Fleet Management System", "Safety System"],
            },
          ],
          kpis: [
            "TRIFR (Total Recordable Injury Frequency Rate)",
            "LTIFR (Lost Time Injury Frequency Rate)",
            "Critical risk verification (%)",
            "Fatigue intervention rate",
          ],
          personas: ["VP Health & Safety", "Chief Safety Officer", "Head of Risk"],
        },
        {
          name: "Tailings & Geotechnical Stability",
          useCases: [
            {
              name: "Tailings Dam Monitoring & Early Warning",
              description:
                "Integrate piezometer, inclinometer, InSAR, seepage, and weather data with ML models to detect anomalous behaviour in tailings storage facilities and trigger early warnings.",
              businessValue: "Catastrophic risk mitigation -- existential for licence to operate.",
              typicalDataEntities: [
                "Piezometer Readings",
                "InSAR/LiDAR Deformation",
                "Seepage Monitoring",
                "Weather Data",
              ],
              typicalSourceSystems: ["Geotechnical Monitoring System", "InSAR Platform", "Weather Station"],
            },
            {
              name: "Pit Slope Stability Monitoring",
              description:
                "Combine radar, prism, and extensometer data with geological models to predict slope movement and inform safe mining limits.",
              typicalDataEntities: [
                "Slope Radar Data",
                "Prism Survey Points",
                "Geological Model",
                "Rainfall Data",
              ],
              typicalSourceSystems: ["Slope Stability Radar", "Survey System", "Geotechnical System"],
            },
          ],
          kpis: [
            "Tailings facility compliance score",
            "Slope movement alerts resolved within SLA",
            "GISTM conformance (%)",
          ],
          personas: ["Head of Geotechnical", "VP Tailings & Water", "Chief Risk Officer"],
        },
      ],
    },
    {
      name: "Optimise Supply Chain & Logistics",
      whyChange:
        "For bulk commodity miners, the mine-to-port value chain is the primary competitive battleground. Rail network constraints, port capacity, and ship scheduling directly impact revenue. Integrated planning across pit, stockpile, rail, and port can unlock billions in additional throughput from existing infrastructure.",
      priorities: [
        {
          name: "Mine-to-Port Value Chain",
          useCases: [
            {
              name: "Integrated Mine-to-Port Planning",
              description:
                "Optimise the entire value chain from pit to port -- coordinating mine scheduling, train loading, rail paths, stockyard management, and ship loading to maximise throughput and meet quality specifications.",
              businessValue: "5-10% increase in system throughput without capital expansion.",
              typicalDataEntities: [
                "Mine Production Plans",
                "Train Schedules",
                "Stockyard Inventory",
                "Vessel Lineup",
              ],
              typicalSourceSystems: [
                "Mine Planning System",
                "Rail Operations System",
                "Port Management System",
              ],
            },
            {
              name: "Rail Network Optimisation",
              description:
                "Optimise train scheduling, consist configuration, and path allocation across shared rail networks to maximise track utilisation and minimise delays.",
              typicalDataEntities: [
                "Train Telemetry",
                "Path Schedules",
                "Consist Configuration",
                "Track Condition Data",
              ],
              typicalSourceSystems: ["Rail Operations System", "Track Monitoring System", "GPS Platform"],
            },
            {
              name: "Port & Ship Loading Optimisation",
              description:
                "Optimise berth allocation, ship loading sequences, and product blending at port to maximise throughput, minimise demurrage, and meet vessel quality specifications.",
              typicalDataEntities: [
                "Vessel Lineup",
                "Berth Schedules",
                "Product Quality Data",
                "Demurrage Records",
              ],
              typicalSourceSystems: ["Port Management System", "LIMS", "Shipping System"],
            },
          ],
          kpis: [
            "System throughput (Mtpa)",
            "Demurrage cost",
            "Rail cycle time",
            "Ship loading rate (t/hr)",
          ],
          personas: ["VP Supply Chain", "Head of Integrated Planning", "Port Operations Manager"],
        },
        {
          name: "Procurement & Inventory",
          useCases: [
            {
              name: "Critical Spares Optimisation",
              description:
                "Use equipment reliability data, lead times, and criticality analysis to optimise spare parts inventory levels across remote mine sites, balancing availability against carrying cost.",
              businessValue: "15-25% reduction in inventory holding costs.",
              typicalDataEntities: [
                "Spare Parts Inventory",
                "Equipment Failure History",
                "Lead Times",
                "Criticality Ratings",
              ],
              typicalSourceSystems: ["ERP", "CMMS", "Warehouse Management System"],
            },
            {
              name: "Supplier Risk & Performance Monitoring",
              description:
                "Monitor supplier delivery performance, quality, financial health, and ESG compliance to proactively manage supply chain risk for critical mining inputs.",
              typicalDataEntities: [
                "Supplier Scorecards",
                "Delivery Performance",
                "Quality Records",
                "Financial Ratings",
              ],
              typicalSourceSystems: ["SRM", "Procurement System", "ERP"],
            },
          ],
          kpis: [
            "Inventory holding cost",
            "Critical spares availability (%)",
            "Supplier OTIF (%)",
            "Procurement cost savings",
          ],
          personas: ["Chief Procurement Officer", "VP Supply Chain", "Head of Warehouse & Logistics"],
        },
      ],
    },
    {
      name: "ESG & Sustainability",
      whyChange:
        "Mining companies face intensifying scrutiny on environmental performance, social licence, and climate transition. Scope 1-3 emissions disclosure, water stewardship, biodiversity net positive commitments, and community engagement are now prerequisites for investment, regulatory approval, and social licence to operate.",
      priorities: [
        {
          name: "Decarbonisation & Emissions Management",
          useCases: [
            {
              name: "Scope 1/2/3 Emissions Tracking & Reporting",
              description:
                "Automate greenhouse gas emissions tracking across diesel fleet, processing plant energy, purchased electricity, and value chain (shipping, downstream processing) for accurate ESG reporting.",
              typicalDataEntities: [
                "Diesel Consumption",
                "Electricity Metering",
                "Process Emissions",
                "Shipping Emissions",
              ],
              typicalSourceSystems: ["EMS", "Fleet Management System", "ERP", "Sustainability Platform"],
            },
            {
              name: "Haul Fleet Electrification & Energy Transition",
              description:
                "Model and optimise the transition from diesel haul trucks to battery-electric or hydrogen fuel cell alternatives using route profiles, energy modelling, and charging infrastructure planning.",
              typicalDataEntities: [
                "Route Profiles",
                "Energy Consumption Models",
                "Charging Infrastructure",
                "Total Cost of Ownership",
              ],
              typicalSourceSystems: ["Fleet Management System", "Energy Management System", "Mine Planning System"],
            },
          ],
          kpis: [
            "Scope 1 emissions intensity (tCO2e/t product)",
            "Diesel consumption (L/t moved)",
            "Renewable energy share (%)",
            "ESG disclosure score",
          ],
          personas: ["Chief Sustainability Officer", "VP Decarbonisation", "Head of Climate Strategy"],
        },
        {
          name: "Water & Environmental Stewardship",
          useCases: [
            {
              name: "Water Balance Optimisation",
              description:
                "Build real-time site water balance models integrating rainfall, pit inflow, process water use, recycling, and discharge to optimise water efficiency and ensure compliance with extraction and discharge limits.",
              typicalDataEntities: [
                "Water Metering",
                "Rainfall Data",
                "Pit Dewatering Volumes",
                "Discharge Quality",
              ],
              typicalSourceSystems: ["Water Management System", "Weather Station", "SCADA"],
            },
            {
              name: "Mine Rehabilitation & Closure Planning",
              description:
                "Use remote sensing, environmental monitoring, and financial modelling to plan and track progressive rehabilitation, estimate closure liabilities, and demonstrate compliance with bond requirements.",
              typicalDataEntities: [
                "Rehabilitation Progress",
                "Remote Sensing Imagery",
                "Closure Cost Estimates",
                "Bond Requirements",
              ],
              typicalSourceSystems: ["Environmental Management System", "GIS", "Finance System"],
            },
            {
              name: "Biodiversity & Land Disturbance Monitoring",
              description:
                "Track land disturbance, rehabilitation progress, and biodiversity indicators using satellite imagery, drone surveys, and field monitoring data.",
              typicalDataEntities: [
                "Land Disturbance Footprint",
                "Rehabilitation Monitoring",
                "Flora/Fauna Surveys",
                "Satellite Imagery",
              ],
              typicalSourceSystems: ["GIS", "Environmental Management System", "Remote Sensing Platform"],
            },
          ],
          kpis: [
            "Water recycling rate (%)",
            "Land rehabilitated vs disturbed (ha)",
            "Closure liability accuracy",
            "Environmental incident count",
          ],
          personas: ["VP Environment", "Head of Water Management", "Chief Sustainability Officer"],
        },
      ],
    },
    {
      name: "Exploration & Resource Development",
      whyChange:
        "Discovery costs have risen 5x over the past two decades while success rates have declined. AI-driven target generation, automated geological interpretation, and data integration across geochemistry, geophysics, and remote sensing offer the opportunity to find more with less and extend mine life.",
      priorities: [
        {
          name: "Geoscience & Exploration Intelligence",
          useCases: [
            {
              name: "Exploration Target Generation",
              description:
                "Apply ML to multi-layer geoscience data (geochemistry, geophysics, remote sensing, structural geology) to generate and rank prospective exploration targets.",
              businessValue: "2-3x improvement in drill target success rate.",
              typicalDataEntities: [
                "Geochemical Surveys",
                "Geophysical Surveys",
                "Remote Sensing Data",
                "Structural Geology",
              ],
              typicalSourceSystems: ["Geological Database", "Geophysical Processing System", "GIS"],
            },
            {
              name: "Resource Estimation & Block Model Optimisation",
              description:
                "Enhance resource estimation accuracy by integrating drill-hole data, geological interpretation, and advanced geostatistics with ML-assisted variography and domain modelling.",
              typicalDataEntities: [
                "Drill-Hole Assays",
                "Geological Domains",
                "Variograms",
                "Block Model Parameters",
              ],
              typicalSourceSystems: ["Geological Database", "Resource Estimation Software", "LIMS"],
            },
            {
              name: "Automated Core Logging & Lithology Classification",
              description:
                "Use computer vision and hyperspectral imaging on drill core to automate lithology classification, alteration mapping, and mineralogy, reducing manual logging time and improving consistency.",
              typicalDataEntities: [
                "Core Photos",
                "Hyperspectral Data",
                "Geological Logs",
                "Mineral Assays",
              ],
              typicalSourceSystems: ["Core Scanning System", "Geological Database", "LIMS"],
            },
          ],
          kpis: [
            "Discovery cost per resource ounce/tonne",
            "Drill target success rate (%)",
            "Resource confidence upgrade rate",
            "Core logging throughput (m/day)",
          ],
          personas: ["VP Exploration", "Chief Geologist", "Head of Geoscience"],
        },
      ],
    },
    {
      name: "Streamline Business Functions",
      whyChange:
        "Mining companies operate across remote, multi-jurisdictional sites with complex regulatory requirements, joint venture structures, and volatile commodity markets. AI-powered financial analytics, regulatory compliance automation, and workforce planning reduce overhead and improve decision speed.",
      priorities: [
        {
          name: "Financial Analytics & Commercial",
          useCases: [
            {
              name: "Commodity Price Forecasting & Risk Management",
              description:
                "Forecast commodity price movements using market data, supply-demand fundamentals, macroeconomic indicators, and sentiment analysis to inform hedging strategies and capital allocation.",
              typicalDataEntities: [
                "Commodity Prices",
                "Supply-Demand Fundamentals",
                "Macro Indicators",
                "Hedging Positions",
              ],
              typicalSourceSystems: ["Market Data Feed", "Treasury System", "ERP"],
            },
            {
              name: "Financial Planning & Forecasting",
              description:
                "Improve financial planning accuracy with AI-driven forecasting incorporating production plans, commodity prices, FX rates, and operational cost drivers.",
              typicalDataEntities: [
                "Financial Actuals",
                "Production Plans",
                "Commodity Forecasts",
                "Cost Drivers",
              ],
              typicalSourceSystems: ["ERP", "Mine Planning System", "Treasury System"],
            },
          ],
          kpis: [
            "Forecast accuracy (production & financial)",
            "Cost per tonne",
            "EBITDA margin",
            "Working capital days",
          ],
          personas: ["Chief Financial Officer", "VP Commercial", "Head of Treasury"],
        },
        {
          name: "Regulatory & Compliance",
          useCases: [
            {
              name: "Mining Regulatory Compliance Automation",
              description:
                "Automate tracking and evidence collection for mining lease conditions, environmental approvals, work health and safety regulations, and community agreements across jurisdictions.",
              typicalDataEntities: [
                "Regulatory Requirements",
                "Compliance Evidence",
                "Approval Conditions",
                "Inspection Records",
              ],
              typicalSourceSystems: ["GRC Platform", "HSE System", "Environmental Management System"],
            },
            {
              name: "Community & Stakeholder Engagement Analytics",
              description:
                "Track community commitments, grievances, social investment spend, and engagement activities to maintain social licence and meet regulatory requirements for community benefit sharing.",
              typicalDataEntities: [
                "Community Agreements",
                "Grievance Records",
                "Social Investment Spend",
                "Engagement Activities",
              ],
              typicalSourceSystems: ["Stakeholder Management System", "GRC Platform", "Finance System"],
            },
          ],
          kpis: [
            "Regulatory compliance rate (%)",
            "Community grievance resolution time",
            "Social investment as % of revenue",
            "Audit finding closure rate",
          ],
          personas: ["VP External Affairs", "Head of Compliance", "General Counsel"],
        },
        {
          name: "Asset Reliability & Maintenance",
          useCases: [
            {
              name: "Predictive Maintenance for Heavy Mobile Equipment",
              description:
                "Predict failures on haul trucks, excavators, drills, and loaders using onboard telemetry, oil analysis, vibration data, and maintenance history to reduce unplanned downtime.",
              businessValue: "25-40% reduction in unplanned downtime.",
              typicalDataEntities: [
                "Equipment Telemetry",
                "Oil Analysis Results",
                "Vibration Data",
                "Work Order History",
              ],
              typicalSourceSystems: ["Fleet Management System", "CMMS", "Condition Monitoring System"],
            },
            {
              name: "Predictive Maintenance for Fixed Plant",
              description:
                "Monitor processing plant equipment (mills, crushers, conveyors, pumps) using vibration, thermography, ultrasonic, and process data to predict failures and optimise maintenance scheduling.",
              businessValue: "30-50% reduction in unplanned processing plant downtime.",
              typicalDataEntities: [
                "Vibration Signatures",
                "Thermography",
                "Process Parameters",
                "Failure History",
              ],
              typicalSourceSystems: ["Condition Monitoring System", "SCADA", "CMMS"],
            },
          ],
          kpis: [
            "Physical availability (%)",
            "Mean time between failure (MTBF)",
            "Maintenance cost per tonne",
            "Planned vs unplanned maintenance ratio",
          ],
          personas: ["VP Maintenance", "Head of Asset Management", "Reliability Engineering Manager"],
        },
      ],
    },
  ],
};
