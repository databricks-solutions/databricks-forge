import type { IndustryOutcome } from "./index";

export const ENERGY_UTILITIES: IndustryOutcome = {
  id: "energy-utilities",
  name: "Energy & Utilities",
  subVerticals: [
    "Oil & Gas (Upstream/Midstream/Downstream)",
    "Renewables (Solar, Wind, Hydro)",
    "Electric Utilities",
    "Gas & Water Utilities",
    "Energy Trading",
  ],
  suggestedDomains: [
    "Operations",
    "Supply Chain",
    "Sustainability",
    "Finance",
    "Customer Experience",
    "Cybersecurity",
  ],
  suggestedPriorities: [
    "Optimize Operations",
    "Reduce Cost",
    "Achieve ESG",
    "Mitigate Risk",
    "Increase Revenue",
  ],
  objectives: [
    {
      name: "Optimize Operations",
      whyChange:
        "The energy transition is reshaping operations on every front: distributed renewables (solar, wind, BESS) introduce intermittency the grid was never designed for; ageing transmission and distribution infrastructure is being asked to carry more load with tighter reliability standards; oilfield and downstream margins live or die on real-time production optimization; and safety incidents carry catastrophic financial, regulatory, and human cost. Data-driven operations -- IoT-instrumented assets, ML-based predictive maintenance, ADMS-grounded grid optimization, and computer-vision safety monitoring -- have moved from differentiator to baseline. Operators who close the loop between sensor telemetry and operational decisions reduce unplanned downtime by 20-50%, defer capital expenditure, and prevent the kind of incidents that end careers.",
      priorities: [
        {
          name: "Process & Operations Efficiency",
          useCases: [
            {
              name: "Production Optimization",
              description:
                "Optimize energy production processes (generation dispatch, well rates, refinery yields, renewable plant performance) using real-time analytics, digital twins, and AI -- finding setpoints that maximise output and efficiency while respecting safety and equipment-life constraints.",
              businessValue:
                "2-5% improvement in production efficiency; reduced fuel consumption and emissions per MWh produced.",
              typicalDataEntities: [
                "Production Output",
                "Process Parameters",
                "Fuel Consumption",
                "Efficiency Metrics",
                "Setpoint Configurations",
              ],
              typicalSourceSystems: ["SCADA", "Historian", "DCS", "Plant Information System"],
            },
            {
              name: "Predictive Maintenance for Energy Assets",
              description:
                "Predict equipment failures across generation, transmission, and distribution assets (turbines, transformers, compressors, gearboxes, switchgear) using ML on vibration, thermal, electrical, and acoustic sensor signatures -- enabling condition-based maintenance instead of calendar-based and reducing unplanned downtime.",
              businessValue:
                "20-50% reduction in unplanned downtime; $6M+ infrastructure cost savings demonstrated (Viessmann case); deferred capex on healthy assets.",
              typicalDataEntities: [
                "IoT Sensor Readings",
                "Equipment Maintenance History",
                "Asset Registry",
                "Failure Mode Catalogue",
                "Remaining Useful Life Predictions",
              ],
              typicalSourceSystems: [
                "SCADA",
                "CMMS",
                "Asset Management System",
                "Historian",
                "IoT Platform",
              ],
            },
            {
              name: "Grid Optimization",
              description:
                "Optimize electricity transmission and distribution networks for efficiency, reliability, voltage stability, and renewable integration -- using ADMS, smart-meter data, weather forecasts, and DER (Distributed Energy Resource) telemetry to balance load, reduce losses, and avoid outages.",
              businessValue:
                "Lower transmission losses; better SAIDI/SAIFI reliability metrics; higher renewable hosting capacity without grid reinforcement.",
              typicalDataEntities: [
                "Smart Meter Data",
                "Grid Topology",
                "Weather Forecasts",
                "DER Telemetry",
                "Voltage / Frequency Measurements",
              ],
              typicalSourceSystems: [
                "ADMS",
                "Smart Meter Infrastructure",
                "SCADA",
                "DERMS",
                "GIS",
              ],
            },
            {
              name: "Well Performance Optimization",
              description:
                "Use subsurface data interpretation and ML on production logs, pressure-volume-temperature data, and reservoir simulations to optimize oil and gas well performance, identify under-performing wells, and recommend interventions (chemical treatment, recompletion, artificial lift adjustments).",
              businessValue:
                "5-15% production uplift on underperforming wells; better-targeted intervention spend.",
              typicalDataEntities: [
                "Well Production Data",
                "Subsurface Logs",
                "Reservoir Models",
                "Completion Data",
                "Intervention History",
              ],
              typicalSourceSystems: [
                "Historian",
                "Petroleum Data Management",
                "Reservoir Simulation",
                "Production Allocation",
              ],
            },
          ],
          kpis: [
            "Asset uptime (%)",
            "Production efficiency",
            "Energy loss reduction",
            "Maintenance cost savings",
          ],
          personas: ["VP Operations", "Head of Asset Management", "Chief Operating Officer"],
        },
        {
          name: "Asset Management & Safety",
          useCases: [
            {
              name: "Asset Health Monitoring",
              description:
                "Monitor the condition of critical assets (turbines, transformers, pipelines, compressors) in real-time using IoT sensors and AI -- producing condition scores, trend alerts, and recommended actions before failure modes reach disruptive thresholds.",
              businessValue:
                "Lower CAPEX deferral cost; avoided catastrophic failures; cleaner audit trail for regulatory inspections.",
              typicalDataEntities: [
                "Sensor Readings",
                "Asset Configuration",
                "Condition Indicators",
                "Alarm History",
                "Health Scores",
              ],
              typicalSourceSystems: [
                "SCADA",
                "IoT Platform",
                "Asset Management System",
                "Historian",
              ],
            },
            {
              name: "Safety Event Prediction",
              description:
                "Use ML on operational telemetry (pressure, flow, temperature, vibration, gas readings) to predict safety incidents -- well-bore influxes, equipment runaway, leak precursors -- providing minutes-to-hours of advance warning that enables preventive intervention.",
              businessValue:
                "Predict dangerous well-bore influxes 45 minutes before they occur (NOV case); fewer Tier 1/2 process safety events; protected social licence to operate.",
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
              name: "Environmental Monitoring",
              description:
                "Monitor emissions, methane leaks, water discharge, and environmental impact in real-time using continuous emissions monitoring systems, satellite data, and sensor networks -- automatically flagging breaches and feeding regulator-ready audit trails.",
              businessValue:
                "Reduced regulatory penalty exposure; faster leak response; supports CSRD / TCFD / SEC climate disclosure obligations.",
              typicalDataEntities: [
                "Emissions Readings",
                "Leak Detection Data",
                "Environmental Sensors",
                "Compliance Thresholds",
                "Satellite Imagery",
              ],
              typicalSourceSystems: [
                "CEMS",
                "SCADA",
                "Environmental Management System",
                "Satellite Data Provider",
              ],
            },
          ],
          kpis: ["Safety incident reduction", "Asset reliability", "Environmental compliance"],
          personas: ["Head of HSE", "VP Asset Integrity", "Chief Safety Officer"],
        },
      ],
    },
    {
      name: "Streamline Business Functions",
      whyChange:
        "Energy companies operate under intensifying disclosure regimes (CSRD, SEC climate rules, ISSB, regional ESG mandates) that demand audit-grade Scope 1/2/3 emissions data, supply-chain footprint, and progress against transition plans. At the same time, energy markets have become more volatile (geopolitics, weather, renewables intermittency), making accurate trading and financial forecasting a differentiator. Operators must reduce cost, increase reporting accuracy, and accelerate decision-making by automating compliance, modernising enterprise BI, and integrating market, weather, and operational signals into financial planning -- replacing manual workflows that buckle under the new disclosure burden.",
      priorities: [
        {
          name: "Compliance Management & Reporting",
          useCases: [
            {
              name: "ESG & Emissions Reporting",
              description:
                "Automate Scope 1, 2, and 3 emissions tracking and ESG reporting using integrated data pipelines spanning CEMS, ERP, supply chain, and sustainability tooling -- producing audit-grade disclosures aligned with CSRD, SEC, ISSB, and regional schemes.",
              businessValue:
                "60-80% reduction in manual ESG reporting effort; defensible disclosures with full lineage; faster transition-plan tracking.",
              typicalDataEntities: [
                "Emissions Data",
                "Energy Consumption",
                "Supply Chain Footprint",
                "ESG Metrics",
                "Disclosure Templates",
              ],
              typicalSourceSystems: [
                "CEMS",
                "ERP",
                "Sustainability Platform",
                "Supply Chain System",
              ],
            },
            {
              name: "Regulatory Compliance Automation",
              description:
                "Automate compliance with energy and environmental regulations across jurisdictions -- pipeline integrity, NERC CIP, FERC, EPA, EU ETS, and others -- producing audit evidence and regulator returns directly from operational systems.",
              businessValue:
                "Lower compliance staffing cost; fewer audit findings; reduced enforcement-action risk.",
              typicalDataEntities: [
                "Regulatory Requirements",
                "Compliance Evidence",
                "Audit Logs",
                "Reporting Schedules",
                "Control Effectiveness Tests",
              ],
              typicalSourceSystems: [
                "ERP",
                "GRC Platform",
                "Regulatory Data Sources",
                "SCADA",
              ],
            },
          ],
          kpis: ["Reporting accuracy", "Compliance cost reduction", "Emissions reduction tracking"],
          personas: ["Chief Sustainability Officer", "VP Compliance", "Chief Financial Officer"],
        },
        {
          name: "Enterprise Business Intelligence",
          useCases: [
            {
              name: "Energy Trading Analytics",
              description:
                "Provide real-time analytics for power, gas, oil, and carbon trading decisions -- incorporating market price data, weather, demand forecasts, transmission constraints, and asset availability -- to support traders, schedulers, and portfolio managers.",
              businessValue:
                "Higher P&L from better-informed trading and scheduling decisions; reduced imbalance settlement cost.",
              typicalDataEntities: [
                "Market Prices",
                "Position Data",
                "Weather Forecasts",
                "Demand Forecasts",
                "Transmission Constraints",
              ],
              typicalSourceSystems: [
                "Trading Platform",
                "Market Data Feeds",
                "EMS",
                "Weather Data Provider",
                "ISO/RTO Data",
              ],
            },
            {
              name: "Financial Planning & Forecasting",
              description:
                "Improve financial planning accuracy with AI-driven forecasting that incorporates operational metrics (production, throughput, asset availability) alongside market indicators (commodity prices, FX, demand) and macro scenarios -- replacing static, spreadsheet-bound budgets with dynamic, scenario-aware forecasts.",
              businessValue:
                "Higher forecast accuracy; faster reforecast cycles; better capital allocation decisions.",
              typicalDataEntities: [
                "Financial Actuals",
                "Operational Metrics",
                "Market Indicators",
                "Budget Plans",
                "Scenario Definitions",
              ],
              typicalSourceSystems: [
                "ERP",
                "Trading Platform",
                "Planning System",
                "Market Data Feeds",
              ],
            },
          ],
          kpis: ["Forecast accuracy", "Decision speed", "Cost-to-serve optimization"],
          personas: ["Chief Financial Officer", "VP Trading", "Head of Analytics"],
        },
      ],
    },
    {
      name: "Collaborate & Protect Data/IP",
      whyChange:
        "Energy is critical national infrastructure, which makes the sector a top target for nation-state cyber actors and ransomware groups -- the Colonial Pipeline incident moved cybersecurity from board concern to existential risk overnight. At the same time, retail energy markets are deregulating in many regions, putting customer experience and engagement at the centre of margin defence. Operators must protect IP, OT/IT estates, and grid control systems with the same rigour as financial services while delivering personalised, app-based customer experiences (smart meters, dynamic pricing, demand response). The sophisticated balance between collaboration, sovereignty, and protection is now a core capability.",
      priorities: [
        {
          name: "Customer Experience",
          useCases: [
            {
              name: "Customer Demand Response",
              description:
                "Optimize demand response programs using smart-meter data, weather forecasts, and ML demand models to balance grid load -- targeting the right customers, at the right times, with appropriately-priced incentives, while tracking participation and savings outcomes.",
              businessValue:
                "Deferred peaker plant CAPEX; reduced wholesale market exposure; new revenue stream from grid-services participation.",
              typicalDataEntities: [
                "Smart Meter Data",
                "Demand Response Events",
                "Customer Participation",
                "Grid Load",
                "Weather Forecasts",
              ],
              typicalSourceSystems: [
                "MDM",
                "Demand Response Platform",
                "SCADA",
                "ADMS",
              ],
            },
            {
              name: "Personalized Energy Recommendations",
              description:
                "Provide personalized energy-saving recommendations and tariff suggestions to customers based on consumption patterns, building attributes, weather, and peer benchmarks -- delivered via web, app, and bills to drive engagement and reduce churn.",
              businessValue:
                "Higher customer satisfaction (NPS / JD Power scores); reduced retail churn in deregulated markets.",
              typicalDataEntities: [
                "Consumption History",
                "Building Attributes",
                "Weather Data",
                "Benchmark Comparisons",
                "Tariff Configurations",
              ],
              typicalSourceSystems: [
                "MDM",
                "CRM",
                "Billing System",
                "Customer Portal",
              ],
            },
          ],
          kpis: [
            "Customer satisfaction",
            "Demand response participation",
            "Energy savings per customer",
          ],
          personas: ["VP Customer Experience", "Head of Retail Energy", "Chief Digital Officer"],
        },
      ],
    },
  ],
};
