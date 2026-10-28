/**
 * Automotive & Mobility -- Master Repository Enrichment Data (v2)
 *
 * Curated Reference Data Assets and Use Cases for OEMs, Importers,
 * Multi-Franchise Dealer Groups, Connected Vehicles, Aftersales, and Fleet/Leasing.
 */

import type { MasterRepoUseCase, ReferenceDataAsset } from "./master-repo-types";

export const AUTOMOTIVE_MOBILITY_USE_CASES: MasterRepoUseCase[] = [
  {
    name: "Dynamic Vehicle Pricing & Incentive Optimization",
    description:
      "Recommend VIN-level retail prices, trade-in allowances, and OEM tactical incentives using regional demand, days-in-stock, and market listings.",
    rationale:
      "Vehicle inventory & ageing (A02) + DMS deal jackets (A01) + competitor market listings (A07) + OEM incentive rules (A06) optimise gross margin per unit.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Front-end gross margin per vehicle",
    benchmarkImpact: "+2%",
    benchmarkSource: "NADA / Cox Automotive -- Dealer Profitability Benchmarks",
    benchmarkUrl: "https://www.nada.org/",
    strategicImperative: "Transform Retail & Omnichannel Sales",
    strategicPillar: "Omnichannel Retail & E-Commerce",
    dataAssetIds: ["A01", "A02", "A06", "A07"],
    dataAssetCriticality: {
      A01: "MC",
      A02: "MC",
      A07: "MC",
      A06: "VA",
    },
    totalLoeEstimate: "Medium",
    mcAccessDifficulty: "Low",
    vaAccessDifficulty: "Low",
    economicPatternName: "Price Realization (Yield / Rate Optimization)",
    economicImpactCategory: "Revenue",
    economicFormula: "Units_sold_yr * Avg_vehicle_price * Delta_margin_pct * Adopt% * Cap%",
    economicFormulaDescription:
      "Units_sold_yr = annual new and used vehicles retailed; Avg_vehicle_price = average transaction price; Delta_margin_pct = net gross margin lift from dynamic pricing and reduced ageing write-downs.",
    economicPatternRationale:
      "Adjusting price and incentive mix early in a vehicle's stocking lifecycle avoids steep 60/90-day aged-stock wholesale losses.",
  },
  {
    name: "Aftersales Service Retention & Predictive Workshop Booking",
    description:
      "Predict when a customer's vehicle is due for scheduled service or wear-item replacement and trigger personalised omnichannel booking offers before defection to independent workshops.",
    rationale:
      "DMS repair orders (A03) + connected vehicle odometer/DTC telemetry (A04) + CRM customer profiles (A01) identify defection risk at warranty expiry.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Post-warranty service retention",
    benchmarkImpact: "+12%",
    benchmarkSource: "ICD / J.D. Power -- Customer Service Index (CSI) & Retention",
    benchmarkUrl: "https://www.jdpower.com/",
    strategicImperative: "Grow Aftersales Profitability",
    strategicPillar: "Service Retention & Workshop Utilisation",
    dataAssetIds: ["A01", "A03", "A04", "A05"],
    dataAssetCriticality: {
      A01: "MC",
      A03: "MC",
      A04: "VA",
      A05: "VA",
    },
    totalLoeEstimate: "Low",
    mcAccessDifficulty: "Low",
    vaAccessDifficulty: "Medium",
    economicPatternName: "Churn Reduction (Retention / LTV Protection)",
    economicImpactCategory: "Revenue",
    economicFormula: "Active_vin_base * Delta_retention_pct * Annual_RO_margin * Adopt% * Cap%",
    economicFormulaDescription:
      "Active_vin_base = 3-to-7 year vehicle car-parc in primary marketing area; Delta_retention_pct = incremental service retention lift; Annual_RO_margin = gross profit per retained service customer.",
    economicPatternRationale:
      "Service and parts absorb 50%+ of dealership fixed overhead; retaining owners past year 3 protects high-margin labour and parts sales.",
  },
  {
    name: "Warranty Claim Anomaly & Early Field Failure Detection",
    description:
      "Detect emerging component failure clusters and anomalous dealer warranty claims using DTC telematics, technician repair text, and batch supplier genealogy.",
    rationale:
      "Warranty claims & technician notes (A03) + connected vehicle DTCs (A04) + VIN build/supplier genealogy (A02) isolate defective batches early and flag claim over-billing.",
    modelType: "Advanced — GenAI",
    kpiTarget: "Warranty cost & claim leakage",
    benchmarkImpact: "-10%",
    benchmarkSource: "Warranty Week -- Automotive Warranty Spend Benchmarks",
    benchmarkUrl: "https://www.warrantyweek.com/",
    strategicImperative: "Drive Operational Excellence",
    strategicPillar: "Quality & Warranty Intelligence",
    dataAssetIds: ["A03", "A04", "A02", "A05"],
    dataAssetCriticality: {
      A03: "MC",
      A02: "MC",
      A04: "VA",
      A05: "VA",
    },
    totalLoeEstimate: "Medium",
    mcAccessDifficulty: "Low",
    vaAccessDifficulty: "Medium",
    economicPatternName: "Loss Avoidance (Fraud / Shrink / Leakage / Errors)",
    economicImpactCategory: "Risk / Loss Avoidance",
    economicFormula: "Warranty_spend_yr * Delta_pct * Adopt% * Cap%",
    economicFormulaDescription:
      "Warranty_spend_yr = annual warranty claim payout and recall campaign cost; Delta_pct = reduction from early containment and duplicate/invalid claim detection.",
    economicPatternRationale:
      "NLP extraction on technician narratives combined with DTC codes cuts time-to-detect field quality issues and supplier recovery time.",
  },
  {
    name: "Parts Inventory & Obsolescence Optimization",
    description:
      "Forecast SKU-location parts demand across dealer workshops and regional PDCs to improve first-time pick rates while reducing dead stock.",
    rationale:
      "Parts ledger & bin movements (A05) + workshop RO history (A03) + local vehicle car-parc (A02) align stocking depth with actual repair demand.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Parts inventory carrying & obsolescence cost",
    benchmarkImpact: "-15%",
    benchmarkSource: "NADA -- Dealership Parts Inventory Benchmarks",
    benchmarkUrl: "https://www.nada.org/",
    strategicImperative: "Grow Aftersales Profitability",
    strategicPillar: "Parts Supply Chain",
    dataAssetIds: ["A05", "A03", "A02", "A06"],
    dataAssetCriticality: {
      A05: "MC",
      A03: "MC",
      A02: "VA",
      A06: "VA",
    },
    totalLoeEstimate: "Medium",
    mcAccessDifficulty: "Low",
    vaAccessDifficulty: "Low",
    economicPatternName: "Working Capital Improvement (Inventory / AR / AP Efficiency)",
    economicImpactCategory: "Cash / Working Capital",
    economicFormula: "Parts_WC_base * Delta_days * Cost_of_capital * Adopt% * Cap%",
    economicFormulaDescription:
      "Parts_WC_base = total capital tied up in dealer/PDC parts inventory; Delta_days = reduction in days-of-supply and aged write-offs; Cost_of_capital = floorplan/working capital rate.",
    economicPatternRationale:
      "Replacing static min/max rules with car-parc-driven demand forecasting releases working capital and prevents bay delays.",
  },
  {
    name: "Fleet Residual Value & Lease End-of-Term Forecasting",
    description:
      "Forecast vehicle residual values at lease maturity using mileage telemetry, auction clearance prices, EV battery SOH, and macro indicators.",
    rationale:
      "Lease contract portfolio (A08) + auction/market pricing (A07) + connected vehicle mileage/battery health (A04) improve lease pricing and remarketing channel selection.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Residual value realization",
    benchmarkImpact: "+3%",
    benchmarkSource: "AFMA / Cox Automotive -- Wholesale & Residual Value Index",
    benchmarkUrl: "https://www.coxautoinc.com/",
    strategicImperative: "Improve Asset Utilization",
    strategicPillar: "Fleet & Leasing Intelligence",
    dataAssetIds: ["A08", "A07", "A04", "A02"],
    dataAssetCriticality: {
      A08: "MC",
      A07: "MC",
      A02: "MC",
      A04: "VA",
    },
    totalLoeEstimate: "Medium",
    mcAccessDifficulty: "Low",
    vaAccessDifficulty: "Medium",
    economicPatternName: "Price Realization (Yield / Rate Optimization)",
    economicImpactCategory: "Revenue",
    economicFormula: "Off_lease_units_yr * Avg_RV * Delta_realization_pct * Adopt% * Cap%",
    economicFormulaDescription:
      "Off_lease_units_yr = vehicles remarketed at end of lease per year; Avg_RV = average residual value; Delta_realization_pct = net gain from optimal timing and channel routing.",
    economicPatternRationale:
      "Routing off-lease vehicles to direct-to-retail vs wholesale auction based on VIN condition and local demand maximises net recovery.",
  },
];

export const AUTOMOTIVE_MOBILITY_DATA_ASSETS: ReferenceDataAsset[] = [
  {
    id: "A01",
    name: "Dealer Management System (DMS) Vehicle Sales & CRM Leads",
    description:
      "Showroom traffic, web leads, test drives, deal jackets, F&I penetration, and customer master profiles.",
    systemLocation: "DMS / Pentana / CDK / Reynolds / Salesforce",
    assetFamily: "Retail & Customer",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
    systemKind: "CRM",
  },
  {
    id: "A02",
    name: "Vehicle Inventory, VIN Build Spec & Floorplan Ledger",
    description:
      "New/used vehicle stock, VIN trim/options, factory order pipeline, days-in-stock, and floorplan interest.",
    systemLocation: "DMS / OEM Order Management",
    assetFamily: "Inventory & Supply",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
    systemKind: "ERP",
  },
  {
    id: "A03",
    name: "Workshop Repair Orders (RO) & Warranty Claims",
    description:
      "Service repair orders, technician clock times, labour op codes, warranty claims, and free-text technician diagnostics.",
    systemLocation: "DMS Aftersales / OEM Warranty Portal",
    assetFamily: "Aftersales & Service",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
    systemKind: "ERP",
  },
  {
    id: "A04",
    name: "Connected Vehicle Telematics, Odometer & EV Battery SOH",
    description:
      "Over-the-air Diagnostic Trouble Codes (DTCs), odometer readings, EV battery state-of-health, and trip telemetry.",
    systemLocation: "Connected Car Cloud / Telematics Hub",
    assetFamily: "Connected Vehicle",
    easeOfAccess: "Medium",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
    bespoke: "High",
    systemKind: "SCADA / Historian",
  },
  {
    id: "A05",
    name: "Parts Inventory, PDC Shipments & Backorder Ledger",
    description:
      "Dealer and parts distribution centre SKU stock, bin movements, lost sales, supersessions, and supplier lead times.",
    systemLocation: "DMS Parts / WMS",
    assetFamily: "Aftersales & Service",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
    systemKind: "ERP",
  },
  {
    id: "A06",
    name: "OEM Incentives, Dealer Rebates & Finance Floorplan",
    description:
      "Tactical retail campaigns, fleet rebates, dealer target bonuses, and wholesale floorplan financing terms.",
    systemLocation: "ERP / Finance",
    assetFamily: "Finance & Risk",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
    systemKind: "ERP",
  },
  {
    id: "A07",
    name: "Used Vehicle Market Listings & Auction Valuations",
    description:
      "External retail listing prices, days-to-sell, wholesale auction Hammer prices, and valuation guidebooks.",
    systemLocation: "Market Data Feeds / RedBook / Glass's",
    assetFamily: "External Market Data",
    easeOfAccess: "Low",
    lakeflowConnect: "Low",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
    bespoke: "High",
  },
  {
    id: "A08",
    name: "Fleet & Novated Lease Portfolio Management",
    description:
      "Lease contracts, contracted residual values, mileage allowances, maintenance budgets, and fuel card transactions.",
    systemLocation: "Lease Management System",
    assetFamily: "Finance & Risk",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
    systemKind: "ERP",
  },
];
