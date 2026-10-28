/**
 * Water Utilities -- Master Repository Enrichment Data (v2)
 *
 * Curated Reference Data Assets and Use Cases for Clean Water Supply,
 * Wastewater & Sewerage, Bulk Water & Dam Operations, and Network Operations.
 */

import type { MasterRepoUseCase, ReferenceDataAsset } from "./master-repo-types";

export const WATER_UTILITIES_USE_CASES: MasterRepoUseCase[] = [
  {
    name: "Non-Revenue Water Detection",
    description:
      "Classify and locate leakage using pressure sensor, DMA flow, and minimum night flow data to prioritise repair and pressure management interventions.",
    rationale:
      "DMA flow/pressure telemetry (A01) + pipe network GIS (A02) + work order history (A04) isolate acoustic/hydraulic anomalies; smart meter reads (A03) separate apparent from real losses.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Non-revenue water loss",
    benchmarkImpact: "-15%",
    benchmarkSource: "IWA / World Bank -- Non-Revenue Water Management",
    benchmarkUrl: "https://iwa-network.org/projects/water-loss/",
    strategicImperative: "Optimize Network & Bulk Water Operations",
    strategicPillar: "Leakage Reduction & Network Efficiency",
    dataAssetIds: ["A01", "A02", "A03", "A04", "A05"],
    dataAssetCriticality: {
      A01: "MC",
      A02: "MC",
      A03: "MC",
      A04: "VA",
      A05: "VA",
    },
    totalLoeEstimate: "Medium",
    mcAccessDifficulty: "Medium",
    vaAccessDifficulty: "Low",
    economicPatternName: "Waste Reduction (Spoilage / Returns / Write-downs)",
    economicImpactCategory: "Cost",
    economicFormula: "Leakage_ML_yr * Cost_per_ML * Delta_pct * Adopt% * Cap%",
    economicFormulaDescription:
      "Leakage_ML_yr = annual non-revenue water volume in megalitres; Cost_per_ML = marginal treatment + pumping cost per ML; Delta_pct = % reduction in leakage; Adopt% = % of DMAs instrumented; Cap% = net realized savings.",
    economicPatternRationale:
      "Early leak pinpointing reduces treated water lost before reaching customer meters and avoids emergency main breaks.",
  },
  {
    name: "Pipe Burst & Asset Failure Prediction",
    description:
      "Predict trunk and reticulation main failure probability using pipe age, material, soil corrosivity, pressure transients, and historical break logs.",
    rationale:
      "GIS pipe inventory (A02) + CMMS failure history (A04) + pressure transient telemetry (A01) + soil/weather data (A05) drive survival hazard models.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Unplanned main breaks",
    benchmarkImpact: "-25%",
    benchmarkSource: "AWWA -- State of the Water Industry",
    benchmarkUrl: "https://www.awwa.org/resources-tools/water-and-wastewater-utility-management/",
    strategicImperative: "Optimize Network & Bulk Water Operations",
    strategicPillar: "Predictive Asset Management",
    dataAssetIds: ["A02", "A04", "A01", "A05", "A06"],
    dataAssetCriticality: {
      A02: "MC",
      A04: "MC",
      A01: "MC",
      A05: "VA",
      A06: "VA",
    },
    totalLoeEstimate: "Medium",
    mcAccessDifficulty: "Medium",
    vaAccessDifficulty: "Low",
    economicPatternName: "Risk Avoidance (Compliance / Penalties / Outage Impact)",
    economicImpactCategory: "Risk / Loss Avoidance",
    economicFormula: "Breaks_yr * Delta_prob * Emergency_cost_delta * Adopt% * Cap%",
    economicFormulaDescription:
      "Breaks_yr = baseline annual main breaks; Delta_prob = fraction of breaks prevented via proactive renewal; Emergency_cost_delta = emergency repair + regulatory penalty minus planned replacement cost.",
    economicPatternRationale:
      "Condition-based pipe renewal shifts reactive emergency repairs to lower-cost planned capital works.",
  },
  {
    name: "Pumping Station Energy Optimization",
    description:
      "Optimise pump scheduling against time-of-use electricity tariffs, reservoir storage levels, and diurnal demand forecasts.",
    rationale:
      "SCADA pump telemetry (A01) + demand forecasts (A03) + energy tariff schedules (A06) allow load shifting to off-peak periods while maintaining reservoir head constraints.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Pumping electricity spend",
    benchmarkImpact: "-12%",
    benchmarkSource: "US EPA -- Energy Efficiency for Water Utilities",
    benchmarkUrl:
      "https://www.epa.gov/sustainable-water-infrastructure/energy-efficiency-water-utilities",
    strategicImperative: "Optimize Network & Bulk Water Operations",
    strategicPillar: "Energy & Treatment Efficiency",
    dataAssetIds: ["A01", "A03", "A06", "A05"],
    dataAssetCriticality: {
      A01: "MC",
      A03: "MC",
      A06: "MC",
      A05: "VA",
    },
    totalLoeEstimate: "Medium",
    mcAccessDifficulty: "Medium",
    vaAccessDifficulty: "Low",
    economicPatternName: "Cost Takeout (Labor / Opex Reduction)",
    economicImpactCategory: "Cost",
    economicFormula: "Pump_kWh_yr * Tariff_per_kWh * Delta_pct * Adopt% * Cap%",
    economicFormulaDescription:
      "Pump_kWh_yr = annual pumping electricity consumption; Tariff_per_kWh = blended peak/off-peak tariff; Delta_pct = cost reduction from tariff arbitrage and pump efficiency.",
    economicPatternRationale:
      "Pumping accounts for the largest controllable OPEX item in water distribution; schedule optimization directly lowers power bills.",
  },
  {
    name: "Treatment Chemical Dosing Optimization",
    description:
      "Dynamically adjust coagulant, chlorine, and pH dosing rates using real-time raw water turbidity, organic load, and flow sensors.",
    rationale:
      "Water quality lab/sensor feeds (A07) + SCADA plant telemetry (A01) + weather/catchment runoff (A05) predict influent changes before clarifier upset.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Chemical consumption",
    benchmarkImpact: "-10%",
    benchmarkSource: "Water Research Foundation -- Intelligent Water Systems",
    benchmarkUrl: "https://www.waterrf.org/",
    strategicImperative: "Improve Water Quality",
    strategicPillar: "Treatment Plant Intelligence",
    dataAssetIds: ["A07", "A01", "A05", "A06"],
    dataAssetCriticality: {
      A07: "MC",
      A01: "MC",
      A05: "VA",
      A06: "VA",
    },
    totalLoeEstimate: "Medium",
    mcAccessDifficulty: "Medium",
    vaAccessDifficulty: "Low",
    economicPatternName: "Cost Takeout (Labor / Opex Reduction)",
    economicImpactCategory: "Cost",
    economicFormula: "Chem_spend_yr * Delta_pct * Adopt% * Cap%",
    economicFormulaDescription:
      "Chem_spend_yr = annual coagulant and disinfectant spend; Delta_pct = reduction in overdosing margin; Adopt% = share of treatment plants enabled.",
    economicPatternRationale:
      "Model-predictive dosing eliminates safety-margin overdosing during stable raw-water conditions while maintaining strict potability compliance.",
  },
  {
    name: "Sewer Blockage & Spill Prediction",
    description:
      "Predict sewer chokes and dry/wet-weather overflows using sewer level sensors, rainfall radar, trade-waste profiles, and CCTV inspection defects.",
    rationale:
      "Sewer level telemetry (A01) + GIS/CCTV condition records (A02) + weather radar (A05) + CMMS jetting history (A04) flag rising silt/FOG accumulation.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Wastewater overflow incidents",
    benchmarkImpact: "-20%",
    benchmarkSource: "Ofwat / UKWIR -- Pollution Incident Reduction",
    benchmarkUrl: "https://www.ofwat.gov.uk/",
    strategicImperative: "Mitigate Risk",
    strategicPillar: "Wastewater & Environmental Compliance",
    dataAssetIds: ["A01", "A02", "A04", "A05", "A08"],
    dataAssetCriticality: {
      A01: "MC",
      A02: "MC",
      A04: "MC",
      A05: "VA",
      A08: "VA",
    },
    totalLoeEstimate: "Medium",
    mcAccessDifficulty: "Medium",
    vaAccessDifficulty: "Low",
    economicPatternName: "Risk Avoidance (Compliance / Penalties / Outage Impact)",
    economicImpactCategory: "Risk / Loss Avoidance",
    economicFormula: "Spill_exposure_yr * Delta_prob * Penalty_per_spill * Adopt% * Cap%",
    economicFormulaDescription:
      "Spill_exposure_yr = expected annual reportable sewer overflows; Delta_prob = reduction from proactive jetting; Penalty_per_spill = environmental fine + clean-up cost.",
    economicPatternRationale:
      "Preventative sewer jetting triggered by level-sensor trend anomalies avoids environmental fines and property flooding claims.",
  },
];

export const WATER_UTILITIES_DATA_ASSETS: ReferenceDataAsset[] = [
  {
    id: "A01",
    name: "SCADA & Telemetry Historian (Flow, Pressure, Level)",
    description:
      "Real-time DMA flow, pressure transients, reservoir levels, pump status, and sewer level telemetry.",
    systemLocation: "SCADA / PI Historian",
    assetFamily: "Network & Plant OT",
    easeOfAccess: "Medium",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
    bespoke: "High",
    systemKind: "SCADA / Historian",
  },
  {
    id: "A02",
    name: "Pipe & Network GIS Asset Registry",
    description:
      "Spatial topology of water mains, sewer gravity/rising mains, valves, hydrants, material, diameter, and install year.",
    systemLocation: "GIS / Esri ArcGIS",
    assetFamily: "Asset Management",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
    systemKind: "Other",
  },
  {
    id: "A03",
    name: "AMI / Smart Water Meter Reads & Billing",
    description:
      "Interval and quarterly customer water consumption reads, tariff classes, and billing accounts.",
    systemLocation: "MDMS / CIS Billing",
    assetFamily: "Customer & Metering",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
    systemKind: "CRM",
  },
  {
    id: "A04",
    name: "Work Orders & Maintenance History (CMMS)",
    description:
      "Reactive main breaks, leak repairs, sewer jetting, pump overhauls, and CCTV condition grades.",
    systemLocation: "SAP PM / Maximo",
    assetFamily: "Asset Management",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
    systemKind: "CMMS / EAM",
  },
  {
    id: "A05",
    name: "Catchment Weather, Rainfall & Soil Moisture",
    description:
      "Gridded rainfall radar, inflow forecasts, evaporation, temperature, and soil corrosivity maps.",
    systemLocation: "Weather API / BOM / NOAA",
    assetFamily: "External & Environmental",
    easeOfAccess: "Low",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
    bespoke: "High",
  },
  {
    id: "A06",
    name: "ERP Finance, Energy Tariffs & Capital Projects",
    description:
      "Electricity time-of-use tariffs, chemical procurement invoices, OPEX/CAPEX actuals, and WBS schedules.",
    systemLocation: "ERP / SAP / Oracle",
    assetFamily: "Finance & Procurement",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
    systemKind: "ERP",
  },
  {
    id: "A07",
    name: "LIMS & Online Water Quality Analysers",
    description:
      "Lab sample results and online analyser feeds for turbidity, free chlorine, pH, E. coli, PFAS, and dissolved oxygen.",
    systemLocation: "LIMS",
    assetFamily: "Water Quality & Compliance",
    easeOfAccess: "Medium",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
    systemKind: "QMS / LIMS",
  },
  {
    id: "A08",
    name: "Customer Contact, Complaints & Trade Waste Permits",
    description:
      "Water pressure/taste/odour complaints, outage notifications, and industrial trade-waste discharge permits.",
    systemLocation: "CRM / Contact Centre",
    assetFamily: "Customer & Metering",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
    systemKind: "CRM",
  },
];
