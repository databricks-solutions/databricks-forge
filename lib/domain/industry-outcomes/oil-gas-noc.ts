import type { IndustryOutcome } from "./index";

/**
 * Oil & Gas (Integrated / National Oil Company) outcome map.
 *
 * A reusable built-in map for fully-integrated oil & gas operators and NOCs
 * (e.g. Petronas, Saudi Aramco, Shell, ExxonMobil) spanning the whole value
 * chain: Upstream E&P, LNG (liquefaction / shipping / regas), Midstream &
 * Pipelines, Downstream Refining, Petrochemicals, integrated Trading, and the
 * New-Energy / Hydrogen / CCUS transition.
 *
 * This map is distinct from `energy-utilities` (which centres on power & gas
 * utilities, renewables, grid, and regulated retail). Use `oil-gas-noc` for
 * hydrocarbon-centric integrated operators where the LNG value chain,
 * downstream/petrochemical yield, hydrocarbon accounting, and integrated
 * trading are first-class concerns and regulated-retail-electricity concerns
 * (smart-meter personalisation, demand response, retail churn) are not.
 */
export const OIL_GAS_NOC: IndustryOutcome = {
  id: "oil-gas-noc",
  name: "Oil & Gas (Integrated / NOC)",
  subVerticals: [
    "Upstream E&P (Subsurface, Wells, Production)",
    "LNG (Liquefaction, Shipping, Regasification)",
    "Midstream & Pipelines",
    "Downstream Refining",
    "Petrochemicals",
    "Integrated Trading & Optimization",
    "New Energy / Hydrogen / CCUS",
  ],
  suggestedDomains: [
    "Subsurface & Wells",
    "Production Operations",
    "Asset Integrity & HSE",
    "LNG & Shipping",
    "Downstream & Petrochemicals",
    "Trading & Supply",
    "Sustainability & Energy Transition",
    "Finance & Corporate",
  ],
  suggestedPriorities: [
    "Maximize Production",
    "Optimize Operations",
    "Reduce Cost",
    "Mitigate Risk",
    "Achieve ESG",
    "Increase Revenue",
  ],
  objectives: [
    // -----------------------------------------------------------------------
    {
      name: "Maximize Production & Recovery",
      whyChange:
        "For an integrated operator the single largest lever on enterprise value is hydrocarbon volume produced and ultimately recovered. Reserves are harder to find and develop, fields are maturing, and the cost of a misplaced well or an under-stimulated reservoir runs into the tens of millions. The subsurface is the most data-rich and most under-exploited domain in the company: seismic volumes, well logs, real-time drilling streams (WITSML), production allocation, and reservoir simulations sit in siloed petrotechnical systems that never reach the same analytical plane. Operators who fuse these into a governed lakehouse — applying ML to interpretation, drilling optimisation, and production allocation — accelerate field development decisions, lift recovery factors, and shorten the cycle from discovery to first oil.",
      priorities: [
        {
          name: "Subsurface & Reservoir Optimization",
          useCases: [
            {
              name: "Subsurface Interpretation & Reservoir Modelling",
              description:
                "Apply ML and physics-informed models to seismic volumes, well logs, and petrophysics to accelerate interpretation, de-risk prospects, and improve reservoir characterisation and history-matching — replacing slow, manual, expert-bound workflows.",
              businessValue:
                "Faster, more confident field-development decisions; improved recovery factor; reduced dry-hole and appraisal spend.",
              typicalDataEntities: [
                "Seismic Volumes",
                "Well Logs",
                "Petrophysical Interpretations",
                "Reservoir Simulation Models",
                "Core & Fluid Samples",
              ],
              typicalSourceSystems: [
                "Seismic Interpretation Platform",
                "Petrotechnical Data Store (RESQML/WITSML)",
                "Reservoir Simulation",
                "Petroleum Data Management",
              ],
            },
            {
              name: "Well Performance Optimization",
              description:
                "Use ML on production logs, pressure-volume-temperature data, and reservoir simulations to optimise well performance, identify under-performing wells, and target interventions (chemical treatment, recompletion, artificial-lift tuning).",
              businessValue:
                "5-15% production uplift on under-performing wells; better-targeted intervention spend.",
              typicalDataEntities: [
                "Well Production Data",
                "Subsurface Logs",
                "Reservoir Models",
                "Completion Data",
                "Intervention History",
              ],
              typicalSourceSystems: [
                "Production Allocation",
                "Historian",
                "Petroleum Data Management",
                "Reservoir Simulation",
              ],
            },
            {
              name: "Drilling & Completions Optimization",
              description:
                "Stream real-time drilling data (WITSML — torque, weight-on-bit, mud, rate-of-penetration) into ML models that optimise drilling parameters, detect dysfunction (stick-slip, washouts) early, and reduce non-productive time and rig days.",
              businessValue:
                "Fewer rig days and reduced non-productive time; lower well-construction cost; safer drilling.",
              typicalDataEntities: [
                "Real-Time Drilling Streams (WITSML)",
                "Mud Logs",
                "Bottom-Hole Assembly Config",
                "Well Plans",
                "Daily Drilling Reports",
              ],
              typicalSourceSystems: [
                "Real-Time Drilling Data Aggregator",
                "WITSML Store",
                "Drilling Engineering System",
                "Rig SCADA",
              ],
            },
          ],
          kpis: [
            "Production volume (boe/d)",
            "Recovery factor",
            "Non-productive time (rig)",
            "Finding & development cost",
          ],
          personas: ["VP Subsurface", "Head of Reservoir Engineering", "Drilling Manager"],
        },
        {
          name: "Production & Hydrocarbon Allocation",
          useCases: [
            {
              name: "Production Optimization",
              description:
                "Optimise production processes (well rates, gas lift, separation, compression) using real-time analytics, digital twins, and AI to maximise throughput and efficiency while respecting safety and equipment-life constraints.",
              businessValue:
                "2-5% improvement in production efficiency; reduced energy and flaring per barrel produced.",
              typicalDataEntities: [
                "Production Output",
                "Process Parameters",
                "Setpoint Configurations",
                "Flaring & Venting",
                "Efficiency Metrics",
              ],
              typicalSourceSystems: ["SCADA", "Historian", "DCS", "Production Allocation"],
            },
            {
              name: "Hydrocarbon Accounting & Allocation",
              description:
                "Automate volumetric allocation and reconciliation across wells, fields, and commingled streams — producing auditable production accounting for partners, regulators, and PSC/royalty settlement.",
              businessValue:
                "Faster, defensible allocation; reduced reconciliation effort and partner disputes; accurate royalty/PSC settlement.",
              typicalDataEntities: [
                "Metered Volumes",
                "Allocation Factors",
                "Well Tests",
                "Partner / PSC Equity",
                "Reconciliation Adjustments",
              ],
              typicalSourceSystems: [
                "Production Allocation",
                "Hydrocarbon Accounting System",
                "Custody Transfer Metering",
                "ERP",
              ],
            },
          ],
          kpis: [
            "Allocation cycle time",
            "Reconciliation variance",
            "Production efficiency",
            "Deferred production",
          ],
          personas: ["VP Production", "Head of Production Accounting", "Chief Operating Officer"],
        },
      ],
    },
    // -----------------------------------------------------------------------
    {
      name: "Asset Integrity, Safety & Environment",
      whyChange:
        "Oil & gas is a high-hazard, capital-intensive business where a single process-safety event can cost lives, billions in liability, and the social licence to operate. Ageing assets, remote and offshore operations, and methane-intensity scrutiny raise the stakes every year. The instrumentation already exists — SCADA/historian telemetry, condition monitoring, inspection media, emissions sensors — but it rarely closes the loop with maintenance and HSE decisions. Operators who apply ML to predictive maintenance, safety-event prediction, and continuous emissions/methane monitoring move from calendar-based and reactive to condition-based and predictive: less unplanned downtime, fewer Tier-1/2 incidents, and audit-grade environmental compliance.",
      priorities: [
        {
          name: "Asset Integrity & Predictive Maintenance",
          useCases: [
            {
              name: "Predictive Maintenance for Energy Assets",
              description:
                "Predict equipment failures across rotating and static assets (compressors, turbines, pumps, heat exchangers, pipelines) using ML on vibration, thermal, acoustic, and process signatures — enabling condition-based rather than calendar-based maintenance.",
              businessValue:
                "20-50% reduction in unplanned downtime; deferred capex on healthy assets; fewer catastrophic failures.",
              typicalDataEntities: [
                "IoT Sensor Readings",
                "Equipment Maintenance History",
                "Asset Registry",
                "Failure Mode Catalogue",
                "Remaining Useful Life Predictions",
              ],
              typicalSourceSystems: ["SCADA", "CMMS", "Historian", "Condition Monitoring", "IoT Platform"],
            },
            {
              name: "Pipeline & Asset Integrity Management",
              description:
                "Fuse inline-inspection (ILP/smart-pig) results, corrosion sensors, cathodic-protection data, and geospatial context to predict integrity threats, prioritise inspection and repair, and demonstrate regulatory compliance.",
              businessValue:
                "Reduced leak and rupture risk; optimised inspection spend; defensible integrity-management evidence.",
              typicalDataEntities: [
                "Inline Inspection Results",
                "Corrosion / CP Readings",
                "Pipeline Geospatial Topology",
                "Repair History",
                "Threat Assessments",
              ],
              typicalSourceSystems: [
                "Pipeline Integrity Management System",
                "GIS",
                "SCADA",
                "Inspection Data Store",
              ],
            },
          ],
          kpis: [
            "Unplanned downtime",
            "Asset uptime (%)",
            "Maintenance cost savings",
            "Loss of primary containment events",
          ],
          personas: ["VP Asset Integrity", "Head of Maintenance & Reliability", "Chief Operating Officer"],
        },
        {
          name: "Process Safety & Environmental Compliance",
          useCases: [
            {
              name: "Safety Event Prediction",
              description:
                "Use ML on operational telemetry (pressure, flow, temperature, gas readings) to predict safety incidents — well-bore influxes, equipment runaway, leak precursors — giving minutes-to-hours of advance warning for preventive intervention.",
              businessValue:
                "Predict dangerous well-bore influxes ~45 minutes before they occur (NOV case); fewer Tier 1/2 process-safety events; protected licence to operate.",
              typicalDataEntities: [
                "Sensor Readings",
                "Operational Parameters",
                "Historical Incidents",
                "Risk Indicators",
                "Early Warning Alerts",
              ],
              typicalSourceSystems: ["SCADA", "DCS", "HSE System", "Historian"],
            },
            {
              name: "Methane & Emissions Monitoring (MMV)",
              description:
                "Continuously monitor methane leaks, flaring, and emissions using continuous-emissions-monitoring systems, satellite and drone imagery, and sensor networks — automatically flagging breaches and feeding regulator-ready, auditable measurement, monitoring & verification (MMV) trails.",
              businessValue:
                "Reduced methane intensity and regulatory-penalty exposure; faster leak response; supports OGMP 2.0 / CSRD / SEC climate disclosure.",
              typicalDataEntities: [
                "Emissions Readings",
                "Methane Leak Detection",
                "Flaring & Venting Volumes",
                "Satellite / Drone Imagery",
                "Compliance Thresholds",
              ],
              typicalSourceSystems: [
                "CEMS",
                "Methane Detection Network",
                "Satellite Data Provider",
                "Environmental Management System",
              ],
            },
          ],
          kpis: [
            "Tier 1/2 process-safety events",
            "Methane intensity",
            "Flaring volume",
            "Environmental compliance",
          ],
          personas: ["Head of HSE", "Chief Safety Officer", "VP Sustainability"],
        },
      ],
    },
    // -----------------------------------------------------------------------
    {
      name: "LNG & Value-Chain Optimization",
      whyChange:
        "LNG is the fastest-growing and most logistically complex part of an integrated portfolio, and for a leading LNG player it is a core margin engine. Value leaks across a long chain — liquefaction-train availability and efficiency, cargo scheduling, shipping and boil-off, regasification, and contract optimisation — and the data lives in plant historians, shipping systems, and trading platforms that rarely connect. Operators who unify train telemetry, cargo and voyage data, and market signals into one analytical plane raise train throughput, optimise fleet utilisation and boil-off, and squeeze more margin from each cargo and contract.",
      priorities: [
        {
          name: "Liquefaction & Regasification",
          useCases: [
            {
              name: "LNG Train Throughput & Efficiency Optimization",
              description:
                "Optimise liquefaction-train performance (throughput, specific energy, refrigerant balance) and predict train availability using historian telemetry, ambient conditions, and digital twins — maximising production while respecting equipment-life and safety constraints.",
              businessValue:
                "Higher train throughput and availability; lower specific energy per tonne of LNG; deferred capacity capex.",
              typicalDataEntities: [
                "Train Process Telemetry",
                "Refrigerant & Compressor Data",
                "Ambient Conditions",
                "Train Availability",
                "Specific Energy Metrics",
              ],
              typicalSourceSystems: ["Plant Historian", "DCS", "Digital Twin", "Maintenance System"],
            },
          ],
          kpis: ["Train availability", "LNG throughput", "Specific energy / tonne", "Unplanned trips"],
          personas: ["LNG Plant Manager", "VP LNG", "Head of Operations"],
        },
        {
          name: "Shipping & Cargo Optimization",
          useCases: [
            {
              name: "Cargo & Shipping Scheduling Optimization",
              description:
                "Optimise LNG fleet scheduling, voyage routing, and boil-off management across cargoes and contracts using vessel telemetry, voyage data, weather, and market signals — improving fleet utilisation and delivered-margin per cargo.",
              businessValue:
                "Higher fleet utilisation; reduced boil-off and demurrage; improved delivered margin per cargo.",
              typicalDataEntities: [
                "Vessel Telemetry & Position (AIS)",
                "Voyage & Charter Data",
                "Cargo Schedules",
                "Boil-off Rates",
                "Weather & Route Forecasts",
              ],
              typicalSourceSystems: [
                "Shipping / Fleet Management System",
                "AIS Provider",
                "Trading Platform",
                "Weather Data Provider",
              ],
            },
          ],
          kpis: ["Fleet utilisation", "Boil-off loss", "Demurrage cost", "Delivered margin / cargo"],
          personas: ["VP Shipping", "Head of LNG Marketing & Trading", "Fleet Operations Manager"],
        },
      ],
    },
    // -----------------------------------------------------------------------
    {
      name: "Downstream & Petrochemical Yield",
      whyChange:
        "Downstream refining and petrochemicals are margin businesses where fractions of a percent of yield, energy, and reliability decide profitability. Integrated operators run complex refinery-petrochemical sites whose process historians, lab (LIMS), planning, and reliability systems are seldom unified. Crude and feedstock slates shift, product specs tighten, and turnarounds dominate cost and risk. Operators who bring unit telemetry, LIMS, and planning data together — applying ML to yield and blend optimisation, advanced process control, and turnaround/reliability planning — lift margin per barrel, cut energy intensity, and de-risk the most expensive events in the plant calendar.",
      priorities: [
        {
          name: "Refinery & Petrochemical Optimization",
          useCases: [
            {
              name: "Refinery Yield & Blend Optimization",
              description:
                "Optimise unit yields, product blending, and energy use across the refinery and petrochemical complex using process telemetry, LIMS quality data, and planning models — maximising margin per barrel within product-spec and safety constraints.",
              businessValue:
                "Improved margin per barrel; reduced energy intensity and quality give-away; better feedstock selection.",
              typicalDataEntities: [
                "Unit Process Telemetry",
                "Lab Quality Results (LIMS)",
                "Blend Recipes",
                "Yield & Energy Metrics",
                "Planning & LP Models",
              ],
              typicalSourceSystems: ["DCS / APC", "Historian", "LIMS", "Refinery Planning (LP)"],
            },
            {
              name: "Turnaround & Reliability Planning",
              description:
                "Use maintenance, inspection, and reliability data to optimise turnaround scope, scheduling, and execution — reducing turnaround duration and cost while protecting reliability and safety.",
              businessValue:
                "Shorter, lower-cost turnarounds; fewer unplanned shutdowns; improved mechanical availability.",
              typicalDataEntities: [
                "Turnaround Scope & Schedule",
                "Inspection & Reliability Data",
                "Work Orders",
                "Spares & Materials",
                "Historical Turnaround Performance",
              ],
              typicalSourceSystems: ["CMMS / EAM", "Inspection Data Store", "Project Scheduling", "ERP"],
            },
          ],
          kpis: [
            "Margin per barrel",
            "Energy intensity index",
            "Mechanical availability",
            "Turnaround cost & duration",
          ],
          personas: ["Refinery General Manager", "VP Downstream", "Head of Petrochemicals"],
        },
      ],
    },
    // -----------------------------------------------------------------------
    {
      name: "Integrated Trading & Commercial",
      whyChange:
        "An integrated operator's trading and supply function turns physical volume and market volatility into margin — across crude, products, gas, LNG, and increasingly carbon. The edge comes from fusing real-time market data, physical position, freight, and operational signals (production, train availability, inventory) into one decision plane, and from quantifying and managing the risk on the book. Where this data is fragmented across trading platforms, ETRM, and operational systems, traders work blind to the physical reality upstream. Operators who close that gap make better-informed trading and scheduling decisions and reduce imbalance and risk-management cost.",
      priorities: [
        {
          name: "Trading, Supply & Risk",
          useCases: [
            {
              name: "Integrated Trading & Supply Analytics",
              description:
                "Provide real-time analytics for crude, products, gas, LNG, and carbon trading — fusing market prices, freight, physical position, and operational signals (production, train availability, inventory) to support traders, schedulers, and portfolio managers.",
              businessValue:
                "Higher trading P&L from better-informed decisions; reduced imbalance and demurrage; tighter integration of physical and paper books.",
              typicalDataEntities: [
                "Market Prices & Curves",
                "Physical Positions",
                "Freight & Voyage Costs",
                "Inventory & Nominations",
                "Operational Availability",
              ],
              typicalSourceSystems: [
                "Trading Platform / ETRM",
                "Market Data Feeds",
                "Shipping System",
                "Production / Inventory Systems",
              ],
            },
            {
              name: "Commodity Risk & Exposure Management",
              description:
                "Aggregate and quantify market, credit, and operational exposure across the physical and paper book — running scenario and VaR analytics to manage risk limits and inform hedging decisions.",
              businessValue:
                "Faster, more accurate exposure reporting; better hedging decisions; reduced risk-limit breaches.",
              typicalDataEntities: [
                "Positions & Trades",
                "Market & Volatility Curves",
                "Counterparty / Credit Data",
                "Risk Limits",
                "Scenario Definitions",
              ],
              typicalSourceSystems: ["ETRM", "Risk System", "Market Data Feeds", "ERP"],
            },
          ],
          kpis: ["Trading P&L", "Imbalance cost", "VaR / exposure accuracy", "Risk-limit breaches"],
          personas: ["VP Trading & Supply", "Chief Risk Officer", "Head of Portfolio Optimization"],
        },
      ],
    },
    // -----------------------------------------------------------------------
    {
      name: "Energy Transition & Corporate",
      whyChange:
        "Integrated operators and NOCs face two simultaneous mandates: decarbonise the core hydrocarbon business under intensifying disclosure regimes (CSRD, SEC climate, ISSB, OGMP 2.0), and build credible new-energy businesses — hydrogen, CCUS, renewables, and EV/mobility. Both are data problems. Audit-grade Scope 1/2/3 reporting demands integrated pipelines across operations, supply chain, and sustainability tooling; new-energy assets (electrolysers, CO₂ injection, renewables) generate telemetry that must be optimised like any other asset. NOCs additionally carry a national-development mandate and operate as critical national infrastructure, raising the bar on data sovereignty, partner/PSC data sharing, and cyber protection. Operators who treat transition and corporate reporting as governed data products — not spreadsheets — disclose defensibly, optimise new-energy assets, and protect the enterprise.",
      priorities: [
        {
          name: "Decarbonization & New Energy",
          useCases: [
            {
              name: "ESG & Emissions Reporting",
              description:
                "Automate Scope 1, 2, and 3 emissions tracking and ESG reporting using integrated pipelines spanning CEMS, ERP, supply chain, and sustainability tooling — producing audit-grade disclosures aligned with CSRD, SEC, ISSB, and OGMP 2.0.",
              businessValue:
                "60-80% reduction in manual ESG reporting effort; defensible disclosures with full lineage; faster transition-plan tracking.",
              typicalDataEntities: [
                "Emissions Data",
                "Energy Consumption",
                "Supply Chain Footprint",
                "ESG Metrics",
                "Disclosure Templates",
              ],
              typicalSourceSystems: ["CEMS", "ERP", "Sustainability Platform", "Supply Chain System"],
            },
            {
              name: "CCUS & Hydrogen Optimization",
              description:
                "Monitor and optimise CO₂ capture, injection, and storage (CCUS MMV) and hydrogen production (electrolyser telemetry, temperature/pressure/density) — assuring containment and maximising new-energy asset efficiency.",
              businessValue:
                "Assured CO₂ containment and MMV compliance; +10% hydrogen-production efficiency; de-risked new-energy investment.",
              typicalDataEntities: [
                "CO₂ Injection & Plume Monitoring",
                "Electrolyser Telemetry",
                "Containment / Geochemistry",
                "Process T/P/Density",
                "MMV Records",
              ],
              typicalSourceSystems: [
                "CCS Monitoring System",
                "Hydrogen Plant SCADA",
                "Historian",
                "Environmental Management System",
              ],
            },
          ],
          kpis: [
            "Scope 1/2/3 reporting effort",
            "Carbon intensity",
            "CO₂ stored & verified",
            "Hydrogen production efficiency",
          ],
          personas: ["Chief Sustainability Officer", "VP New Energy", "Head of Decarbonization"],
        },
        {
          name: "Corporate, Finance & Protection",
          useCases: [
            {
              name: "Integrated Financial Planning & Forecasting",
              description:
                "Improve planning accuracy with AI-driven forecasting that fuses operational metrics (production, throughput, train/asset availability) with market indicators (commodity prices, FX, demand) and macro scenarios — replacing static, spreadsheet-bound budgets.",
              businessValue:
                "Higher forecast accuracy; faster reforecast cycles; better capital allocation across the portfolio.",
              typicalDataEntities: [
                "Financial Actuals",
                "Operational Metrics",
                "Market Indicators",
                "Budget Plans",
                "Scenario Definitions",
              ],
              typicalSourceSystems: ["ERP", "Trading Platform", "Planning System", "Market Data Feeds"],
            },
            {
              name: "OT/IT Cyber & Critical-Infrastructure Protection",
              description:
                "Protect OT and IT estates and critical control systems by fusing security telemetry, OT network data, and IAM into ML-driven threat detection — defending critical national infrastructure against nation-state and ransomware threats while honouring data-sovereignty and partner/PSC data-sharing constraints.",
              businessValue:
                "Faster threat detection and response across OT/IT; reduced breach and ransomware exposure; protected critical infrastructure and licence to operate.",
              typicalDataEntities: [
                "Security & SIEM Logs",
                "OT Network Telemetry",
                "Identity & Access (IAM)",
                "Threat Intelligence",
                "Asset / Control-System Inventory",
              ],
              typicalSourceSystems: ["SIEM", "OT Security Platform", "Identity Provider", "Threat Intel Feeds"],
            },
          ],
          kpis: [
            "Forecast accuracy",
            "Capital-allocation efficiency",
            "Mean time to detect/respond (cyber)",
            "Critical-infrastructure incidents",
          ],
          personas: ["Chief Financial Officer", "Chief Information Security Officer", "Chief Digital Officer"],
        },
      ],
    },
  ],
};
