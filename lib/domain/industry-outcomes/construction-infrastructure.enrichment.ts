/**
 * Construction & Infrastructure -- Master Repository Enrichment Data (v2)
 *
 * Curated Reference Data Assets and Use Cases for Civil Infrastructure,
 * Building Construction, Project Controls (EVM), Subcontractor Procurement,
 * Heavy Plant Fleet, and HSE Safety.
 */

import type { MasterRepoUseCase, ReferenceDataAsset } from "./master-repo-types";

export const CONSTRUCTION_INFRASTRUCTURE_USE_CASES: MasterRepoUseCase[] = [
  {
    name: "Earned Value & Cost Forecasting",
    description:
      "Predict project Estimate-at-Completion (EAC) and cost overruns using WBS earned value metrics, subcontractor progress claims, commitment ledgers, and scope variations.",
    rationale:
      "Project controls/WBS actuals (A01) + P6 schedule progress (A02) + subcontractor variations (A03) detect CPI/SPI erosion months before manual month-end reviews.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Unrecovered project cost overrun",
    benchmarkImpact: "-15%",
    benchmarkSource: "McKinsey -- Reinventing Construction: A Route to Higher Productivity",
    benchmarkUrl:
      "https://www.mckinsey.com/capabilities/operations/our-insights/reinventing-construction-through-a-productivity-revolution",
    strategicImperative: "Optimize Project Delivery & Performance",
    strategicPillar: "Project Cost & Schedule Intelligence",
    dataAssetIds: ["A01", "A02", "A03", "A05"],
    dataAssetCriticality: {
      A01: "MC",
      A02: "MC",
      A03: "MC",
      A05: "VA",
    },
    totalLoeEstimate: "Medium",
    mcAccessDifficulty: "Low",
    vaAccessDifficulty: "Low",
    economicPatternName: "Loss Avoidance (Fraud / Shrink / Leakage / Errors)",
    economicImpactCategory: "Risk / Loss Avoidance",
    economicFormula: "Margin_erosion_yr * Delta_pct * Adopt% * Cap%",
    economicFormulaDescription:
      "Margin_erosion_yr = annual unrecovered budget overrun across active projects; Delta_pct = reduction from early WBS intervention and variation recovery.",
    economicPatternRationale:
      "Identifying WBS packages where burn rate exceeds physical progress early enables commercial variation capture and scope re-sequencing.",
  },
  {
    name: "Schedule Delay Prediction",
    description:
      "Predict critical-path slippage and liquidated-damages exposure using Primavera P6 schedules, site diary progress, weather forecasts, and material delivery lead times.",
    rationale:
      "P6 critical path activities (A02) + procurement/material deliveries (A04) + site diaries & weather (A07, A08) quantify milestone delay probability.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Schedule slippage & liquidated damages",
    benchmarkImpact: "-20%",
    benchmarkSource:
      "Construction Industry Institute (CII) -- Advanced Work Packaging & Schedule Analytics",
    benchmarkUrl: "https://www.construction-institute.org/",
    strategicImperative: "Optimize Project Delivery & Performance",
    strategicPillar: "Project Cost & Schedule Intelligence",
    dataAssetIds: ["A02", "A04", "A07", "A08"],
    dataAssetCriticality: {
      A02: "MC",
      A04: "MC",
      A07: "VA",
      A08: "VA",
    },
    totalLoeEstimate: "Medium",
    mcAccessDifficulty: "Low",
    vaAccessDifficulty: "Low",
    economicPatternName: "Risk Avoidance (Compliance / Penalties / Outage Impact)",
    economicImpactCategory: "Risk / Loss Avoidance",
    economicFormula: "LD_and_prelim_exposure_yr * Delta_prob * Severity * Adopt% * Cap%",
    economicFormulaDescription:
      "LD_and_prelim_exposure_yr = annual liquidated damages and prolongation preliminary costs; Delta_prob = reduction in late milestone completion.",
    economicPatternRationale:
      "Every week of critical-path delay incurs site preliminary overhead and liquidated damages; early re-sequencing protects handover dates.",
  },
  {
    name: "Contract & Variation Claim Intelligence (NLP)",
    description:
      "Extract notice deadlines, latent-condition clauses, RFI links, and entitlement evidence across contracts, site diaries, and correspondence.",
    rationale:
      "Contract & RFI documents (A03, A05) + site diaries (A07) + WBS cost impacts (A01) prevent time-bar forfeitures on legitimate variation claims.",
    modelType: "Advanced — GenAI",
    kpiTarget: "Variation claim recovery & QS review productivity",
    benchmarkImpact: "+10%",
    benchmarkSource: "Arcadis -- Global Construction Disputes Report",
    benchmarkUrl: "https://www.arcadis.com/",
    strategicImperative: "Increase Revenue",
    strategicPillar: "Commercial & Contract Management",
    dataAssetIds: ["A03", "A05", "A07", "A01"],
    dataAssetCriticality: {
      A03: "MC",
      A05: "MC",
      A01: "MC",
      A07: "VA",
    },
    totalLoeEstimate: "Medium",
    mcAccessDifficulty: "Low",
    vaAccessDifficulty: "Low",
    economicPatternName: "Revenue Uplift (Conversion / Attach / Cross-sell)",
    economicImpactCategory: "Revenue",
    economicFormula: "Variation_pool_yr * Delta_recovery_pct * Adopt% * Cap%",
    economicFormulaDescription:
      "Variation_pool_yr = annual value of scope changes and delay claims submitted; Delta_recovery_pct = incremental commercial recovery from timely notice and evidence linking.",
    economicPatternRationale:
      "Automated clause and site-diary linking stops quantity surveyors from missing contractual time-bars and substantiates variation claims.",
  },
  {
    name: "Heavy Plant & Equipment Utilisation and Predictive Maintenance",
    description:
      "Optimise yellow-iron fleet allocation, idle time, and preventative maintenance across project sites using telematics and plant hire ledgers.",
    rationale:
      "Plant telematics (A06) + internal/external plant hire invoices (A01, A04) + P6 site schedules (A02) eliminate idle hired equipment and unplanned breakdowns.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Plant hire & equipment operating cost",
    benchmarkImpact: "-12%",
    benchmarkSource: "Association of Equipment Management Professionals (AEMP)",
    benchmarkUrl: "https://www.aemp.org/",
    strategicImperative: "Reduce Cost",
    strategicPillar: "Fleet & Plant Optimization",
    dataAssetIds: ["A06", "A01", "A04", "A02"],
    dataAssetCriticality: {
      A06: "MC",
      A01: "MC",
      A04: "MC",
      A02: "VA",
    },
    totalLoeEstimate: "Low",
    mcAccessDifficulty: "Low",
    vaAccessDifficulty: "Low",
    economicPatternName: "Cost Takeout (Labor / Opex Reduction)",
    economicImpactCategory: "Cost",
    economicFormula: "Plant_spend_yr * Delta_pct * Adopt% * Cap%",
    economicFormulaDescription:
      "Plant_spend_yr = annual owned and wet/dry-hired plant expenditure; Delta_pct = savings from off-hiring underutilised equipment and reducing fuel/repair cost.",
    economicPatternRationale:
      "Engine-hour telemetry paired with hire ledgers immediately flags externally rented excavators and cranes sitting idle on site.",
  },
  {
    name: "Site HSE Hazard & High-Risk Work Incident Prevention",
    description:
      "Predict high-risk site safety windows using SWMS permits, subcontractor onboarding, fatigue/timecard hours, near-miss reports, and weather.",
    rationale:
      "HSE incidents & permits (A07) + site access/timecards (A07) + weather (A08) + schedule density (A02) highlight high-consequence risk zones.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Lost-time & recordable injury frequency (TRIFR)",
    benchmarkImpact: "-20%",
    benchmarkSource: "Safe Work Australia / OSHA -- Construction Safety Statistics",
    benchmarkUrl: "https://www.safeworkaustralia.gov.au/",
    strategicImperative: "Enhance Safety",
    strategicPillar: "HSE & Workforce Safety",
    dataAssetIds: ["A07", "A02", "A08", "A03"],
    dataAssetCriticality: {
      A07: "MC",
      A02: "MC",
      A08: "VA",
      A03: "VA",
    },
    totalLoeEstimate: "Low",
    mcAccessDifficulty: "Low",
    vaAccessDifficulty: "Low",
    economicPatternName: "Loss Avoidance (Fraud / Shrink / Leakage / Errors)",
    economicImpactCategory: "Risk / Loss Avoidance",
    economicFormula: "Incidents_yr * Cost_per_incident * Delta_pct * Adopt% * Cap%",
    economicFormulaDescription:
      "Incidents_yr = baseline annual recordable incidents and site shutdowns; Cost_per_incident = direct medical, investigation, and site stand-down cost.",
    economicPatternRationale:
      "Targeting supervisor walks to high-density concurrent work zones reduces lost-time injuries and regulatory work stoppages.",
  },
];

export const CONSTRUCTION_INFRASTRUCTURE_DATA_ASSETS: ReferenceDataAsset[] = [
  {
    id: "A01",
    name: "Project Controls, WBS Cost Ledger & Earned Value (EVM)",
    description:
      "Work Breakdown Structure (WBS) budgets, actual costs, commitments, earned value (BCWP/ACWP), and cashflow forecasts.",
    systemLocation: "ERP / Jobpac / Coins / SAP / EcoSys",
    assetFamily: "Project Controls & Finance",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
    systemKind: "ERP",
  },
  {
    id: "A02",
    name: "Master Project Schedules & Critical Path (Primavera P6 / MS Project)",
    description:
      "Baseline and current P6 schedules, activity logic links, float, milestone dates, and look-ahead programmes.",
    systemLocation: "Oracle Primavera P6 / Asta Powerproject",
    assetFamily: "Project Controls & Finance",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
    systemKind: "ERP",
  },
  {
    id: "A03",
    name: "Subcontractor Contracts, Progress Claims & Variations",
    description:
      "Subcontract packages, monthly payment claims (SOPA), variations/change orders, back-charges, and retention ledgers.",
    systemLocation: "Procore / Aconex / ERP",
    assetFamily: "Commercial & Procurement",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
    systemKind: "ERP",
  },
  {
    id: "A04",
    name: "Material Procurement, Purchase Orders & Site Delivery Dockets",
    description:
      "Concrete, steel, precast, and MEP purchase orders, supplier lead times, weighbridge dockets, and embodied carbon factors.",
    systemLocation: "ERP / SCM",
    assetFamily: "Commercial & Procurement",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
    systemKind: "ERP",
  },
  {
    id: "A05",
    name: "BIM Models, Drawings, RFIs & Engineering Submittals (CDE)",
    description:
      "Common Data Environment (CDE) document revisions, RFIs, design clashes, ITPs, defects, and as-built handover packages.",
    systemLocation: "Autodesk Construction Cloud / Aconex / Bentley",
    assetFamily: "Engineering & Design",
    easeOfAccess: "Medium",
    lakeflowConnect: "High",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
    bespoke: "Low",
    systemKind: "EDMS",
  },
  {
    id: "A06",
    name: "Heavy Plant & Yellow-Iron Fleet Telematics",
    description:
      "Excavator, crane, grader, and haul truck GPS, engine hours, idle burn, fault codes, and EAM maintenance history.",
    systemLocation: "VisionLink / Komtrax / Telematics / Maximo",
    assetFamily: "Plant & Equipment",
    easeOfAccess: "Medium",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
    bespoke: "High",
    systemKind: "CMMS / EAM",
  },
  {
    id: "A07",
    name: "Site Diaries, Workforce Turnstiles & HSE Safety Permits",
    description:
      "Daily site diaries, biometric turnstile hours, SWMS/permits-to-work, safety observations, and incident reports.",
    systemLocation: "HammerTech / Damstra / Procore HSE",
    assetFamily: "Workforce & Safety",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
    systemKind: "HRIS",
  },
  {
    id: "A08",
    name: "Site Weather, Geotechnical & Environmental Monitoring",
    description:
      "Site rain/wind gauges, dust/noise/vibration monitors, groundwater sensors, and inclement-weather delay logs.",
    systemLocation: "Environmental IoT / Weather API",
    assetFamily: "External & Environmental",
    easeOfAccess: "Low",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
    bespoke: "High",
  },
];
