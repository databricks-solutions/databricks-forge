/**
 * Rail Transport & Logistics -- Master Repository Enrichment Data (v2)
 *
 * Curated Reference Data Assets and Use Cases for Freight Rail, Heavy Haul,
 * Passenger Rail, Rolling Stock Maintenance, and Signalling/Track Infrastructure.
 */

import type { MasterRepoUseCase, ReferenceDataAsset } from "./master-repo-types";

export const RAIL_TRANSPORT_USE_CASES: MasterRepoUseCase[] = [
  {
    name: "Timetable Optimization",
    description:
      "Use ML-based conflict resolution to generate optimised timetables that maximise path utilisation across single- and multi-track corridors.",
    rationale:
      "Train control/movement logs (A01) + network topology & possessions (A02) + rolling stock availability (A03) + terminal/port slots (A06) drive throughput.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Corridor path utilisation",
    benchmarkImpact: "+8%",
    benchmarkSource: "UIC / International Union of Railways -- Digital Rail Operations",
    benchmarkUrl: "https://uic.org/",
    strategicImperative: "Optimize Network & Train Operations",
    strategicPillar: "Train Performance & Scheduling",
    dataAssetIds: ["A01", "A02", "A03", "A06"],
    dataAssetCriticality: {
      A01: "MC",
      A02: "MC",
      A03: "MC",
      A06: "VA",
    },
    totalLoeEstimate: "High",
    mcAccessDifficulty: "Medium",
    vaAccessDifficulty: "Low",
    economicPatternName: "Revenue Uplift (Conversion / Attach / Cross-sell)",
    economicImpactCategory: "Revenue",
    economicFormula: "Train_paths_yr * Delta_paths_pct * Margin_per_path * Adopt% * Cap%",
    economicFormulaDescription:
      "Train_paths_yr = annual operated train paths on constrained corridors; Delta_paths_pct = incremental path capacity unlocked; Margin_per_path = net haulage contribution per train path.",
    economicPatternRationale:
      "De-conflicting meet/pass events on constrained corridors unlocks additional tonnage paths without new track CAPEX.",
  },
  {
    name: "Real-Time Delay Prediction & Management",
    description:
      "Predict knock-on delays across the rail network using real-time train positions, signalling state, and historical delay propagation.",
    rationale:
      "Signalling/train-graph telemetry (A01) + track restrictions (A02) + crew rosters (A07) + weather (A08) predict secondary delay cascades.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Secondary delay minutes",
    benchmarkImpact: "-22%",
    benchmarkSource: "FRA / Rail Safety & Standards Board (RSSB) -- Performance Analytics",
    benchmarkUrl: "https://railroads.dot.gov/",
    strategicImperative: "Optimize Network & Train Operations",
    strategicPillar: "Train Performance & Scheduling",
    dataAssetIds: ["A01", "A02", "A07", "A08"],
    dataAssetCriticality: {
      A01: "MC",
      A02: "MC",
      A07: "VA",
      A08: "VA",
    },
    totalLoeEstimate: "Medium",
    mcAccessDifficulty: "Medium",
    vaAccessDifficulty: "Low",
    economicPatternName: "Loss Avoidance (Fraud / Shrink / Leakage / Errors)",
    economicImpactCategory: "Risk / Loss Avoidance",
    economicFormula: "Delay_penalty_yr * Delta_pct * Adopt% * Cap%",
    economicFormulaDescription:
      "Delay_penalty_yr = annual contractual demurrage, access regime penalties, and crew overtime from cascading delays; Delta_pct = reduction in secondary delay minutes.",
    economicPatternRationale:
      "Proactive re-routing and dwell adjustments contain primary incidents before they propagate across the timetable.",
  },
  {
    name: "Wayside & Rolling Stock Predictive Maintenance",
    description:
      "Predict wheelset, bearing, brake, and locomotive traction failures using wayside acoustic/WILD detectors and onboard locomotive telemetry.",
    rationale:
      "Wayside detector feeds (A04) + onboard locomotive telemetry (A03) + CMMS work orders (A05) identify bearing/wheel defects weeks before line-of-road failure.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "In-service rolling stock failures",
    benchmarkImpact: "-30%",
    benchmarkSource: "AAR / Transportation Technology Center (MxV Rail)",
    benchmarkUrl: "https://www.aar.org/",
    strategicImperative: "Asset Management",
    strategicPillar: "Rolling Stock Reliability",
    dataAssetIds: ["A03", "A04", "A05", "A01"],
    dataAssetCriticality: {
      A03: "MC",
      A04: "MC",
      A05: "MC",
      A01: "VA",
    },
    totalLoeEstimate: "Medium",
    mcAccessDifficulty: "Medium",
    vaAccessDifficulty: "Low",
    economicPatternName: "Cost Takeout (Labor / Opex Reduction)",
    economicImpactCategory: "Cost",
    economicFormula: "Line_failures_yr * Delta_pct * Cost_per_failure * Adopt% * Cap%",
    economicFormulaDescription:
      "Line_failures_yr = annual main-line locomotive/wagon breakdowns; Delta_pct = reduction via wayside/telemetry alerts; Cost_per_failure = recovery + repair + network blockage cost.",
    economicPatternRationale:
      "Replacing defective wheelsets and bearings in planned depot windows avoids expensive main-line rescues and track damage.",
  },
  {
    name: "Track Geometry & Rail Defect Forecasting",
    description:
      "Forecast track geometry degradation (twist, top, alignment) and internal rail flaws using track-recording car runs, ultrasonic testing, and gross-tonnage history.",
    rationale:
      "Track geometry/ultrasonic car data (A04) + cumulative gross megatonnes (A01) + linear asset registry (A02) + maintenance tamping logs (A05) predict speed restrictions.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Temporary speed restrictions (TSRs)",
    benchmarkImpact: "-20%",
    benchmarkSource: "FRA -- Track Safety Research",
    benchmarkUrl: "https://railroads.dot.gov/research-development/track-division",
    strategicImperative: "Asset Management",
    strategicPillar: "Track & Civil Infrastructure",
    dataAssetIds: ["A02", "A04", "A05", "A01", "A08"],
    dataAssetCriticality: {
      A02: "MC",
      A04: "MC",
      A05: "MC",
      A01: "VA",
      A08: "VA",
    },
    totalLoeEstimate: "Medium",
    mcAccessDifficulty: "Medium",
    vaAccessDifficulty: "Low",
    economicPatternName: "Risk Avoidance (Compliance / Penalties / Outage Impact)",
    economicImpactCategory: "Risk / Loss Avoidance",
    economicFormula: "Track_exposure_yr * Delta_prob * Severity * Adopt% * Cap%",
    economicFormulaDescription:
      "Track_exposure_yr = annual emergency possessions and broken-rail derailment risk exposure; Delta_prob = reduction from predictive tamping and rail grinding.",
    economicPatternRationale:
      "Targeted tamping and grinding before geometry thresholds breach prevents emergency speed restrictions and broken rails.",
  },
  {
    name: "Locomotive Fuel & Traction Energy Optimization",
    description:
      "Optimise consist notch selection, pacing, and regenerative braking across grade profiles to minimise diesel fuel or overhead catenary electricity consumption.",
    rationale:
      "Locomotive fuel/traction telemetry (A03) + train movement & elevation profile (A01, A02) + driver handling logs (A07) identify excess braking and idling.",
    modelType: "Basic-ML",
    kpiTarget: "Traction fuel / energy intensity",
    benchmarkImpact: "-7%",
    benchmarkSource: "US DOT FRA -- Rail Energy Efficiency",
    benchmarkUrl: "https://railroads.dot.gov/",
    strategicImperative: "Reduce Cost",
    strategicPillar: "Fuel & Energy Efficiency",
    dataAssetIds: ["A03", "A01", "A02", "A07"],
    dataAssetCriticality: {
      A03: "MC",
      A01: "MC",
      A02: "VA",
      A07: "VA",
    },
    totalLoeEstimate: "Low",
    mcAccessDifficulty: "Medium",
    vaAccessDifficulty: "Low",
    economicPatternName: "Cost Takeout (Labor / Opex Reduction)",
    economicImpactCategory: "Cost",
    economicFormula: "Fuel_spend_yr * Delta_pct * Adopt% * Cap%",
    economicFormulaDescription:
      "Fuel_spend_yr = annual diesel/traction electricity expenditure; Delta_pct = savings from eco-driving pacing and consist idle reduction.",
    economicPatternRationale:
      "Traction fuel is typically the #1 or #2 operating expense for freight rail operators; pacing avoids braking at red signals.",
  },
];

export const RAIL_TRANSPORT_DATA_ASSETS: ReferenceDataAsset[] = [
  {
    id: "A01",
    name: "Train Control, Movement & Signalling Logs (TMS/CTC)",
    description:
      "Planned vs actual train graphs, section occupancy, signal aspects, dwell times, and delay attribution codes.",
    systemLocation: "TMS / CTC Signalling",
    assetFamily: "Network Operations",
    easeOfAccess: "Medium",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
    bespoke: "High",
    systemKind: "SCADA / Historian",
  },
  {
    id: "A02",
    name: "Linear Track & Corridor Asset Registry",
    description:
      "Track centreline GIS, curvature, gradient, rail weight, sleepers, turnouts, signalling blocks, and temporary speed restrictions.",
    systemLocation: "Linear EAM / GIS",
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
    name: "Locomotive & Consist Onboard Telemetry",
    description:
      "Engine RPM, notch position, fuel burn, traction motor temps, brake cylinder pressure, and GPS trace.",
    systemLocation: "Onboard IoT / Historian",
    assetFamily: "Rolling Stock",
    easeOfAccess: "Medium",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
    bespoke: "High",
    systemKind: "SCADA / Historian",
  },
  {
    id: "A04",
    name: "Wayside Detectors & Track Recording Car Inspections",
    description:
      "Wheel Impact Load Detectors (WILD), hot bearing/acoustic detectors, track geometry car runs, and ultrasonic rail flaw data.",
    systemLocation: "Wayside Inspection DB",
    assetFamily: "Asset Management",
    easeOfAccess: "Medium",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
  },
  {
    id: "A05",
    name: "Rolling Stock & Track Maintenance Work Orders (CMMS)",
    description:
      "Depot maintenance work orders, wheel lathe turns, component serial history, tamping, and rail grinding logs.",
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
    id: "A06",
    name: "Freight Consignment, Waybills & Terminal / Port Slots",
    description:
      "Customer haulage contracts, wagon manifests, gross trailing tonnes, intermodal terminal gate logs, and port dumper slots.",
    systemLocation: "ERP / TOS",
    assetFamily: "Commercial & Logistics",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
    systemKind: "ERP",
  },
  {
    id: "A07",
    name: "Driver & Crew Rostering, Fatigue & Safety Logs",
    description:
      "Footplate crew qualifications, shift hours, fatigue scores, SPAD/safety incident reports, and HR records.",
    systemLocation: "Crew Management / HRIS",
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
    name: "Corridor Weather, Heat-Buckle & Flood Alerts",
    description:
      "Track-temperature sensors, extreme heat speed-restriction triggers, rainfall/flood gauges, and wind alerts.",
    systemLocation: "Weather API / Track Sensors",
    assetFamily: "External & Environmental",
    easeOfAccess: "Low",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
    bespoke: "High",
  },
];
