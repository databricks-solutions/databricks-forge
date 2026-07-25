import type { IndustryOutcome } from "./index";

export const RAIL_TRANSPORT: IndustryOutcome = {
  id: "rail-transport",
  name: "Rail Transport & Logistics",
  subVerticals: [
    "Freight Rail",
    "Heavy Haul & Bulk Freight",
    "Passenger Rail",
    "Rail Infrastructure & Signalling",
    "Intermodal Logistics",
    "Network Access & Regulation",
  ],
  suggestedDomains: [
    "Network Operations",
    "Asset Management",
    "Customer Experience",
    "Safety & Compliance",
    "Supply Chain",
    "Finance",
    "ESG & Sustainability",
    "Workforce & Remote Operations",
  ],
  suggestedPriorities: [
    "Optimize Operations",
    "Reduce Cost",
    "Increase Revenue",
    "Mitigate Risk",
    "Achieve ESG",
    "Enhance Customer Experience",
  ],
  objectives: [
    {
      name: "Optimize Network & Train Operations",
      whyChange:
        "Heavy-haul and freight rail networks manage complex, interdependent train plans across export corridors (e.g., CQCN coal systems, Tarcoola–Darwin) and multi-user regulated infrastructure. A single delay cascades into reduced throughput, port berthing misses, and contractual penalties. AI-driven scheduling, real-time operations management, capacity optimization, and workforce planning are essential to improve punctuality, throughput, energy efficiency, and regulatory access compliance.",
      priorities: [
        {
          name: "Train Performance & Scheduling",
          useCases: [
            {
              name: "Timetable Optimization",
              description:
                "Use ML-based conflict resolution to generate optimised timetables that maximise path utilisation across complex network topologies while respecting infrastructure and rolling stock constraints.",
              businessValue:
                "5-10% increase in train paths utilised per hour on constrained corridors.",
              typicalDataEntities: [
                "Network Topology",
                "Path Constraints",
                "Rolling Stock Availability",
                "Conflict Matrix",
              ],
              typicalSourceSystems: [
                "Timetabling System",
                "Asset Management System",
                "SCADA",
                "ERP",
              ],
            },
            {
              name: "Real-Time Delay Prediction & Management",
              description:
                "Predict knock-on delays across the network using real-time train positions, infrastructure status, and historical delay propagation patterns, recommending recovery actions to controllers.",
              businessValue:
                "20-30% reduction in secondary delay minutes through proactive intervention.",
              typicalDataEntities: [
                "Train Positions",
                "Infrastructure Status",
                "Delay History",
                "Recovery Actions",
              ],
              typicalSourceSystems: [
                "SCADA",
                "TMS",
                "Signalling System",
                "Asset Management System",
              ],
            },
            {
              name: "Heavy-Haul Train Dynamics & Pathing",
              description:
                "Optimise consist length, distributed power configuration, and speed profiles for long heavy-haul coal and bulk routes using gradient data, axle load limits, and corridor capacity models.",
              businessValue:
                "3-5% improvement in gross tonnage per train path through optimised consist planning.",
              typicalDataEntities: [
                "Gradient Data",
                "Axle Load Limits",
                "Corridor Capacity",
                "Consist Configuration",
              ],
              typicalSourceSystems: ["Asset Management System", "TMS", "Track Database", "SCADA"],
            },
            {
              name: "Energy-Efficient Driving Advisory",
              description:
                "Optimise speed profiles using gradient data, timetable slack, and rolling stock characteristics to reduce traction energy consumption while maintaining punctuality.",
              businessValue:
                "10-15% traction energy savings through optimised coasting and braking strategies.",
              typicalDataEntities: [
                "Gradient Profiles",
                "Timetable Slack",
                "Rolling Stock Specs",
                "Energy Consumption",
              ],
              typicalSourceSystems: [
                "TMS",
                "Track Database",
                "Asset Management System",
                "Energy Management System",
              ],
            },
            {
              name: "Port Interface & Terminal Coordination",
              description:
                "Integrate ship schedules, stockpile levels, and corridor train plans to optimise the handoff between rail network and export terminals, reducing demurrage and improving port throughput.",
              businessValue:
                "10-20% reduction in port demurrage costs through coordinated rail-terminal scheduling.",
              typicalDataEntities: [
                "Ship Schedules",
                "Stockpile Levels",
                "Train Plans",
                "Berth Availability",
              ],
              typicalSourceSystems: ["Port Management System", "TMS", "Terminal SCADA", "ERP"],
            },
          ],
          kpis: [
            "PPM / on-time performance (%)",
            "Minutes of delay per incident",
            "Train paths utilised per hour",
            "Energy consumption per train-km",
          ],
          personas: ["Head of Operations", "VP Train Planning", "Chief Operating Officer"],
        },
        {
          name: "Freight Operations & Yard Management",
          useCases: [
            {
              name: "Freight Train Scheduling Optimization",
              description:
                "Balance freight and passenger train paths across capacity-constrained corridors using AI to maximise freight throughput without degrading passenger performance.",
              typicalDataEntities: [
                "Path Allocations",
                "Corridor Capacity",
                "Freight Demand",
                "Passenger Timetables",
              ],
              typicalSourceSystems: [
                "TMS",
                "Timetabling System",
                "Freight Management System",
                "SCADA",
              ],
            },
            {
              name: "Yard Operations Automation",
              description:
                "Optimise shunting movements, marshalling sequences, and wagon sorting using real-time yard telemetry and ML to reduce dwell time and increase throughput.",
            },
            {
              name: "Wagon Utilisation Analytics",
              description:
                "Track empty running, dwell time, and turnaround cycles to identify underutilised assets and maximise wagon productivity across the fleet.",
            },
            {
              name: "Intermodal Terminal Optimization",
              description:
                "Optimise crane scheduling, container stacking, and truck slot allocation at intermodal terminals using real-time data to reduce terminal dwell time and improve throughput.",
            },
            {
              name: "Contract-Aware Scheduling",
              description:
                "Build freight train paths that respect take-or-pay obligations, slot rights, and access undertaking constraints, ensuring contractual commitments are met while maximising network utilisation.",
              businessValue:
                "Reduce contractual penalty exposure and improve take-or-pay volume compliance by 5-10%.",
            },
          ],
          kpis: [
            "Freight train reliability (%)",
            "Yard dwell time (hours)",
            "Wagon utilisation rate (%)",
            "Terminal throughput (lifts per hour)",
            "Take-or-pay compliance (%)",
          ],
          personas: ["Head of Freight", "VP Terminal Operations", "Chief Operating Officer"],
        },
        {
          name: "Regulated Network Capacity & Access Management",
          useCases: [
            {
              name: "Capacity Assessment & Queuing Analytics",
              description:
                "Model multi-user capacity on regulated corridors, queue and prioritise access requests, and report utilisation transparently to access holders and regulators.",
              businessValue:
                "Improved access request turnaround and 10-15% better capacity utilisation on constrained coal systems.",
              typicalDataEntities: [
                "Corridor Capacity",
                "Access Requests",
                "Utilisation Reports",
                "Queue Priorities",
              ],
              typicalSourceSystems: [
                "TMS",
                "Access Management System",
                "SCADA",
                "Regulatory Reporting",
              ],
            },
            {
              name: "Performance Rebate & Access Charge Optimization",
              description:
                "Track corridor performance against access undertaking benchmarks, calculate rebate and penalty exposure in real time, and identify operational levers to optimise outcomes for network and above-rail operators.",
              typicalDataEntities: [
                "Performance Benchmarks",
                "Rebate Calculations",
                "Penalty Exposure",
                "Access Charges",
              ],
              typicalSourceSystems: [
                "TMS",
                "Access Management System",
                "ERP",
                "Regulatory Reporting",
              ],
            },
            {
              name: "Maintenance Window vs Throughput Scenario Planning",
              description:
                "Simulate the throughput impact of planned possessions and maintenance windows across coal systems and port interfaces, balancing asset renewal needs with contractual throughput obligations.",
              businessValue:
                "5-8% reduction in throughput loss during planned maintenance through optimised possession scheduling.",
              typicalDataEntities: [
                "Possession Schedule",
                "Throughput Models",
                "Contract Obligations",
                "Asset Renewal Plan",
              ],
              typicalSourceSystems: [
                "Asset Management System",
                "TMS",
                "Maintenance Planning",
                "ERP",
              ],
            },
          ],
          kpis: [
            "System throughput (NTK)",
            "Capacity utilisation (%)",
            "Access request lead time (days)",
            "Rebate / penalty exposure ($)",
          ],
          personas: ["Head of Network", "VP Regulatory & Access", "Network Capacity Manager"],
        },
        {
          name: "Workforce & Remote Operations",
          useCases: [
            {
              name: "Crew Rostering & Fatigue Risk Optimization",
              description:
                "Optimise crew rosters for long-distance heavy-haul corridors, modelling fatigue risk, remote changeover logistics, and regulatory hours-of-work limits to maintain safety and crew wellbeing.",
              businessValue:
                "15-20% reduction in fatigue-related risk events through data-driven roster optimisation.",
              typicalDataEntities: [
                "Crew Rosters",
                "Fatigue Risk Scores",
                "Hours of Work",
                "Changeover Locations",
              ],
              typicalSourceSystems: [
                "Crew Management System",
                "HR System",
                "TMS",
                "Safety Management System",
              ],
            },
            {
              name: "Remote Operations Centre Decision Support",
              description:
                "Provide AI copilots for train controllers and dispatchers managing remote corridors, surfacing real-time alerts, recommending recovery plans, and reducing cognitive load during complex operational scenarios.",
              typicalDataEntities: [
                "Real-Time Alerts",
                "Recovery Plans",
                "Network State",
                "Incident History",
              ],
              typicalSourceSystems: [
                "SCADA",
                "TMS",
                "Signalling System",
                "Asset Management System",
              ],
            },
          ],
          kpis: [
            "Fatigue risk incidents",
            "Crew utilisation (%)",
            "Remote corridor response time",
            "Controller decision latency",
          ],
          personas: [
            "Head of Workforce Planning",
            "Remote Operations Manager",
            "Chief Operating Officer",
          ],
        },
      ],
    },
    {
      name: "Transform Asset Management & Maintenance",
      whyChange:
        "Rail operators manage billions in infrastructure — track, signalling, bridges, tunnels — and rolling stock, often across remote linear corridors subject to heavy axle loads and extreme environmental conditions. Unplanned failures cause major disruptions, safety risks, and contractual penalties. 30-40% of maintenance budgets are spent on time-based rather than condition-based interventions. Predictive analytics can cut maintenance costs by 20-30% while improving asset reliability and network availability.",
      priorities: [
        {
          name: "Rolling Stock Health",
          useCases: [
            {
              name: "Predictive Maintenance for Fleet",
              description:
                "Predict component failures from onboard sensors, SCADA telemetry, and maintenance history using ML models, shifting from time-based to condition-based maintenance regimes.",
              businessValue:
                "$30-50M annual savings for major operators through reduced unplanned maintenance and improved fleet availability.",
              typicalDataEntities: [
                "Asset Condition Data",
                "Maintenance History",
                "IoT Sensor Feeds",
                "Failure Predictions",
              ],
              typicalSourceSystems: [
                "Asset Management System",
                "SCADA",
                "ERP",
                "Onboard Telemetry",
              ],
            },
            {
              name: "Wheel & Bogie Condition Monitoring",
              description:
                "Detect wheel flats, bearing degradation, and bogie faults using wayside acoustic and vibration monitoring systems, triggering maintenance before failures cause service disruption.",
              typicalDataEntities: [
                "Wayside Sensor Data",
                "Acoustic Signatures",
                "Vibration Patterns",
                "Bearing Condition",
              ],
              typicalSourceSystems: [
                "Wayside Monitoring Systems",
                "Asset Management System",
                "SCADA",
                "ERP",
              ],
            },
            {
              name: "Fleet Availability Optimization",
              description:
                "Optimise maintenance rostering, depot scheduling, and spare parts allocation to maximise the number of trains available for service each day.",
            },
          ],
          kpis: [
            "Miles per technical incident (MTIN)",
            "Fleet availability (%)",
            "Unplanned maintenance ratio",
            "Mean distance between failures",
          ],
          personas: ["Head of Fleet Engineering", "VP Rolling Stock", "Chief Mechanical Officer"],
        },
        {
          name: "Infrastructure & Track",
          useCases: [
            {
              name: "Track Geometry Deterioration Prediction",
              description:
                "Predict track geometry degradation from measurement train data, traffic tonnage, subgrade conditions, and environmental factors to optimise tamping and renewal schedules.",
            },
            {
              name: "Signalling System Health Monitoring",
              description:
                "Detect signalling equipment degradation before failure using equipment telemetry, event logs, and environmental data to prevent service-affecting faults.",
            },
            {
              name: "Bridge & Tunnel Structural Health Monitoring",
              description:
                "Continuously assess structural condition using sensor data, inspection records, and environmental loading models to prioritise maintenance and avoid costly emergency interventions.",
            },
            {
              name: "Vegetation & Lineside Management",
              description:
                "Prioritise vegetation clearance using satellite imagery, growth rate models, and leaf-fall incident history to reduce adhesion delays and lineside encroachment.",
            },
          ],
          kpis: [
            "Track quality index",
            "Signalling failure rate",
            "Temporary speed restrictions (count)",
            "Infrastructure cost per track-km",
          ],
          personas: ["Head of Infrastructure", "VP Asset Strategy", "Chief Engineer"],
        },
      ],
    },
    {
      name: "Enhance Freight Customer Experience & Commercial Performance",
      whyChange:
        "Freight customers — miners, agribusiness, and logistics providers — demand reliable train slots, transparent performance data, ESG metrics per shipment, and simple digital access to information. Heavy-haul operators competing for modal share against road must deliver a B2B experience rivalling trucking on visibility, reliability, and cost transparency. Take-or-pay contract models and long-term haulage agreements require sophisticated commercial analytics to optimise revenue and customer retention.",
      priorities: [
        {
          name: "Shipper Portal & Digital Services",
          useCases: [
            {
              name: "Real-Time Train & Consignment Tracking",
              description:
                "Provide shipper-facing dashboards with live train position, consignment status, and corridor disruption alerts via API and web portal, giving freight customers full visibility of their shipments.",
              businessValue:
                "30-40% reduction in shipper enquiries through self-service tracking and proactive notifications.",
              typicalDataEntities: [
                "Train Positions",
                "Consignment Status",
                "Disruption Alerts",
                "ETA History",
              ],
              typicalSourceSystems: ["TMS", "Freight Management System", "SCADA", "Shipper Portal"],
            },
            {
              name: "Self-Service Quoting & Lane Comparison",
              description:
                "Enable shippers to compare rail vs road options by cost, transit time, and carbon emissions per lane, driving modal shift to rail through transparent, data-backed decision support.",
            },
            {
              name: "Disruption Alerting & Recovery Communication",
              description:
                "Deliver proactive, automated notifications to freight customers with ETA revisions, alternative routing options, and recovery timelines when corridor disruptions occur.",
              businessValue: "50%+ improvement in average disruption notification lead time.",
              typicalDataEntities: [
                "Disruption Events",
                "ETA Revisions",
                "Alternative Routes",
                "Recovery Timelines",
              ],
              typicalSourceSystems: [
                "TMS",
                "SCADA",
                "Freight Management System",
                "Notification Service",
              ],
            },
            {
              name: "Shipper Performance Dashboard",
              description:
                "Provide per-customer views of on-time delivery, volume trends, SLA compliance, and ESG metrics, enabling shippers to monitor and report on their rail freight performance.",
              typicalDataEntities: [
                "Delivery Performance",
                "Volume Trends",
                "SLA Metrics",
                "ESG Data",
              ],
              typicalSourceSystems: [
                "Freight Management System",
                "TMS",
                "CRM",
                "Carbon Calculator",
              ],
            },
          ],
          kpis: [
            "Shipper NPS",
            "Digital channel adoption (%)",
            "Quote-to-book conversion rate",
            "Average notification lead time (minutes)",
          ],
          personas: [
            "Head of Customer Experience",
            "VP Freight Commercial",
            "Digital Product Manager",
          ],
        },
        {
          name: "Contract & Commercial Performance",
          useCases: [
            {
              name: "Take-or-Pay & Contract Utilisation Analytics",
              description:
                "Track contracted vs actual volumes across long-term haulage agreements, flag under/over-utilisation risks, and model rebate and penalty scenarios to optimise contract performance.",
              businessValue:
                "5-10% improvement in contract utilisation through proactive volume management.",
              typicalDataEntities: [
                "Contract Volumes",
                "Actual Volumes",
                "Rebate Models",
                "Penalty Scenarios",
              ],
              typicalSourceSystems: ["Freight Management System", "CRM", "ERP", "TMS"],
            },
            {
              name: "SLA & On-Time Performance Cockpit",
              description:
                "Provide real-time contract performance by lane with drill-down to root-cause delays, enabling proactive account management and data-driven SLA negotiations.",
              typicalDataEntities: [
                "Lane Performance",
                "Root-Cause Delays",
                "SLA Status",
                "Contract Benchmarks",
              ],
              typicalSourceSystems: [
                "TMS",
                "Freight Management System",
                "CRM",
                "Incident Database",
              ],
            },
            {
              name: "Modal Shift & Revenue Growth Analytics",
              description:
                "Identify road-to-rail conversion opportunities by corridor, commodity, and customer segment using freight market data, emissions comparisons, and capacity availability.",
              businessValue:
                "Target 2-5% incremental modal shift to rail through data-driven commercial targeting.",
              typicalDataEntities: [
                "Market Data",
                "Emissions Comparisons",
                "Capacity Availability",
                "Customer Segments",
              ],
              typicalSourceSystems: [
                "Freight Management System",
                "Market Data",
                "Carbon Calculator",
                "TMS",
              ],
            },
          ],
          kpis: [
            "Contract utilisation (%)",
            "SLA compliance (%)",
            "Revenue per NTK",
            "Modal shift conversion rate (%)",
          ],
          personas: ["Chief Commercial Officer", "Head of Freight Sales", "VP Customer Success"],
        },
      ],
    },
    {
      name: "Strengthen Safety, Security & Compliance",
      whyChange:
        "Rail safety is heavily regulated and public confidence is paramount. Signal Passed at Danger (SPAD) incidents, level crossing collisions, and infrastructure failures carry catastrophic consequences. In heavy-haul freight operations, road fleet and crew transport across remote regions add multi-modal safety risk. Predictive risk modelling, automated compliance reporting, and community safety analytics reduce incidents by 20-40% and streamline regulatory obligations.",
      priorities: [
        {
          name: "Safety Analytics",
          useCases: [
            {
              name: "SPAD Risk Prediction",
              description:
                "Predict Signal Passed at Danger likelihood from driver behaviour patterns, route geometry, signalling layout, and environmental conditions to target interventions at highest-risk locations.",
              typicalDataEntities: [
                "Driver Behaviour",
                "Route Geometry",
                "Signalling Layout",
                "Environmental Data",
              ],
              typicalSourceSystems: [
                "Signalling System",
                "Driver Monitoring",
                "Track Database",
                "Weather Service",
              ],
            },
            {
              name: "Level Crossing Risk Assessment",
              description:
                "Score level crossing risk using road traffic volumes, sighting distances, near-miss history, and population density to prioritise upgrades and closures.",
              typicalDataEntities: [
                "Traffic Volumes",
                "Sighting Distances",
                "Near-Miss History",
                "Population Data",
              ],
              typicalSourceSystems: [
                "Asset Management System",
                "Incident Database",
                "Traffic Data",
                "GIS Platform",
              ],
            },
            {
              name: "Worker Safety & Track Access Monitoring",
              description:
                "Track possessions, safe systems of work compliance, and near-miss events to prevent workforce injuries and improve track access planning.",
              typicalDataEntities: [
                "Possession Records",
                "Safe Work Compliance",
                "Near-Miss Events",
                "Track Access Plans",
              ],
              typicalSourceSystems: [
                "Possession Management",
                "Safety Management System",
                "TMS",
                "HR System",
              ],
            },
            {
              name: "Fatigue & Human Factors Analytics",
              description:
                "Analyse driver rosters, hours worked, shift patterns, and physiological indicators to identify and mitigate fatigue-related safety risk.",
            },
            {
              name: "Road Fleet Safety & Fatigue Analytics",
              description:
                "Monitor vehicle telematics, driving hours, and remote travel risk for road fleet and crew transport vehicles, aligned with multi-modal safety obligations in regions where rail crews drive long distances to reach worksites.",
              businessValue:
                "20-30% reduction in road-related safety incidents through telematics-driven intervention.",
            },
            {
              name: "Corridor Community Risk Analytics",
              description:
                "Assess trespass and level-crossing risk across remote communities along heavy-haul freight corridors, prioritising engineering controls, community engagement programs, and education campaigns.",
            },
          ],
          kpis: [
            "SPAD rate per million train-miles",
            "Workforce lost-time injuries",
            "Level crossing incidents",
            "Safety critical event rate",
            "Road fleet incident rate",
            "Community safety engagement score",
          ],
          personas: [
            "Head of Safety",
            "Chief Safety Officer",
            "VP Operations Risk",
            "Head of Network Safety",
            "Road Transport Safety Manager",
          ],
        },
        {
          name: "Regulatory Compliance & ESG",
          useCases: [
            {
              name: "Automated Safety Reporting",
              description:
                "Generate ORR/ERA and national safety authority reports from operational data pipelines with minimal manual effort, ensuring accuracy and timeliness.",
            },
            {
              name: "Carbon Emissions & Energy Reporting",
              description:
                "Automate Scope 1, 2, and 3 emissions tracking across traction energy, stations, depots, and fleet operations for net-zero target monitoring.",
            },
            {
              name: "Noise & Environmental Impact Monitoring",
              description:
                "Monitor and report noise levels, vibration, and environmental impacts along rail corridors for regulatory compliance and community engagement.",
            },
            {
              name: "Shipper Emissions Reporting & Modal Shift Analytics",
              description:
                "Provide per-customer GHG reporting showing rail vs road carbon savings per lane, powering customer-facing emissions calculators and supporting shipper sustainability targets.",
              businessValue:
                "Enable shippers to report 60-80% lower emissions per tonne-km vs road, driving modal shift.",
            },
            {
              name: "Corridor Decarbonisation Planning",
              description:
                "Model traction energy mix, renewable sourcing, locomotive idling reduction, and electrification or hydrogen scenarios at the corridor level to support net-zero operational emissions targets.",
              typicalDataEntities: [
                "Energy Mix",
                "Renewable Sourcing",
                "Idling Data",
                "Electrification Scenarios",
              ],
              typicalSourceSystems: [
                "Energy Management System",
                "TMS",
                "Asset Management System",
                "ERP",
              ],
            },
            {
              name: "Climate Resilience Analytics",
              description:
                "Assess flood, extreme heat, and cyclone exposure across network sections using climate projection models and historical event data, prioritising adaptation capex for long linear assets.",
              businessValue:
                "Reduce climate-related disruption costs by 15-25% through targeted infrastructure hardening.",
              typicalDataEntities: [
                "Climate Projections",
                "Historical Events",
                "Network Sections",
                "Asset Exposure",
              ],
              typicalSourceSystems: [
                "Climate Data Service",
                "Asset Management System",
                "Incident Database",
                "GIS Platform",
              ],
            },
          ],
          kpis: [
            "Regulatory submission timeliness",
            "Carbon intensity per NTK",
            "Environmental incident rate",
            "Shipper emissions reports generated",
            "Climate adaptation capex prioritisation score",
          ],
          personas: [
            "Head of Regulatory Affairs",
            "Chief Sustainability Officer",
            "VP Compliance",
            "Head of Climate & Environment",
          ],
        },
      ],
    },
    {
      name: "Drive Freight & Supply Chain Intelligence",
      whyChange:
        "Rail freight — particularly bulk commodities such as coal, minerals, and agricultural products across long-distance corridors like CQCN and Tarcoola–Darwin — competes with road on reliability, visibility, and flexibility. Shippers demand real-time tracking, accurate ETAs, and seamless intermodal connectivity. Data-driven freight intelligence can increase rail modal share by 5-10% and improve operator margins by 10-20%.",
      priorities: [
        {
          name: "Freight Visibility & Planning",
          useCases: [
            {
              name: "End-to-End Shipment Tracking",
              description:
                "Provide real-time consignment visibility from origin to destination across rail and intermodal legs using GPS, RFID, and network event data.",
              typicalDataEntities: [
                "Consignment Events",
                "GPS Positions",
                "RFID Reads",
                "Network Events",
              ],
              typicalSourceSystems: [
                "TMS",
                "Freight Management System",
                "Terminal Operating System",
                "Port Management System",
              ],
            },
            {
              name: "ETA Prediction for Freight",
              description:
                "Predict freight train arrival times using current network state, weather conditions, and historical performance data to provide shippers with reliable delivery windows.",
              businessValue:
                "90%+ ETA accuracy, reducing shipper buffer stock and improving supply chain planning.",
              typicalDataEntities: [
                "Network State",
                "Weather Data",
                "Historical Performance",
                "Train Positions",
              ],
              typicalSourceSystems: [
                "TMS",
                "SCADA",
                "Weather Service",
                "Freight Management System",
              ],
            },
            {
              name: "Route & Mode Optimization",
              description:
                "Recommend optimal rail, road, or intermodal routing for each shipment based on cost, transit time, carbon impact, and real-time capacity availability.",
            },
            {
              name: "Freight Demand Forecasting",
              description:
                "Forecast commodity and lane-level freight demand using economic indicators, trade flows, and seasonal patterns to optimise capacity allocation and pricing.",
              typicalDataEntities: [
                "Economic Indicators",
                "Trade Flows",
                "Historical Demand",
                "Seasonal Patterns",
              ],
              typicalSourceSystems: ["Freight Management System", "ERP", "Market Data", "TMS"],
            },
            {
              name: "Heavy-Haul Corridor Throughput Analytics",
              description:
                "Monitor NTK throughput, train cycle times, and bottleneck dwell by corridor to optimise end-to-end coal and bulk supply chain velocity from mine to port.",
              businessValue:
                "5-10% improvement in corridor throughput through data-driven bottleneck identification and resolution.",
              typicalDataEntities: [
                "NTK Throughput",
                "Cycle Times",
                "Bottleneck Dwell",
                "Corridor Metrics",
              ],
              typicalSourceSystems: ["TMS", "Freight Management System", "SCADA", "ERP"],
            },
          ],
          kpis: [
            "Freight reliability (%)",
            "ETA accuracy (%)",
            "Rail modal share (%)",
            "Freight revenue per train-km",
            "Corridor NTK throughput",
          ],
          personas: ["Head of Freight Commercial", "VP Logistics", "Chief Operating Officer"],
        },
        {
          name: "Customer & Commercial Analytics",
          useCases: [
            {
              name: "Freight Customer Segmentation",
              description:
                "Segment shippers by volume, profitability, modal shift potential, and service requirements to tailor commercial strategies and account management.",
              typicalDataEntities: [
                "Customer Profiles",
                "Volume History",
                "Profitability",
                "Service Requirements",
              ],
              typicalSourceSystems: ["Freight Management System", "CRM", "ERP", "Billing System"],
            },
            {
              name: "Dynamic Freight Pricing",
              description:
                "Optimise freight rates by corridor, commodity type, and demand intensity using ML-driven pricing models that respond to market conditions in real time.",
              typicalDataEntities: [
                "Pricing History",
                "Demand Intensity",
                "Capacity",
                "Market Rates",
              ],
              typicalSourceSystems: ["Freight Management System", "ERP", "TMS", "Market Data"],
            },
            {
              name: "Contract & SLA Performance Analytics",
              description:
                "Track contract performance, SLA compliance, and penalty exposure across the freight customer portfolio to improve commercial outcomes and retention.",
              typicalDataEntities: [
                "Contract Terms",
                "SLA Metrics",
                "Penalty Exposure",
                "Performance History",
              ],
              typicalSourceSystems: ["Freight Management System", "CRM", "TMS", "ERP"],
            },
          ],
          kpis: [
            "Customer retention rate (%)",
            "Contract profitability",
            "SLA compliance rate (%)",
            "Revenue growth per account",
          ],
          personas: ["Head of Freight Sales", "Chief Commercial Officer", "VP Customer Success"],
        },
      ],
    },
  ],
};
