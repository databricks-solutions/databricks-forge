/**
 * Mining & Resources -- Master Repository Enrichment Data
 *
 * Curated enrichment for the mining industry covering iron ore, base metals,
 * battery minerals, and bulk commodities. Modelled on major Australian miners
 * (BHP, Rio Tinto, Fortescue, South32) and global mining priorities.
 */

import type { MasterRepoUseCase, ReferenceDataAsset } from "./master-repo-types";

export const MINING_USE_CASES: MasterRepoUseCase[] = [
  // -----------------------------------------------------------------------
  // Optimize Mine Operations -- Mine Planning & Grade Control
  // -----------------------------------------------------------------------
  {
    name: "Grade Control Optimisation",
    description:
      "Integrate blast-hole sampling, assay results, and block model data to minimise ore dilution and loss, improving head grade reconciliation.",
    rationale:
      "Block models (A01) + assays (A11) + fleet positioning (A02) drive dig-face decisions; survey data (A05) validates volumes; process feed (A18) closes the reconciliation loop.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Head grade recovery",
    benchmarkImpact: "+3%",
    benchmarkSource: "McKinsey -- The Mining Productivity Imperative",
    benchmarkUrl:
      "https://www.mckinsey.com/industries/metals-and-mining/our-insights/the-mining-productivity-imperative",
    strategicImperative: "Optimize Mine Operations",
    strategicPillar: "Mine Planning & Grade Control",
    dataAssetIds: ["A01", "A11", "A02", "A05", "A18"],
    dataAssetCriticality: {
      A01: "MC",
      A11: "MC",
      A02: "MC",
      A05: "VA",
      A18: "VA",
    },
  },
  {
    name: "Drill & Blast Optimisation",
    description:
      "Optimise drill patterns, charge designs, and blast timing using geology, explosive properties, and fragmentation outcomes.",
    rationale:
      "Drill logs + blast designs feed fragmentation models; geology (A01) and survey (A05) constrain designs; fleet data (A02) tracks downstream impact on loading.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Drilling & blasting cost",
    benchmarkImpact: "-12%",
    benchmarkSource: "McKinsey -- The Mining Productivity Imperative",
    benchmarkUrl:
      "https://www.mckinsey.com/industries/metals-and-mining/our-insights/the-mining-productivity-imperative",
    strategicImperative: "Optimize Mine Operations",
    strategicPillar: "Mine Planning & Grade Control",
    dataAssetIds: ["A01", "A05", "A11", "A02"],
    dataAssetCriticality: {
      A01: "MC",
      A05: "MC",
      A11: "VA",
      A02: "VA",
    },
  },
  {
    name: "Short-Range Mine Scheduling",
    description:
      "Dynamically optimise weekly/daily dig schedules balancing grade, movement, equipment, and plant feed requirements.",
    rationale:
      "Block models (A01) + fleet availability (A02) + plant requirements (A18) constrain schedules; weather (A10) and maintenance (A08) adjust feasibility.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Schedule adherence",
    benchmarkImpact: "+15%",
    benchmarkSource: "McKinsey -- Creating Value in Mining Through AI",
    benchmarkUrl:
      "https://www.mckinsey.com/industries/metals-and-mining/our-insights/creating-value-in-mining-through-data-and-analytics",
    strategicImperative: "Optimize Mine Operations",
    strategicPillar: "Mine Planning & Grade Control",
    dataAssetIds: ["A01", "A02", "A18", "A10", "A08"],
    dataAssetCriticality: {
      A01: "MC",
      A02: "MC",
      A18: "MC",
      A10: "VA",
      A08: "VA",
    },
  },
  {
    name: "Stockpile Management & Blending",
    description:
      "Track stockpile grades/volumes in real-time and optimise blending strategies to meet product quality specifications.",
    rationale:
      "Survey data (A05) + assays (A11) track inventory; product specs and customer requirements (A23) set targets; rail/port (A12) constrains timing.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Product quality compliance",
    benchmarkImpact: "+5%",
    benchmarkSource: "McKinsey -- Metals & Mining Practice",
    benchmarkUrl:
      "https://www.mckinsey.com/industries/metals-and-mining/our-insights/the-mining-productivity-imperative",
    strategicImperative: "Optimize Mine Operations",
    strategicPillar: "Mine Planning & Grade Control",
    dataAssetIds: ["A05", "A11", "A23", "A12", "A18"],
    dataAssetCriticality: {
      A05: "MC",
      A11: "MC",
      A23: "MC",
      A12: "VA",
      A18: "VA",
    },
  },

  // -----------------------------------------------------------------------
  // Optimize Mine Operations -- Fleet Management & Autonomous Operations
  // -----------------------------------------------------------------------
  {
    name: "Fleet Dispatch Optimisation",
    description:
      "Optimise real-time allocation of haul trucks, loaders, and ancillary equipment to maximise fleet productivity and minimise queuing.",
    rationale:
      "Fleet telemetry (A02) + dispatch assignments drive cycle time analytics; mine plans (A01) and road conditions (A07) constrain routes; weather (A10) affects productivity.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Fleet utilisation",
    benchmarkImpact: "+10%",
    benchmarkSource: "McKinsey -- The Mining Productivity Imperative",
    benchmarkUrl:
      "https://www.mckinsey.com/industries/metals-and-mining/our-insights/the-mining-productivity-imperative",
    strategicImperative: "Optimize Mine Operations",
    strategicPillar: "Fleet Management & Autonomous Operations",
    dataAssetIds: ["A02", "A01", "A07", "A10"],
    dataAssetCriticality: {
      A02: "MC",
      A01: "MC",
      A07: "VA",
      A10: "VA",
    },
  },
  {
    name: "Autonomous Haulage Analytics",
    description:
      "Monitor and optimise autonomous haul truck fleets using telemetry, path planning, and interaction zone data.",
    rationale:
      "AHS telemetry (A29) is core; fleet management (A02) and mine plans (A01) guide paths; safety systems (A09) and survey (A05) ensure compliance.",
    modelType: "Advanced — GenAI",
    kpiTarget: "Haulage productivity",
    benchmarkImpact: "+20%",
    benchmarkSource: "Fortescue -- Autonomous Haulage Results",
    benchmarkUrl:
      "https://www.fortescue.com/news-and-media",
    strategicImperative: "Optimize Mine Operations",
    strategicPillar: "Fleet Management & Autonomous Operations",
    dataAssetIds: ["A29", "A02", "A01", "A09", "A05"],
    dataAssetCriticality: {
      A29: "MC",
      A02: "MC",
      A01: "VA",
      A09: "VA",
      A05: "VA",
    },
  },
  {
    name: "Tyre & Component Life Prediction",
    description:
      "Predict tyre and major component remaining useful life using load, speed, road condition, and temperature data.",
    rationale:
      "Fleet telemetry (A02) + condition monitoring (A04) + maintenance history (A08) feed survival models; road conditions (A07) add context.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Tyre cost per tonne",
    benchmarkImpact: "-15%",
    benchmarkSource: "McKinsey -- Metals & Mining Practice",
    benchmarkUrl:
      "https://www.mckinsey.com/industries/metals-and-mining/our-insights/the-mining-productivity-imperative",
    strategicImperative: "Optimize Mine Operations",
    strategicPillar: "Fleet Management & Autonomous Operations",
    dataAssetIds: ["A02", "A04", "A08", "A07"],
    dataAssetCriticality: {
      A02: "MC",
      A04: "MC",
      A08: "MC",
      A07: "VA",
    },
  },

  // -----------------------------------------------------------------------
  // Optimize Mine Operations -- Processing Plant Optimisation
  // -----------------------------------------------------------------------
  {
    name: "Throughput & Recovery Optimisation",
    description:
      "Use real-time process data and ML models to optimise crusher, mill, and concentrator settings for maximum throughput and recovery.",
    rationale:
      "SCADA/historian (A03) + lab assays (A11) + production data (A18) are core; digital twins (A06) test scenarios; energy (A24) constrains setpoints.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Processing recovery",
    benchmarkImpact: "+2%",
    benchmarkSource: "McKinsey -- Creating Value in Mining Through AI",
    benchmarkUrl:
      "https://www.mckinsey.com/industries/metals-and-mining/our-insights/creating-value-in-mining-through-data-and-analytics",
    strategicImperative: "Optimize Mine Operations",
    strategicPillar: "Processing Plant Optimisation",
    dataAssetIds: ["A03", "A11", "A18", "A06", "A24"],
    dataAssetCriticality: {
      A03: "MC",
      A11: "MC",
      A18: "MC",
      A06: "VA",
      A24: "VA",
    },
  },
  {
    name: "Energy Intensity Reduction",
    description:
      "Reduce energy waste in comminution, pumping, and ventilation through granular metering and AI-driven setpoint optimisation.",
    rationale:
      "Energy metering (A24) + process parameters (A03) + production volumes (A18) enable benchmarking; weather (A10) affects ventilation/cooling loads.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Energy per tonne",
    benchmarkImpact: "-12%",
    benchmarkSource: "McKinsey -- Decarbonizing Mining Operations",
    benchmarkUrl:
      "https://www.mckinsey.com/industries/metals-and-mining/our-insights/creating-the-zero-carbon-mine",
    strategicImperative: "Optimize Mine Operations",
    strategicPillar: "Processing Plant Optimisation",
    dataAssetIds: ["A24", "A03", "A18", "A10"],
    dataAssetCriticality: {
      A24: "MC",
      A03: "MC",
      A18: "MC",
      A10: "VA",
    },
  },

  // -----------------------------------------------------------------------
  // Achieve Zero Harm -- Safety & Risk Prediction
  // -----------------------------------------------------------------------
  {
    name: "Safety Event Prediction",
    description:
      "Predict high-risk shifts, locations, and activities using near-miss data, telemetry, and environmental conditions.",
    rationale:
      "HSE incidents (A09) + fleet data (A02) + weather (A10) + workforce data (A17) drive risk models; process parameters (A03) add exposure context.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "TRIFR",
    benchmarkImpact: "-25%",
    benchmarkSource: "McKinsey -- The Executive's AI Playbook—Mining",
    benchmarkUrl:
      "https://www.mckinsey.com/industries/metals-and-mining/our-insights/the-mining-productivity-imperative",
    strategicImperative: "Achieve Zero Harm",
    strategicPillar: "Safety & Risk Prediction",
    dataAssetIds: ["A09", "A02", "A10", "A17", "A03"],
    dataAssetCriticality: {
      A09: "MC",
      A02: "MC",
      A10: "MC",
      A17: "VA",
      A03: "VA",
    },
  },
  {
    name: "Fatigue & Fitness-for-Duty Management",
    description:
      "Integrate fatigue monitoring, roster patterns, and travel data to predict fatigue risk and intervene proactively.",
    rationale:
      "Workforce data (A17) + fatigue alerts from fleet (A02) + HSE records (A09) form the core; shift scheduling and access data refine predictions.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Fatigue-related incidents",
    benchmarkImpact: "-30%",
    benchmarkSource: "ICMM -- Health and Safety Critical Control Management",
    benchmarkUrl: "https://www.icmm.com/en-gb/guidance/health-safety",
    strategicImperative: "Achieve Zero Harm",
    strategicPillar: "Safety & Risk Prediction",
    dataAssetIds: ["A17", "A02", "A09"],
    dataAssetCriticality: {
      A17: "MC",
      A02: "MC",
      A09: "VA",
    },
  },
  {
    name: "Vehicle Interaction & Collision Avoidance",
    description:
      "Analyse proximity detection data and traffic patterns to identify high-risk zones and optimise traffic management.",
    rationale:
      "Fleet telemetry (A02) + autonomous systems (A29) + HSE data (A09) + GIS (A07) map interaction patterns and risk hotspots.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Vehicle interaction incidents",
    benchmarkImpact: "-40%",
    benchmarkSource: "ICMM -- Vehicle Interaction Management",
    benchmarkUrl: "https://www.icmm.com/en-gb/guidance/health-safety",
    strategicImperative: "Achieve Zero Harm",
    strategicPillar: "Safety & Risk Prediction",
    dataAssetIds: ["A02", "A29", "A09", "A07"],
    dataAssetCriticality: {
      A02: "MC",
      A29: "MC",
      A09: "MC",
      A07: "VA",
    },
  },

  // -----------------------------------------------------------------------
  // Achieve Zero Harm -- Tailings & Geotechnical Stability
  // -----------------------------------------------------------------------
  {
    name: "Tailings Dam Monitoring & Early Warning",
    description:
      "Integrate piezometer, InSAR, seepage, and weather data with ML to detect anomalous TSF behaviour and trigger early warnings.",
    rationale:
      "Tailings monitoring (A16) is core; survey/LiDAR (A05) + weather (A10) add context; GIS (A07) maps spatial risk; regulatory (A21) sets thresholds.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Tailings facility safety score",
    benchmarkImpact: "+20%",
    benchmarkSource: "ICMM -- Global Industry Standard on Tailings Management (GISTM)",
    benchmarkUrl: "https://www.icmm.com/en-gb/our-principles/tailings/global-industry-standard",
    strategicImperative: "Achieve Zero Harm",
    strategicPillar: "Tailings & Geotechnical Stability",
    dataAssetIds: ["A16", "A05", "A10", "A07", "A21"],
    dataAssetCriticality: {
      A16: "MC",
      A05: "MC",
      A10: "MC",
      A07: "VA",
      A21: "VA",
    },
  },
  {
    name: "Pit Slope Stability Monitoring",
    description:
      "Combine radar, prism, and extensometer data with geological models to predict slope movement and inform safe mining limits.",
    rationale:
      "Geotechnical monitoring in tailings/water (A16) + survey/LiDAR (A05) + mine plans (A01) constrain slope design; weather (A10) triggers alerts.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Slope failure events",
    benchmarkImpact: "-50%",
    benchmarkSource: "CSIRO -- Mining Geomechanics",
    benchmarkUrl: "https://www.csiro.au/en/research/mining-manufacturing/mining",
    strategicImperative: "Achieve Zero Harm",
    strategicPillar: "Tailings & Geotechnical Stability",
    dataAssetIds: ["A16", "A05", "A01", "A10"],
    dataAssetCriticality: {
      A16: "MC",
      A05: "MC",
      A01: "VA",
      A10: "VA",
    },
  },

  // -----------------------------------------------------------------------
  // Optimise Supply Chain & Logistics -- Mine-to-Port
  // -----------------------------------------------------------------------
  {
    name: "Integrated Mine-to-Port Planning",
    description:
      "Optimise the entire value chain from pit to port coordinating mine scheduling, rail, stockyards, and ship loading.",
    rationale:
      "Mine plans (A01) + rail/port (A12) + production (A18) + customer specs (A23) are core; weather (A10) and fleet (A02) constrain execution.",
    modelType: "Advanced — GenAI",
    kpiTarget: "System throughput",
    benchmarkImpact: "+8%",
    benchmarkSource: "McKinsey -- The Mining Productivity Imperative",
    benchmarkUrl:
      "https://www.mckinsey.com/industries/metals-and-mining/our-insights/the-mining-productivity-imperative",
    strategicImperative: "Optimise Supply Chain & Logistics",
    strategicPillar: "Mine-to-Port Value Chain",
    dataAssetIds: ["A01", "A12", "A18", "A23", "A10", "A02"],
    dataAssetCriticality: {
      A01: "MC",
      A12: "MC",
      A18: "MC",
      A23: "MC",
      A10: "VA",
      A02: "VA",
    },
  },
  {
    name: "Rail Network Optimisation",
    description:
      "Optimise train scheduling, consist configuration, and path allocation across shared rail networks.",
    rationale:
      "Rail/port logistics (A12) is core; production data (A18) determines demand; weather (A10) and maintenance (A08) affect availability.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Rail cycle time",
    benchmarkImpact: "-10%",
    benchmarkSource: "McKinsey -- Metals & Mining Practice",
    benchmarkUrl:
      "https://www.mckinsey.com/industries/metals-and-mining/our-insights/the-mining-productivity-imperative",
    strategicImperative: "Optimise Supply Chain & Logistics",
    strategicPillar: "Mine-to-Port Value Chain",
    dataAssetIds: ["A12", "A18", "A10", "A08"],
    dataAssetCriticality: {
      A12: "MC",
      A18: "MC",
      A10: "VA",
      A08: "VA",
    },
  },
  {
    name: "Port & Ship Loading Optimisation",
    description:
      "Optimise berth allocation, loading sequences, and product blending at port to maximise throughput and minimise demurrage.",
    rationale:
      "Rail/port data (A12) + assays (A11) + customer specs (A23) drive blending and scheduling; commodity prices (A13) influence priority.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Demurrage cost",
    benchmarkImpact: "-20%",
    benchmarkSource: "McKinsey -- Metals & Mining Practice",
    benchmarkUrl:
      "https://www.mckinsey.com/industries/metals-and-mining/our-insights/the-mining-productivity-imperative",
    strategicImperative: "Optimise Supply Chain & Logistics",
    strategicPillar: "Mine-to-Port Value Chain",
    dataAssetIds: ["A12", "A11", "A23", "A13"],
    dataAssetCriticality: {
      A12: "MC",
      A11: "MC",
      A23: "MC",
      A13: "VA",
    },
  },

  // -----------------------------------------------------------------------
  // Optimise Supply Chain & Logistics -- Procurement & Inventory
  // -----------------------------------------------------------------------
  {
    name: "Critical Spares Optimisation",
    description:
      "Optimise spare parts inventory across remote mine sites balancing availability against carrying cost.",
    rationale:
      "Procurement/supplier data (A14) + maintenance history (A08) + condition monitoring (A04) feed demand models; project controls (A19) track budget impact.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Inventory holding cost",
    benchmarkImpact: "-20%",
    benchmarkSource: "McKinsey -- Metals & Mining Practice",
    benchmarkUrl:
      "https://www.mckinsey.com/industries/metals-and-mining/our-insights/the-mining-productivity-imperative",
    strategicImperative: "Optimise Supply Chain & Logistics",
    strategicPillar: "Procurement & Inventory",
    dataAssetIds: ["A14", "A08", "A04", "A19"],
    dataAssetCriticality: {
      A14: "MC",
      A08: "MC",
      A04: "VA",
      A19: "VA",
    },
  },

  // -----------------------------------------------------------------------
  // ESG & Sustainability
  // -----------------------------------------------------------------------
  {
    name: "Scope 1/2/3 Emissions Tracking & Reporting",
    description:
      "Automate GHG emissions tracking across diesel fleet, plant energy, purchased electricity, and value chain.",
    rationale:
      "Emissions ledger (A15) + energy metering (A24) + fleet (A02) + production (A18) are core; rail/port (A12) adds Scope 3; regulatory (A21) sets standards.",
    modelType: "Advanced — GenAI",
    kpiTarget: "Emissions intensity",
    benchmarkImpact: "-15%",
    benchmarkSource: "McKinsey -- Creating the Zero-Carbon Mine",
    benchmarkUrl:
      "https://www.mckinsey.com/industries/metals-and-mining/our-insights/creating-the-zero-carbon-mine",
    strategicImperative: "ESG & Sustainability",
    strategicPillar: "Decarbonisation & Emissions Management",
    dataAssetIds: ["A15", "A24", "A02", "A18", "A12", "A21"],
    dataAssetCriticality: {
      A15: "MC",
      A24: "MC",
      A02: "MC",
      A18: "VA",
      A12: "VA",
      A21: "VA",
    },
  },
  {
    name: "Haul Fleet Electrification & Energy Transition",
    description:
      "Model transition from diesel haul trucks to battery-electric or hydrogen alternatives using route profiles and energy modelling.",
    rationale:
      "Fleet telemetry (A02) + energy (A24) + autonomous systems (A29) model TCO; mine plans (A01) constrain infrastructure; emissions (A15) track benefit.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Diesel consumption per tonne",
    benchmarkImpact: "-30%",
    benchmarkSource: "McKinsey -- Creating the Zero-Carbon Mine",
    benchmarkUrl:
      "https://www.mckinsey.com/industries/metals-and-mining/our-insights/creating-the-zero-carbon-mine",
    strategicImperative: "ESG & Sustainability",
    strategicPillar: "Decarbonisation & Emissions Management",
    dataAssetIds: ["A02", "A24", "A29", "A01", "A15"],
    dataAssetCriticality: {
      A02: "MC",
      A24: "MC",
      A29: "VA",
      A01: "VA",
      A15: "VA",
    },
  },
  {
    name: "Water Balance Optimisation",
    description:
      "Build real-time site water balance models integrating rainfall, pit inflow, process use, recycling, and discharge.",
    rationale:
      "Tailings/water data (A16) + weather (A10) + process data (A03) are core; GIS (A07) maps catchments; regulatory (A21) sets licence limits.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Water recycling rate",
    benchmarkImpact: "+15%",
    benchmarkSource: "ICMM -- Water Stewardship Framework",
    benchmarkUrl: "https://www.icmm.com/en-gb/guidance/environmental-stewardship/water-stewardship",
    strategicImperative: "ESG & Sustainability",
    strategicPillar: "Water & Environmental Stewardship",
    dataAssetIds: ["A16", "A10", "A03", "A07", "A21"],
    dataAssetCriticality: {
      A16: "MC",
      A10: "MC",
      A03: "VA",
      A07: "VA",
      A21: "VA",
    },
  },
  {
    name: "Mine Rehabilitation & Closure Planning",
    description:
      "Track progressive rehabilitation, estimate closure liabilities, and demonstrate compliance using remote sensing and financial modelling.",
    rationale:
      "GIS/spatial (A07) + survey/drone (A05) + emissions/environment (A15) + project controls (A19) are core; regulatory (A21) and community (A30) set obligations.",
    modelType: "Advanced — GenAI",
    kpiTarget: "Rehabilitation compliance",
    benchmarkImpact: "+10%",
    benchmarkSource: "ICMM -- Integrated Mine Closure: Good Practice Guide",
    benchmarkUrl: "https://www.icmm.com/en-gb/guidance/environmental-stewardship/mine-closure",
    strategicImperative: "ESG & Sustainability",
    strategicPillar: "Water & Environmental Stewardship",
    dataAssetIds: ["A07", "A05", "A15", "A19", "A21", "A30"],
    dataAssetCriticality: {
      A07: "MC",
      A05: "MC",
      A15: "MC",
      A19: "VA",
      A21: "VA",
      A30: "VA",
    },
  },

  // -----------------------------------------------------------------------
  // Exploration & Resource Development
  // -----------------------------------------------------------------------
  {
    name: "Exploration Target Generation",
    description:
      "Apply ML to multi-layer geoscience data to generate and rank prospective exploration targets.",
    rationale:
      "Exploration data (A25) + GIS (A07) + assays (A11) drive target ranking; mine plans (A01) provide resource context; survey (A05) adds remote sensing.",
    modelType: "Advanced — GenAI",
    kpiTarget: "Discovery cost per resource ounce",
    benchmarkImpact: "-30%",
    benchmarkSource: "S&P Global -- Cost of Discovery",
    benchmarkUrl:
      "https://www.spglobal.com/marketintelligence/en/news-insights/research/cost-of-discovery",
    strategicImperative: "Exploration & Resource Development",
    strategicPillar: "Geoscience & Exploration Intelligence",
    dataAssetIds: ["A25", "A07", "A11", "A01", "A05"],
    dataAssetCriticality: {
      A25: "MC",
      A07: "MC",
      A11: "MC",
      A01: "VA",
      A05: "VA",
    },
  },
  {
    name: "Resource Estimation & Block Model Optimisation",
    description:
      "Enhance resource estimation accuracy with ML-assisted variography, domain modelling, and drill-hole data integration.",
    rationale:
      "Exploration data (A25) + assays (A11) + mine plans/block models (A01) are core to estimation; GIS (A07) adds spatial context.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Resource confidence",
    benchmarkImpact: "+15%",
    benchmarkSource: "JORC -- Australasian Code for Reporting of Exploration Results",
    benchmarkUrl: "https://www.jorc.org/",
    strategicImperative: "Exploration & Resource Development",
    strategicPillar: "Geoscience & Exploration Intelligence",
    dataAssetIds: ["A25", "A11", "A01", "A07"],
    dataAssetCriticality: {
      A25: "MC",
      A11: "MC",
      A01: "MC",
      A07: "VA",
    },
  },
  {
    name: "Automated Core Logging & Lithology Classification",
    description:
      "Use computer vision and hyperspectral imaging on drill core to automate lithology classification and alteration mapping.",
    rationale:
      "Exploration data (A25) + survey imagery (A05) + assays (A11) train classification models; digital twins (A06) encode mineralogical models.",
    modelType: "Advanced — GenAI",
    kpiTarget: "Core logging throughput",
    benchmarkImpact: "+50%",
    benchmarkSource: "CSIRO -- Automated Mineralogy",
    benchmarkUrl: "https://www.csiro.au/en/research/mining-manufacturing/mining",
    strategicImperative: "Exploration & Resource Development",
    strategicPillar: "Geoscience & Exploration Intelligence",
    dataAssetIds: ["A25", "A05", "A11", "A06"],
    dataAssetCriticality: {
      A25: "MC",
      A05: "MC",
      A11: "VA",
      A06: "VA",
    },
  },

  // -----------------------------------------------------------------------
  // Streamline Business Functions
  // -----------------------------------------------------------------------
  {
    name: "Commodity Price Forecasting & Risk Management",
    description:
      "Forecast commodity price movements using market data, supply-demand fundamentals, and macro indicators for hedging and capital allocation.",
    rationale:
      "Commodity prices (A13) + project controls (A19) + production (A18) are core; offtake contracts (A20) and customer data (A23) constrain strategies.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Forecast accuracy",
    benchmarkImpact: "+15%",
    benchmarkSource: "McKinsey -- Metals & Mining Practice",
    benchmarkUrl:
      "https://www.mckinsey.com/industries/metals-and-mining/our-insights/the-mining-productivity-imperative",
    strategicImperative: "Streamline Business Functions",
    strategicPillar: "Financial Analytics & Commercial",
    dataAssetIds: ["A13", "A19", "A18", "A20", "A23"],
    dataAssetCriticality: {
      A13: "MC",
      A19: "MC",
      A18: "VA",
      A20: "VA",
      A23: "VA",
    },
  },
  {
    name: "Predictive Maintenance for Heavy Mobile Equipment",
    description:
      "Predict failures on haul trucks, excavators, drills, and loaders using telemetry, oil analysis, vibration, and maintenance history.",
    rationale:
      "Fleet telemetry (A02) + condition monitoring (A04) + maintenance history (A08) are core; autonomous data (A29) and procurement (A14) add context.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Unplanned downtime",
    benchmarkImpact: "-35%",
    benchmarkSource: "McKinsey -- Manufacturing Analytics Unleashes Productivity and Profitability",
    benchmarkUrl:
      "https://www.mckinsey.com/capabilities/operations/our-insights/manufacturing-analytics-unleashes-productivity-and-profitability",
    strategicImperative: "Streamline Business Functions",
    strategicPillar: "Asset Reliability & Maintenance",
    dataAssetIds: ["A02", "A04", "A08", "A29", "A14"],
    dataAssetCriticality: {
      A02: "MC",
      A04: "MC",
      A08: "MC",
      A29: "VA",
      A14: "VA",
    },
  },
  {
    name: "Predictive Maintenance for Fixed Plant",
    description:
      "Monitor mills, crushers, conveyors, and pumps using vibration, thermography, and process data to predict failures.",
    rationale:
      "Condition monitoring (A04) + SCADA/historian (A03) + maintenance history (A08) drive models; production (A18) sizes impact; procurement (A14) enables response.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Processing plant availability",
    benchmarkImpact: "+5%",
    benchmarkSource: "McKinsey -- Manufacturing Analytics Unleashes Productivity and Profitability",
    benchmarkUrl:
      "https://www.mckinsey.com/capabilities/operations/our-insights/manufacturing-analytics-unleashes-productivity-and-profitability",
    strategicImperative: "Streamline Business Functions",
    strategicPillar: "Asset Reliability & Maintenance",
    dataAssetIds: ["A04", "A03", "A08", "A18", "A14"],
    dataAssetCriticality: {
      A04: "MC",
      A03: "MC",
      A08: "MC",
      A18: "VA",
      A14: "VA",
    },
  },
  {
    name: "Mining Regulatory Compliance Automation",
    description:
      "Automate tracking and evidence collection for mining leases, environmental approvals, and WHS regulations across jurisdictions.",
    rationale:
      "Regulatory library (A21) + HSE data (A09) + documents (A22) are core; emissions (A15) and community (A30) add completeness.",
    modelType: "Advanced — GenAI",
    kpiTarget: "Compliance rate",
    benchmarkImpact: "+10%",
    benchmarkSource: "McKinsey -- Metals & Mining Practice",
    benchmarkUrl:
      "https://www.mckinsey.com/industries/metals-and-mining/our-insights/the-mining-productivity-imperative",
    strategicImperative: "Streamline Business Functions",
    strategicPillar: "Regulatory & Compliance",
    dataAssetIds: ["A21", "A09", "A22", "A15", "A30"],
    dataAssetCriticality: {
      A21: "MC",
      A09: "MC",
      A22: "MC",
      A15: "VA",
      A30: "VA",
    },
  },
  {
    name: "Community & Stakeholder Engagement Analytics",
    description:
      "Track community commitments, grievances, and social investment to maintain social licence and regulatory compliance.",
    rationale:
      "Community/stakeholder data (A30) + regulatory (A21) + project controls (A19) are core; GIS (A07) maps impact zones.",
    modelType: "Advanced — GenAI",
    kpiTarget: "Community grievance resolution time",
    benchmarkImpact: "-30%",
    benchmarkSource: "ICMM -- Community Development Toolkit",
    benchmarkUrl: "https://www.icmm.com/en-gb/guidance/social-performance",
    strategicImperative: "Streamline Business Functions",
    strategicPillar: "Regulatory & Compliance",
    dataAssetIds: ["A30", "A21", "A19", "A07"],
    dataAssetCriticality: {
      A30: "MC",
      A21: "MC",
      A19: "VA",
      A07: "VA",
    },
  },
];

export const MINING_DATA_ASSETS: ReferenceDataAsset[] = [
  {
    id: "A01",
    name: "Mine Planning & Resource Models",
    description:
      "Block models, ore body models, resource/reserve estimates, mine designs, pit shells, and long/short-range mine schedules.",
    systemLocation: "Mine Planning System",
    assetFamily: "Mining & Geoscience",
    easeOfAccess: "High",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
  },
  {
    id: "A02",
    name: "Fleet Management & Dispatch",
    description:
      "Real-time GPS/telemetry for haul trucks, loaders, drills, and ancillary equipment including cycle times, payloads, fuel consumption, and dispatch assignments.",
    systemLocation: "Fleet Management System",
    assetFamily: "Mining Operations",
    easeOfAccess: "High",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
  },
  {
    id: "A03",
    name: "SCADA/DCS & Historian Time-Series",
    description:
      "High-frequency sensor data from processing plants (crushers, mills, concentrators, smelters) including pressures, temperatures, flows, and process setpoints.",
    systemLocation: "SCADA/DCS Historian",
    assetFamily: "Processing & Metallurgy",
    easeOfAccess: "High",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
  },
  {
    id: "A04",
    name: "Condition Monitoring Signals",
    description:
      "Vibration analysis, oil analysis, thermography, ultrasonic, and motor current signatures for rotating equipment health on mobile and fixed plant.",
    systemLocation: "Condition Monitoring System",
    assetFamily: "Asset Management",
    easeOfAccess: "High",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
  },
  {
    id: "A05",
    name: "Drone/LiDAR/Survey Data",
    description:
      "Geo-tagged aerial imagery, point clouds, photogrammetry, pit surveys, stockpile volume calculations, and terrain models from drone and ground-based surveys.",
    systemLocation: "Survey System / DAM",
    assetFamily: "Mining & Geoscience",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "Low",
  },
  {
    id: "A06",
    name: "Digital Twins & Engineering Models",
    description:
      "CAD/CAE, process simulation, FEA, and digital twin models for mine sites, processing plants, and infrastructure.",
    systemLocation: "PLM/Simulation Platform",
    assetFamily: "Processing & Metallurgy",
    easeOfAccess: "High",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
  },
  {
    id: "A07",
    name: "GIS & Spatial Data",
    description:
      "Mine plans, pit designs, tenure boundaries, infrastructure layouts, environmental sensitive areas, and geotechnical spatial data.",
    systemLocation: "GIS Platform",
    assetFamily: "Mining & Geoscience",
    easeOfAccess: "High",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
  },
  {
    id: "A08",
    name: "Work Orders & Maintenance History",
    description:
      "Corrective/preventive work orders, failure codes, parts consumed, MTBF/MTTR, technician notes for mobile fleet and fixed plant reliability analytics.",
    systemLocation: "EAM/CMMS",
    assetFamily: "Asset Management",
    easeOfAccess: "High",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
  },
  {
    id: "A09",
    name: "HSE Incidents & Observations",
    description:
      "Safety incidents, near-misses, hazard observations, JSAs/permits-to-work, Take 5s, critical risk verifications, and corrective actions.",
    systemLocation: "HSE System",
    assetFamily: "Safety & Environment",
    easeOfAccess: "High",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
  },
  {
    id: "A10",
    name: "Weather & Environmental Monitoring",
    description:
      "On-site weather stations, dust monitoring, blast vibration/overpressure, noise levels, and external weather forecasts for operational decisions.",
    systemLocation: "Weather Station / External APIs",
    assetFamily: "Safety & Environment",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
  },
  {
    id: "A11",
    name: "Laboratory & Assay Data",
    description:
      "Grade control samples, blast-hole assays, metallurgical test results, process chemistry, and product quality certifications from LIMS.",
    systemLocation: "LIMS",
    assetFamily: "Processing & Metallurgy",
    easeOfAccess: "High",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
  },
  {
    id: "A12",
    name: "Rail & Port Logistics",
    description:
      "Train movements, consist configurations, rail path schedules, stockyard inventory, berth allocation, ship loading rates, and vessel lineups.",
    systemLocation: "Rail Ops / Port Management System",
    assetFamily: "Supply Chain & Logistics",
    easeOfAccess: "High",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
  },
  {
    id: "A13",
    name: "Commodity Prices & Market Data",
    description:
      "Spot and futures prices for iron ore, copper, gold, lithium, nickel, alumina; FX rates; supply-demand fundamentals; and analyst forecasts.",
    systemLocation: "Market Data Feed / Treasury",
    assetFamily: "Finance & Commercial",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "Low",
  },
  {
    id: "A14",
    name: "Procurement & Supplier Data",
    description:
      "Purchase orders, contracts, supplier performance scorecards, spend analytics, lead times, and vendor ESG compliance for mining inputs and services.",
    systemLocation: "SRM / Procurement System",
    assetFamily: "Supply Chain & Logistics",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
  },
  {
    id: "A15",
    name: "Emissions & Environmental Ledger",
    description:
      "Scope 1/2/3 GHG emissions, dust emissions, water discharge quality, noise monitoring, and environmental compliance ledger with emission factors.",
    systemLocation: "Sustainability Platform / Carbon Mgmt",
    assetFamily: "Safety & Environment",
    easeOfAccess: "High",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
  },
  {
    id: "A16",
    name: "Tailings & Water Management",
    description:
      "Tailings storage facility monitoring (piezometers, inclinometers, InSAR, seepage), water balance data, pit dewatering, and groundwater levels.",
    systemLocation: "Geotechnical Monitoring / Water Mgmt",
    assetFamily: "Safety & Environment",
    easeOfAccess: "High",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
  },
  {
    id: "A17",
    name: "Workforce & Skills Data",
    description:
      "Operator licences, competency matrices, training records, fatigue management data, FIFO roster patterns, and fitness-for-duty assessments.",
    systemLocation: "HRIS / LMS / Fatigue Mgmt",
    assetFamily: "Workforce",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
  },
  {
    id: "A18",
    name: "Production & Throughput Data",
    description:
      "Crusher, mill, and concentrator throughput volumes, material movement records, product stockpile levels, and shift production reports.",
    systemLocation: "MES / Production Reporting",
    assetFamily: "Processing & Metallurgy",
    easeOfAccess: "High",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
  },
  {
    id: "A19",
    name: "Project Controls (CAPEX/OPEX)",
    description:
      "Budget, actuals, commitments, cost codes/WBS for mine operations, capital projects, and closure provisions.",
    systemLocation: "ERP / Finance",
    assetFamily: "Finance & Commercial",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
  },
  {
    id: "A20",
    name: "Contracts & Offtake Agreements",
    description:
      "Sales/offtake contracts, royalty agreements, JV structures, tolling arrangements, and shipping contracts with pricing mechanisms and quality specs.",
    systemLocation: "CLM / Commercial System",
    assetFamily: "Finance & Commercial",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
  },
  {
    id: "A21",
    name: "Regulatory Library & Permits",
    description:
      "Mining leases, environmental approvals, water licences, Aboriginal heritage permits, WHS regulations, and GISTM compliance records.",
    systemLocation: "GRC / Compliance Platform",
    assetFamily: "Governance & Compliance",
    easeOfAccess: "High",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
  },
  {
    id: "A22",
    name: "Documents, Procedures & Drawings",
    description:
      "Controlled documents, mine procedures, safety cases, SOPs, engineering drawings, and as-built records with revision history.",
    systemLocation: "DMS / EDMS",
    assetFamily: "Governance & Compliance",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
  },
  {
    id: "A23",
    name: "Customer & Offtake 360",
    description:
      "Buyer profiles, product quality requirements, shipment history, demurrage records, and customer quality claims.",
    systemLocation: "CRM / Commercial System",
    assetFamily: "Finance & Commercial",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
  },
  {
    id: "A24",
    name: "Energy Management & Metering",
    description:
      "Electricity consumption by circuit/area, diesel fuel consumption by fleet/equipment, natural gas use, and renewable energy generation at site.",
    systemLocation: "EMS / BMS / Fleet Fuel System",
    assetFamily: "Processing & Metallurgy",
    easeOfAccess: "High",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
  },
  {
    id: "A25",
    name: "Exploration Data",
    description:
      "Drill core logs, drill-hole collar/assay/survey data, geochemical surveys, geophysical surveys, hyperspectral data, and geological interpretations.",
    systemLocation: "Geological Database / Exploration DB",
    assetFamily: "Mining & Geoscience",
    easeOfAccess: "High",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
  },
  {
    id: "A26",
    name: "Cybersecurity & OT Security",
    description:
      "ICS/OT configurations, SIEM events, IDS/IPS alerts, endpoint telemetry, and access control logs for mine and plant OT networks.",
    systemLocation: "SIEM / OT SOC",
    assetFamily: "Governance & Compliance",
    easeOfAccess: "High",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
  },
  {
    id: "A27",
    name: "Enterprise Data Lakehouse & Feature Store",
    description:
      "Unified raw/curated data and governed ML features; the analytics backbone for all mining data use cases.",
    systemLocation: "Data Lake / Warehouse",
    assetFamily: "Foundation & Governance",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
  },
  {
    id: "A28",
    name: "MLOps/Model Registry & Observability",
    description:
      "Versioned models, drift monitoring, latency/SLAs, and governance for deployed ML models across mining operations.",
    systemLocation: "MLOps Platform",
    assetFamily: "Foundation & Governance",
    easeOfAccess: "High",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
  },
  {
    id: "A29",
    name: "Autonomous Systems Data",
    description:
      "Telemetry and event data from autonomous haul trucks, autonomous drills, autonomous trains, and robotic inspection systems.",
    systemLocation: "AHS Platform / Autonomous Ops",
    assetFamily: "Mining Operations",
    easeOfAccess: "High",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
  },
  {
    id: "A30",
    name: "Community & Stakeholder Data",
    description:
      "Land access agreements, community benefit sharing commitments, grievance records, social investment spend, and Indigenous heritage survey data.",
    systemLocation: "Stakeholder Mgmt / GRC",
    assetFamily: "Governance & Compliance",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
  },
];
