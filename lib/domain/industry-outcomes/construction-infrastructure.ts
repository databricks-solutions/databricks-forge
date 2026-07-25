import type { IndustryOutcome } from "./index";

export const CONSTRUCTION_INFRASTRUCTURE: IndustryOutcome = {
  id: "construction-infrastructure",
  name: "Construction & Infrastructure",
  subVerticals: [
    "Civil Infrastructure & Heavy Construction",
    "Building & Facilities Construction",
    "Marine & Coastal Works",
    "Mining Services & Resources Infrastructure",
    "Water & Wastewater Infrastructure",
    "Transport Infrastructure (Roads, Bridges, Tunnels)",
    "Energy & Industrial Construction",
  ],
  suggestedDomains: [
    "Project Delivery",
    "Operations",
    "Safety & Compliance",
    "Supply Chain & Procurement",
    "Asset Management",
    "Finance",
    "Workforce",
    "ESG & Sustainability",
  ],
  suggestedPriorities: [
    "Optimize Operations",
    "Reduce Cost",
    "Mitigate Risk",
    "Achieve ESG",
    "Increase Revenue",
    "Enhance Safety",
  ],
  objectives: [
    {
      name: "Optimize Project Delivery & Performance",
      whyChange:
        "Construction projects overrun budgets by 80% and schedules by 20 months on average (McKinsey). The industry's productivity has remained flat for 80 years while input costs rise. With margins typically 2-5%, even small improvements in cost forecasting, schedule adherence, and resource allocation have outsized impact. Real-time project analytics and AI-driven forecasting enable proactive intervention before overruns materialise.",
      priorities: [
        {
          name: "Project Cost & Schedule Intelligence",
          useCases: [
            {
              name: "Earned Value & Cost Forecasting",
              description:
                "Predict project cost-at-completion using earned value metrics, historical project data, resource burn rates, and scope change patterns. Surface early warnings of budget deviation before they compound.",
              businessValue:
                "10-15% improvement in cost forecast accuracy, enabling proactive intervention on at-risk projects.",
              typicalDataEntities: [
                "Cost Breakdown Structure",
                "Earned Value Metrics",
                "Change Orders",
                "Forecast Models",
              ],
              typicalSourceSystems: ["ERP", "Project Controls System", "Cost Management Platform"],
            },
            {
              name: "Schedule Delay Prediction",
              description:
                "Predict schedule slippage using critical path analysis, weather forecasts, resource availability, subcontractor performance history, and permit lead times. Recommend recovery actions ranked by impact and cost.",
              businessValue:
                "20-30% reduction in schedule overruns through early identification of delay drivers.",
              typicalDataEntities: [
                "Project Schedule",
                "Critical Path Activities",
                "Weather Forecasts",
                "Resource Availability",
              ],
              typicalSourceSystems: [
                "Scheduling System (P6/MS Project)",
                "Weather Service",
                "Resource Management System",
                "ERP",
              ],
            },
            {
              name: "Multi-Project Portfolio Analytics",
              description:
                "Provide executive-level visibility across the entire project portfolio — cost health, schedule status, risk exposure, and resource utilisation — enabling data-driven capital allocation and strategic bid decisions.",
              typicalDataEntities: [
                "Project KPIs",
                "Portfolio Risk Scores",
                "Resource Utilisation",
                "Capital Allocation",
              ],
              typicalSourceSystems: [
                "ERP",
                "Project Controls System",
                "BI Platform",
                "Risk Management System",
              ],
            },
            {
              name: "Variation & Change Order Analytics",
              description:
                "Track, classify, and predict variation orders across projects using contract terms, scope definitions, and historical patterns. Identify root causes of scope creep and quantify commercial impact.",
              businessValue:
                "5-10% improvement in variation recovery rates through faster identification and stronger substantiation.",
              typicalDataEntities: [
                "Variation Orders",
                "Contract Terms",
                "Scope Definitions",
                "Approval Workflows",
              ],
              typicalSourceSystems: [
                "Contract Management System",
                "ERP",
                "Document Management System",
                "Project Controls System",
              ],
            },
          ],
          kpis: [
            "Cost variance (CV) and schedule variance (SV)",
            "Estimate at completion accuracy (%)",
            "Schedule performance index (SPI)",
            "Variation recovery rate (%)",
          ],
          personas: [
            "Project Director",
            "Head of Project Controls",
            "Chief Operating Officer",
            "Commercial Manager",
          ],
        },
        {
          name: "Site Productivity & Resource Optimization",
          useCases: [
            {
              name: "Labour Productivity Analytics",
              description:
                "Measure and benchmark labour productivity by trade, activity, and site conditions using timekeeping, progress tracking, and environmental data. Identify productivity drains and quantify the impact of interventions.",
              businessValue:
                "15-20% improvement in labour productivity through data-driven crew sizing and task sequencing.",
              typicalDataEntities: [
                "Timesheet Data",
                "Progress Measurements",
                "Trade Classifications",
                "Site Conditions",
              ],
              typicalSourceSystems: [
                "Time & Attendance System",
                "Project Management Platform",
                "HR System",
                "Weather Service",
              ],
            },
            {
              name: "Equipment Utilisation & Fleet Optimization",
              description:
                "Track heavy equipment utilisation, idle time, and inter-site movements using telematics and GPS data. Optimise fleet allocation across the project portfolio to reduce hire costs and maximise asset productivity.",
              businessValue:
                "10-15% reduction in equipment costs through improved utilisation and reduced idle time.",
              typicalDataEntities: [
                "Equipment Telematics",
                "GPS Positions",
                "Utilisation Rates",
                "Hire Agreements",
              ],
              typicalSourceSystems: [
                "Fleet Management System",
                "Telematics Platform",
                "ERP",
                "Plant Hire System",
              ],
            },
            {
              name: "Concrete & Earthworks Production Analytics",
              description:
                "Monitor batch plant output, concrete pour progress, and earthworks volumes in real time using IoT sensors and survey data. Optimise production rates against schedule requirements and quality specifications.",
              typicalDataEntities: [
                "Batch Plant Output",
                "Pour Records",
                "Survey Volumes",
                "Quality Test Results",
              ],
              typicalSourceSystems: [
                "Batch Plant System",
                "Survey Platform",
                "Quality Management System",
                "Scheduling System",
              ],
            },
            {
              name: "Weather Impact Forecasting",
              description:
                "Predict weather-related work stoppages using hyperlocal forecasts, activity sensitivity profiles, and historical weather-impact data. Enable proactive schedule adjustments and resource redeployment.",
              businessValue:
                "30-40% reduction in unproductive weather-affected hours through proactive scheduling.",
              typicalDataEntities: [
                "Weather Forecasts",
                "Activity Sensitivity Profiles",
                "Historical Impact Data",
                "Schedule Windows",
              ],
              typicalSourceSystems: [
                "Weather Service",
                "Scheduling System",
                "Project Management Platform",
              ],
            },
          ],
          kpis: [
            "Labour productivity rate (units/hour)",
            "Equipment utilisation (%)",
            "Rework rate (%)",
            "Weather-related downtime hours",
          ],
          personas: [
            "Construction Manager",
            "Site Manager",
            "Head of Plant & Equipment",
            "VP Operations",
          ],
        },
      ],
    },
    {
      name: "Transform Safety, Quality & Compliance",
      whyChange:
        "Construction accounts for a disproportionate share of workplace fatalities and serious injuries globally. Major infrastructure projects involve complex multi-employer work environments, confined spaces, working at heights, heavy plant movements, and hazardous materials. Quality defects drive 5-15% of project costs through rework. Predictive safety analytics, real-time monitoring, and automated compliance can reduce incident rates by 20-40% while cutting rework costs significantly.",
      priorities: [
        {
          name: "Safety Intelligence & Prevention",
          useCases: [
            {
              name: "Predictive Safety Analytics",
              description:
                "Predict safety incident likelihood using leading indicators — near-miss frequency, inspection findings, crew fatigue levels, weather conditions, and activity risk profiles — to target preventive interventions at highest-risk work fronts.",
              businessValue:
                "20-30% reduction in recordable incident rates through proactive, data-driven safety interventions.",
              typicalDataEntities: [
                "Incident Reports",
                "Near-Miss Events",
                "Inspection Findings",
                "Risk Assessments",
              ],
              typicalSourceSystems: [
                "Safety Management System",
                "Inspection Platform",
                "HR System",
                "Weather Service",
              ],
            },
            {
              name: "Computer Vision Site Monitoring",
              description:
                "Deploy AI-powered camera and drone systems to detect PPE non-compliance, exclusion zone breaches, plant-pedestrian proximity hazards, and unsafe behaviours in real time across active construction zones.",
              businessValue:
                "50%+ improvement in hazard detection speed compared to manual observation rounds.",
              typicalDataEntities: [
                "Camera Feeds",
                "Drone Imagery",
                "PPE Compliance Events",
                "Exclusion Zone Alerts",
              ],
              typicalSourceSystems: [
                "CCTV/Camera Platform",
                "Drone Management System",
                "Safety Management System",
                "Access Control System",
              ],
            },
            {
              name: "Fatigue & Fitness for Work Analytics",
              description:
                "Monitor workforce fatigue risk using roster patterns, travel distances, hours worked, environmental heat stress indices, and self-reported wellness data. Flag high-risk individuals before they enter work zones.",
              typicalDataEntities: [
                "Roster Patterns",
                "Hours Worked",
                "Travel Distances",
                "Heat Stress Index",
              ],
              typicalSourceSystems: [
                "Time & Attendance System",
                "HR System",
                "Fatigue Management System",
                "Weather Service",
              ],
            },
            {
              name: "Critical Risk Control Verification",
              description:
                "Digitise and monitor critical risk controls (working at heights, confined spaces, energised systems, lifting operations) with real-time verification that controls are in place before high-risk activities commence.",
              typicalDataEntities: [
                "Critical Risk Controls",
                "Permit to Work Records",
                "Verification Checklists",
                "Activity Status",
              ],
              typicalSourceSystems: [
                "Safety Management System",
                "Permit to Work System",
                "Project Management Platform",
              ],
            },
          ],
          kpis: [
            "Total recordable incident frequency rate (TRIFR)",
            "Lost time injury frequency rate (LTIFR)",
            "Near-miss reporting rate",
            "Critical control verification compliance (%)",
          ],
          personas: [
            "Head of Health & Safety",
            "HSE Director",
            "Chief Safety Officer",
            "Site Safety Manager",
          ],
        },
        {
          name: "Quality Assurance & Defect Prevention",
          useCases: [
            {
              name: "Defect Prediction & Rework Prevention",
              description:
                "Predict defect likelihood by analysing inspection data, material test results, trade crew performance, and environmental conditions. Trigger targeted quality holds before defective work is covered up or built upon.",
              businessValue: "30-50% reduction in rework costs through early defect interception.",
              typicalDataEntities: [
                "Inspection Results",
                "Material Test Certificates",
                "Non-Conformance Reports",
                "Defect Classifications",
              ],
              typicalSourceSystems: [
                "Quality Management System",
                "Document Management System",
                "Inspection Platform",
                "ERP",
              ],
            },
            {
              name: "BIM-Based Quality Verification",
              description:
                "Compare as-built conditions captured by LiDAR scans and photogrammetry against BIM design models to automatically detect dimensional deviations, installation errors, and specification non-conformances.",
              typicalDataEntities: [
                "BIM Models",
                "Point Cloud Scans",
                "Design Specifications",
                "Deviation Reports",
              ],
              typicalSourceSystems: [
                "BIM Platform",
                "LiDAR/Survey Platform",
                "Quality Management System",
                "Design Management System",
              ],
            },
            {
              name: "Automated Compliance & Permit Tracking",
              description:
                "Track environmental permits, construction approvals, hold points, and regulatory submissions across jurisdictions. Auto-flag expiring permits and overdue inspections before they block critical path activities.",
              businessValue:
                "90%+ on-time permit compliance, eliminating permit-related work stoppages.",
              typicalDataEntities: [
                "Permit Records",
                "Approval Milestones",
                "Hold Point Register",
                "Regulatory Submissions",
              ],
              typicalSourceSystems: [
                "Permit Management System",
                "Project Management Platform",
                "Document Management System",
                "Regulatory Portal",
              ],
            },
          ],
          kpis: [
            "Rework rate (% of contract value)",
            "Non-conformance closure time (days)",
            "First-time quality pass rate (%)",
            "Permit compliance rate (%)",
          ],
          personas: [
            "Quality Manager",
            "Head of Engineering",
            "Project Director",
            "Compliance Manager",
          ],
        },
      ],
    },
    {
      name: "Digitise Supply Chain & Procurement",
      whyChange:
        "Materials and subcontractor costs represent 60-70% of construction project value. Supply chain disruptions, price volatility, and subcontractor performance failures are among the top drivers of project overruns. Yet most procurement decisions rely on relationships and spreadsheets rather than data. AI-driven procurement analytics, real-time material tracking, and subcontractor performance intelligence enable 5-15% savings on direct costs while reducing supply-side risk.",
      priorities: [
        {
          name: "Procurement & Materials Intelligence",
          useCases: [
            {
              name: "Material Price Forecasting",
              description:
                "Predict commodity and material price movements (steel, concrete, timber, aggregates, fuel) using market data, supplier quotes, project demand pipelines, and macroeconomic indicators to optimise procurement timing.",
              businessValue:
                "3-8% reduction in material costs through optimised procurement timing and forward buying.",
              typicalDataEntities: [
                "Commodity Prices",
                "Supplier Quotes",
                "Project Demand Forecasts",
                "Market Indicators",
              ],
              typicalSourceSystems: [
                "ERP",
                "Procurement Platform",
                "Market Data Feeds",
                "Project Controls System",
              ],
            },
            {
              name: "Materials Logistics & Site Delivery Optimization",
              description:
                "Coordinate just-in-time material deliveries to constrained construction sites using delivery schedules, site storage capacity, crane availability, and traffic data. Reduce double-handling and site congestion.",
              typicalDataEntities: [
                "Delivery Schedules",
                "Site Storage Capacity",
                "Crane Availability",
                "Traffic Data",
              ],
              typicalSourceSystems: [
                "Logistics Platform",
                "ERP",
                "Site Management System",
                "Scheduling System",
              ],
            },
            {
              name: "Waste & Surplus Material Analytics",
              description:
                "Track material waste streams, surplus quantities, and reuse opportunities across the project portfolio. Identify patterns that drive over-ordering and enable cross-project material redistribution.",
              businessValue:
                "10-20% reduction in material waste through predictive ordering and cross-project redistribution.",
              typicalDataEntities: [
                "Waste Records",
                "Surplus Inventory",
                "Order History",
                "Reuse Opportunities",
              ],
              typicalSourceSystems: [
                "ERP",
                "Waste Management System",
                "Project Management Platform",
                "Environmental System",
              ],
            },
          ],
          kpis: [
            "Material cost variance (%)",
            "Procurement cycle time (days)",
            "Material waste rate (%)",
            "On-time delivery rate (%)",
          ],
          personas: [
            "Head of Procurement",
            "Supply Chain Manager",
            "Commercial Manager",
            "Chief Procurement Officer",
          ],
        },
        {
          name: "Subcontractor & Supplier Performance",
          useCases: [
            {
              name: "Subcontractor Performance Scoring",
              description:
                "Score and rank subcontractors using historical delivery performance, quality metrics, safety records, financial health, and contract compliance across the project portfolio. Inform prequalification and tender shortlisting.",
              businessValue:
                "15-25% reduction in subcontractor-related project issues through data-driven selection.",
              typicalDataEntities: [
                "Subcontractor Profiles",
                "Performance Scores",
                "Safety Records",
                "Financial Health Data",
              ],
              typicalSourceSystems: [
                "Prequalification System",
                "ERP",
                "Safety Management System",
                "Credit Rating Service",
              ],
            },
            {
              name: "Supplier Risk Monitoring",
              description:
                "Monitor supplier financial health, capacity constraints, and geopolitical risk exposure using internal performance data and external signals. Trigger early warnings when critical suppliers show distress indicators.",
              typicalDataEntities: [
                "Supplier Profiles",
                "Financial Health Indicators",
                "Capacity Data",
                "Risk Signals",
              ],
              typicalSourceSystems: [
                "ERP",
                "Credit Rating Service",
                "Procurement Platform",
                "News/Risk Feed",
              ],
            },
            {
              name: "Contract & Claims Analytics",
              description:
                "Analyse contract performance across the subcontractor and supplier base — payment terms, claim frequency, dispute patterns, and retention release — to optimise commercial outcomes and reduce contractual friction.",
              typicalDataEntities: [
                "Contract Terms",
                "Claim History",
                "Payment Records",
                "Dispute Logs",
              ],
              typicalSourceSystems: [
                "Contract Management System",
                "ERP",
                "Legal System",
                "Project Controls System",
              ],
            },
          ],
          kpis: [
            "Subcontractor on-time delivery (%)",
            "Subcontractor safety incident rate",
            "Supplier risk score",
            "Contract dispute rate (%)",
          ],
          personas: [
            "Head of Subcontract Management",
            "VP Procurement",
            "Commercial Director",
            "Risk Manager",
          ],
        },
      ],
    },
    {
      name: "Strengthen Commercial & Risk Management",
      whyChange:
        "Construction firms operate on thin margins with significant downside risk from contractual disputes, cash flow volatility, and inaccurate tendering. Industry analysis shows 30% of all construction projects are loss-making. Firms that embed analytics into tendering, cash flow management, and risk quantification achieve 2-3x better margin outcomes than those relying on experience-based estimating alone.",
      priorities: [
        {
          name: "Tender & Estimating Intelligence",
          useCases: [
            {
              name: "AI-Assisted Estimating",
              description:
                "Improve bid accuracy using historical project cost databases, productivity benchmarks, and site condition data to generate parametric estimates and identify high-risk line items that require expert review.",
              businessValue:
                "10-20% improvement in estimate accuracy, reducing both under-pricing losses and over-pricing non-wins.",
              typicalDataEntities: [
                "Historical Cost Data",
                "Rate Libraries",
                "Productivity Benchmarks",
                "Site Condition Assessments",
              ],
              typicalSourceSystems: [
                "Estimating System",
                "ERP",
                "Project Controls System",
                "Cost Database",
              ],
            },
            {
              name: "Win-Rate & Pipeline Analytics",
              description:
                "Analyse tender pipeline, win rates, competitor positioning, and client relationship strength to prioritise bids and allocate estimating resources to the highest-value opportunities.",
              typicalDataEntities: [
                "Tender Pipeline",
                "Win/Loss History",
                "Client Profiles",
                "Competitor Intelligence",
              ],
              typicalSourceSystems: ["CRM", "Estimating System", "ERP", "Market Intelligence"],
            },
            {
              name: "Risk-Adjusted Tender Pricing",
              description:
                "Quantify project-specific risks (geotechnical, contractual, weather, regulatory) using historical data and Monte Carlo simulation to set appropriate contingency levels and risk premiums in bids.",
              businessValue:
                "Improve bid competitiveness by 3-5% through calibrated risk contingencies rather than blanket percentages.",
              typicalDataEntities: [
                "Risk Registers",
                "Geotechnical Reports",
                "Contract Conditions",
                "Historical Risk Outcomes",
              ],
              typicalSourceSystems: [
                "Risk Management System",
                "Estimating System",
                "Document Management System",
                "ERP",
              ],
            },
          ],
          kpis: [
            "Bid accuracy (% deviation from final cost)",
            "Win rate (%)",
            "Tender conversion value ($)",
            "Estimating resource efficiency",
          ],
          personas: [
            "Chief Estimator",
            "Head of Business Development",
            "Commercial Director",
            "Chief Executive Officer",
          ],
        },
        {
          name: "Financial Performance & Cash Flow",
          useCases: [
            {
              name: "Project Cash Flow Forecasting",
              description:
                "Predict cash flow timing across the project portfolio using contract payment terms, milestone achievement probability, variation settlement patterns, and retention release schedules. Optimise working capital deployment.",
              businessValue:
                "15-25% improvement in cash flow forecast accuracy, reducing working capital costs.",
              typicalDataEntities: [
                "Payment Milestones",
                "Invoice History",
                "Retention Schedules",
                "Cash Positions",
              ],
              typicalSourceSystems: [
                "ERP",
                "Project Controls System",
                "Treasury System",
                "Contract Management System",
              ],
            },
            {
              name: "Project Margin Analytics",
              description:
                "Track project-level margin progression from tender through execution using cost-to-complete forecasts, revenue recognition, and risk exposure. Identify margin erosion patterns early enough for course correction.",
              typicalDataEntities: [
                "Margin Forecasts",
                "Cost-to-Complete",
                "Revenue Recognition",
                "Risk Exposure",
              ],
              typicalSourceSystems: [
                "ERP",
                "Project Controls System",
                "BI Platform",
                "Risk Management System",
              ],
            },
            {
              name: "Claims & Dispute Analytics",
              description:
                "Analyse claim and dispute patterns across the portfolio — root causes, resolution timelines, financial outcomes, and counterparty behaviour — to improve claim preparation, negotiation strategy, and contract drafting.",
              businessValue:
                "10-15% improvement in claim recovery rates through data-backed substantiation.",
              typicalDataEntities: [
                "Claim Records",
                "Dispute History",
                "Resolution Outcomes",
                "Contract Provisions",
              ],
              typicalSourceSystems: [
                "Contract Management System",
                "Legal System",
                "ERP",
                "Document Management System",
              ],
            },
          ],
          kpis: [
            "Cash flow forecast accuracy (%)",
            "Project margin (% of revenue)",
            "Days sales outstanding (DSO)",
            "Claim recovery rate (%)",
          ],
          personas: [
            "Chief Financial Officer",
            "Head of Commercial",
            "Project Director",
            "VP Finance",
          ],
        },
      ],
    },
    {
      name: "Drive Sustainability & ESG Performance",
      whyChange:
        "Construction and the built environment account for 37% of global carbon emissions. Major clients — governments, miners, and infrastructure owners — increasingly mandate embodied carbon targets, circular economy practices, and scope 3 reporting as tender requirements. Firms that can quantify and reduce environmental impact win more work and attract ESG-conscious capital. The regulatory landscape is tightening rapidly with mandatory climate disclosures and environmental approval conditions becoming more stringent.",
      priorities: [
        {
          name: "Carbon & Environmental Intelligence",
          useCases: [
            {
              name: "Embodied Carbon Tracking",
              description:
                "Calculate and track embodied carbon across projects using material quantities, transport distances, supplier emission factors, and construction methodology choices. Enable design-stage carbon optimisation and report against client targets.",
              businessValue:
                "10-30% embodied carbon reduction through data-driven material and methodology selection.",
              typicalDataEntities: [
                "Material Quantities",
                "Emission Factors",
                "Transport Distances",
                "Carbon Calculations",
              ],
              typicalSourceSystems: [
                "BIM Platform",
                "ERP",
                "Carbon Calculator",
                "Supplier Database",
              ],
            },
            {
              name: "Scope 1, 2 & 3 Emissions Reporting",
              description:
                "Automate enterprise-wide emissions reporting across fuel consumption, electricity use, materials supply chain, and waste using integrated data pipelines from site-level to corporate level.",
              typicalDataEntities: [
                "Fuel Consumption",
                "Electricity Use",
                "Supply Chain Emissions",
                "Waste Tonnages",
              ],
              typicalSourceSystems: [
                "ERP",
                "Fleet Management System",
                "Sustainability Platform",
                "Waste Management System",
              ],
            },
            {
              name: "Environmental Compliance & Monitoring",
              description:
                "Monitor environmental approval conditions (noise, dust, water quality, vegetation clearing) using IoT sensors and inspection data. Auto-flag breaches and generate regulator-ready compliance reports.",
              businessValue:
                "80%+ reduction in manual environmental monitoring effort with improved compliance rates.",
              typicalDataEntities: [
                "Environmental Sensor Data",
                "Approval Conditions",
                "Monitoring Results",
                "Compliance Status",
              ],
              typicalSourceSystems: [
                "Environmental Monitoring System",
                "IoT Platform",
                "Permit Management System",
                "Regulatory Portal",
              ],
            },
            {
              name: "Circular Economy & Waste Diversion Analytics",
              description:
                "Track waste streams, recycling rates, and material reuse across the project portfolio. Identify opportunities for construction and demolition waste diversion and report against circular economy targets.",
              typicalDataEntities: [
                "Waste Streams",
                "Recycling Records",
                "Diversion Rates",
                "Material Reuse Logs",
              ],
              typicalSourceSystems: [
                "Waste Management System",
                "ERP",
                "Environmental System",
                "Project Management Platform",
              ],
            },
          ],
          kpis: [
            "Embodied carbon per $M revenue (tCO2e)",
            "Scope 1+2 emissions reduction (%)",
            "Waste diversion rate (%)",
            "Environmental non-compliance incidents",
          ],
          personas: [
            "Chief Sustainability Officer",
            "Head of Environment",
            "ESG Director",
            "VP Corporate Affairs",
          ],
        },
        {
          name: "Social Impact & Community",
          useCases: [
            {
              name: "Indigenous & Local Employment Analytics",
              description:
                "Track indigenous, local, and diversity employment participation across projects against contractual targets and voluntary commitments. Report spending with indigenous and local businesses for social procurement compliance.",
              typicalDataEntities: [
                "Workforce Demographics",
                "Employment Targets",
                "Social Procurement Spend",
                "Community Commitments",
              ],
              typicalSourceSystems: [
                "HR System",
                "ERP",
                "Procurement Platform",
                "Social Impact System",
              ],
            },
            {
              name: "Community Impact & Stakeholder Management",
              description:
                "Monitor community complaints, stakeholder sentiment, and social licence indicators across project sites. Correlate construction activities with community impact to proactively adjust work practices.",
              typicalDataEntities: [
                "Community Complaints",
                "Stakeholder Contacts",
                "Sentiment Indicators",
                "Impact Assessments",
              ],
              typicalSourceSystems: [
                "Stakeholder Management System",
                "CRM",
                "Social Media Monitoring",
                "Community Portal",
              ],
            },
          ],
          kpis: [
            "Indigenous employment participation (%)",
            "Social procurement spend ($)",
            "Community complaint response time (hours)",
            "Social licence score",
          ],
          personas: [
            "Head of Social Performance",
            "Community Relations Manager",
            "VP Sustainability",
            "Project Director",
          ],
        },
      ],
    },
    {
      name: "Modernise Workforce & Knowledge Management",
      whyChange:
        "The construction industry faces a structural workforce crisis — a 500,000-worker shortfall in major markets, 41% of the current workforce retiring by 2031, and chronic skills shortages in critical trades. Combined with remote and distributed project sites, complex industrial relations, and safety-critical competency requirements, workforce management is a strategic differentiator. AI-powered workforce intelligence can increase labour productivity by 15-30% while improving retention and safety outcomes.",
      priorities: [
        {
          name: "Workforce Planning & Deployment",
          useCases: [
            {
              name: "Skills-Based Workforce Planning",
              description:
                "Forecast workforce demand by trade, competency, and certification across the project pipeline. Identify skills gaps, training needs, and recruitment priorities using project-level resource requirements and employee skill inventories.",
              businessValue:
                "20-30% improvement in resource allocation efficiency across the project portfolio.",
              typicalDataEntities: [
                "Employee Skills Registry",
                "Competency Requirements",
                "Project Demand Forecasts",
                "Certification Records",
              ],
              typicalSourceSystems: [
                "HR System",
                "Learning Management System",
                "Resource Management System",
                "Project Management Platform",
              ],
            },
            {
              name: "Crew Optimization & Assignment",
              description:
                "Optimise crew assignment to work fronts using skills, certifications, fatigue status, proximity, and project priority. Balance productivity with safety and industrial agreement constraints.",
              typicalDataEntities: [
                "Crew Profiles",
                "Certification Status",
                "Fatigue Scores",
                "Work Front Requirements",
              ],
              typicalSourceSystems: [
                "HR System",
                "Resource Management System",
                "Fatigue Management System",
                "Scheduling System",
              ],
            },
            {
              name: "Workforce Attrition Prediction",
              description:
                "Predict employee turnover risk using tenure, compensation benchmarks, project assignment patterns, training investment, and engagement survey data. Enable targeted retention strategies for critical skills.",
              typicalDataEntities: [
                "Employee Profiles",
                "Compensation Data",
                "Engagement Scores",
                "Turnover History",
              ],
              typicalSourceSystems: [
                "HR System",
                "Payroll System",
                "Survey Platform",
                "Learning Management System",
              ],
            },
          ],
          kpis: [
            "Workforce utilisation rate (%)",
            "Competency coverage (%)",
            "Employee turnover rate (%)",
            "Time to fill critical roles (days)",
          ],
          personas: [
            "Head of People & Culture",
            "VP Human Resources",
            "Workforce Planning Manager",
            "Chief People Officer",
          ],
        },
        {
          name: "Knowledge Capture & Operational Excellence",
          useCases: [
            {
              name: "Project Lessons Learned Intelligence",
              description:
                "Capture, classify, and surface project lessons learned using NLP to extract insights from closeout reports, incident investigations, and variation analyses. Make institutional knowledge searchable and actionable for future projects.",
              businessValue:
                "Reduce repeat mistakes by 30-40% through systematic knowledge reuse across projects.",
              typicalDataEntities: [
                "Lessons Learned Records",
                "Closeout Reports",
                "Incident Investigations",
                "Best Practices",
              ],
              typicalSourceSystems: [
                "Document Management System",
                "Knowledge Management System",
                "Safety Management System",
                "Project Controls System",
              ],
            },
            {
              name: "Construction Method & Productivity Benchmarking",
              description:
                "Build and maintain internal productivity benchmarks by activity, trade, geography, and project type. Enable evidence-based method statements and resource planning informed by actual organisational performance data.",
              typicalDataEntities: [
                "Productivity Benchmarks",
                "Activity Rates",
                "Method Statements",
                "Benchmark Comparisons",
              ],
              typicalSourceSystems: [
                "Project Controls System",
                "Time & Attendance System",
                "ERP",
                "Knowledge Management System",
              ],
            },
          ],
          kpis: [
            "Lessons learned capture rate (%)",
            "Knowledge reuse rate (%)",
            "Benchmark accuracy (predicted vs actual)",
            "Repeat incident rate (%)",
          ],
          personas: [
            "Head of Operational Excellence",
            "Knowledge Manager",
            "VP Operations",
            "Chief Operating Officer",
          ],
        },
      ],
    },
    {
      name: "Enable Digital Construction & Asset Intelligence",
      whyChange:
        "Digital construction technologies — BIM, IoT, digital twins, drones, and machine control — generate vast amounts of data that remains siloed in point solutions. Only 5% of construction firms effectively use the data they collect. Unifying site data into a single platform enables AI-driven insights across safety, quality, productivity, and handover, while digital asset intelligence creates new value for asset owners through the construction lifecycle.",
      priorities: [
        {
          name: "Site Intelligence & IoT",
          useCases: [
            {
              name: "Unified Site Data Platform",
              description:
                "Integrate data from BIM, scheduling, cost management, safety, quality, IoT sensors, drones, and survey systems into a single project data lakehouse. Enable cross-domain analytics that are impossible in siloed systems.",
              typicalDataEntities: ["BIM Data", "Schedule Data", "Cost Data", "IoT Sensor Data"],
              typicalSourceSystems: ["BIM Platform", "Scheduling System", "ERP", "IoT Platform"],
            },
            {
              name: "Drone-Based Progress Monitoring",
              description:
                "Automate site progress measurement using drone photogrammetry and LiDAR compared against BIM models and schedules. Reduce manual progress reporting effort and improve measurement accuracy.",
              businessValue:
                "70-80% reduction in progress measurement time with improved accuracy and auditability.",
              typicalDataEntities: [
                "Drone Imagery",
                "Point Clouds",
                "BIM Models",
                "Progress Measurements",
              ],
              typicalSourceSystems: [
                "Drone Management System",
                "BIM Platform",
                "Survey Platform",
                "Scheduling System",
              ],
            },
            {
              name: "Geotechnical & Structural Monitoring",
              description:
                "Monitor ground movement, settlement, vibration, and structural load in real time using embedded IoT sensors during and after construction. Trigger automated alerts when thresholds are approached.",
              typicalDataEntities: [
                "Ground Movement Data",
                "Settlement Readings",
                "Vibration Levels",
                "Structural Load Data",
              ],
              typicalSourceSystems: [
                "IoT Platform",
                "Geotechnical Monitoring System",
                "SCADA",
                "BIM Platform",
              ],
            },
          ],
          kpis: [
            "Data integration coverage (%)",
            "Progress measurement cycle time",
            "Monitoring alert response time",
            "Data-driven decision frequency",
          ],
          personas: [
            "Digital Construction Manager",
            "Head of Digital Engineering",
            "Chief Technology Officer",
            "BIM Manager",
          ],
        },
        {
          name: "Digital Handover & Asset Lifecycle",
          useCases: [
            {
              name: "Digital Twin for Asset Handover",
              description:
                "Build comprehensive digital twins during construction that carry as-built geometry, installed equipment data, commissioning records, and O&M documentation into the asset owner's management systems.",
              businessValue:
                "40-60% reduction in handover documentation effort with higher completeness and accuracy.",
              typicalDataEntities: [
                "As-Built Models",
                "Equipment Records",
                "Commissioning Data",
                "O&M Documentation",
              ],
              typicalSourceSystems: [
                "BIM Platform",
                "Commissioning System",
                "Document Management System",
                "Asset Management System",
              ],
            },
            {
              name: "Infrastructure Condition Baseline",
              description:
                "Establish data-rich condition baselines for newly constructed infrastructure assets — pavements, bridges, tunnels, pipelines — that feed directly into the asset owner's maintenance and lifecycle planning systems.",
              typicalDataEntities: [
                "Condition Assessments",
                "Material Properties",
                "Design Life Parameters",
                "Baseline Measurements",
              ],
              typicalSourceSystems: [
                "Survey Platform",
                "Quality Management System",
                "Asset Management System",
                "BIM Platform",
              ],
            },
          ],
          kpis: [
            "Digital handover completeness (%)",
            "Data quality score at handover",
            "Time to operational readiness (days)",
            "Asset information accuracy (%)",
          ],
          personas: [
            "Head of Digital Delivery",
            "Project Director",
            "Asset Owner Representative",
            "Commissioning Manager",
          ],
        },
      ],
    },
  ],
};
