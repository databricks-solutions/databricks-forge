/**
 * Superannuation & Retirement -- Master Repository Enrichment Data (v2)
 *
 * Curated Reference Data Assets and Use Cases for Profit-for-Member / Industry Funds,
 * Retail Super, Retirement Income / Pension, Member Administration, and Investments.
 */

import type { MasterRepoUseCase, ReferenceDataAsset } from "./master-repo-types";

export const SUPERANNUATION_USE_CASES: MasterRepoUseCase[] = [
  {
    name: "Churn & Rollover Prediction",
    description:
      "Predict members at risk of rolling out to a competitor fund or SMSF using contribution cessation, portal login activity, life-stage signals, and contact history.",
    rationale:
      "Member registry & balances (A01) + SuperStream contribution events (A02) + digital interaction logs (A03) + contact centre transcripts (A04) detect pre-rollover signals.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Unintended rollover outflows",
    benchmarkImpact: "-10%",
    benchmarkSource: "APRA -- Annual Superannuation Bulletin & Member Rollover Statistics",
    benchmarkUrl: "https://www.apra.gov.au/annual-superannuation-bulletin",
    strategicImperative: "Drive Growth",
    strategicPillar: "Member Acquisition & Retention",
    dataAssetIds: ["A01", "A02", "A03", "A04"],
    dataAssetCriticality: {
      A01: "MC",
      A02: "MC",
      A03: "MC",
      A04: "VA",
    },
    totalLoeEstimate: "Medium",
    mcAccessDifficulty: "Low",
    vaAccessDifficulty: "Low",
    economicPatternName: "Churn Reduction (Retention / LTV Protection)",
    economicImpactCategory: "Revenue",
    economicFormula: "At_risk_members_yr * Delta_churn * Fee_margin_per_member_LTV * Adopt% * Cap%",
    economicFormulaDescription:
      "At_risk_members_yr = members exhibiting contribution stop or rollover enquiry; Delta_churn = absolute reduction in rollout rate; Fee_margin_per_member_LTV = present value of admin + investment fee contribution.",
    economicPatternRationale:
      "Retaining high-balance accumulation members approaching retirement preserves FUM scale and lowers per-member administration cost.",
  },
  {
    name: "Retirement Income & Next-Best Guidance Personalisation",
    description:
      "Identify members approaching preservation age and personalise transition-to-retirement, intra-fund advice, and pension product guidance under the Retirement Income Covenant.",
    rationale:
      "Member demographics & balance tiers (A01) + investment option switches (A05) + advice interactions (A04) + digital behaviour (A03) tailor retirement pathways.",
    modelType: "Advanced — GenAI",
    kpiTarget: "Accumulation-to-pension retention rate",
    benchmarkImpact: "+15%",
    benchmarkSource: "APRA / ASIC -- Retirement Income Covenant Implementation Review",
    benchmarkUrl: "https://www.apra.gov.au/",
    strategicImperative: "Improve Member Outcomes",
    strategicPillar: "Retirement Income & Guidance",
    dataAssetIds: ["A01", "A03", "A04", "A05"],
    dataAssetCriticality: {
      A01: "MC",
      A03: "MC",
      A05: "MC",
      A04: "VA",
    },
    totalLoeEstimate: "Medium",
    mcAccessDifficulty: "Low",
    vaAccessDifficulty: "Low",
    economicPatternName: "Revenue Uplift (Conversion / Attach / Cross-sell)",
    economicImpactCategory: "Revenue",
    economicFormula: "Retiring_members_yr * Delta_conv * Pension_LTV_margin * Adopt% * Cap%",
    economicFormulaDescription:
      "Retiring_members_yr = members reaching ages 58-67 annually; Delta_conv = incremental conversion to internal account-based pension; Pension_LTV_margin = retained FUM fee margin.",
    economicPatternRationale:
      "Members at retirement hold the highest average balances; proactive intra-fund guidance prevents outflow at the accumulation-to-pension cliff.",
  },
  {
    name: "Member Contact Centre & Claims Triage Automation",
    description:
      "Automate classification, document extraction, and advisor assist for death/TPD/income-protection insurance claims and beneficiary nominations.",
    rationale:
      "Contact centre interactions & forms (A04) + group insurance policies & claims (A06) + member admin records (A01) accelerate claim assessment and FAR/CPS 230 SLA compliance.",
    modelType: "Advanced — GenAI",
    kpiTarget: "Cost per member service & claim transaction",
    benchmarkImpact: "-25%",
    benchmarkSource: "ASIC Report 760 -- Insurance in Superannuation Claims Handling",
    benchmarkUrl: "https://asic.gov.au/",
    strategicImperative: "Reduce Cost-to-Serve",
    strategicPillar: "Member Administration & Claims Operations",
    dataAssetIds: ["A04", "A06", "A01", "A07"],
    dataAssetCriticality: {
      A04: "MC",
      A06: "MC",
      A01: "MC",
      A07: "VA",
    },
    totalLoeEstimate: "Medium",
    mcAccessDifficulty: "Low",
    vaAccessDifficulty: "Low",
    economicPatternName: "Productivity Capacity (Time-to-Decision / Ticket Deflection)",
    economicImpactCategory: "Productivity / Capacity",
    economicFormula: "Cases_yr * Delta_hrs * Rate_hr * Adopt% * Cap%",
    economicFormulaDescription:
      "Cases_yr = annual member service requests and insurance claims; Delta_hrs = handling time saved per case via AI document extraction and routing; Rate_hr = loaded case-manager hourly cost.",
    economicPatternRationale:
      "Automating KYC/claim document parsing reduces manual back-office handling and prevents regulatory breach penalties on claim turnaround times.",
  },
  {
    name: "Employer SuperStream Contribution Arrears & Anomaly Detection",
    description:
      "Detect late, underpaid, or anomalous employer SuperStream contributions early to protect member entitlements and streamline employer remediation.",
    rationale:
      "SuperStream clearing house transactions (A02) + employer registry (A08) + member employment links (A01) flag missed payroll cycles.",
    modelType: "Basic-ML",
    kpiTarget: "Unallocated & exception contribution processing cost",
    benchmarkImpact: "-20%",
    benchmarkSource: "ATO -- SuperStream Data & Payment Standards",
    benchmarkUrl: "https://www.ato.gov.au/",
    strategicImperative: "Deepen Employer Partnerships",
    strategicPillar: "Employer Operations & Arrears",
    dataAssetIds: ["A02", "A08", "A01"],
    dataAssetCriticality: {
      A02: "MC",
      A08: "MC",
      A01: "MC",
    },
    totalLoeEstimate: "Low",
    mcAccessDifficulty: "Low",
    vaAccessDifficulty: "Low",
    economicPatternName: "Cost Takeout (Labor / Opex Reduction)",
    economicImpactCategory: "Cost",
    economicFormula: "Exceptions_yr * Delta_hrs * Rate_hr * Adopt% * Cap%",
    economicFormulaDescription:
      "Exceptions_yr = annual SuperStream contribution exceptions and unallocated money cases; Delta_hrs = manual reconciliation hours saved; Rate_hr = admin ops hourly cost.",
    economicPatternRationale:
      "Automated entity matching and payroll cadence checks resolve SuperStream exceptions before the 3-day allocation deadline.",
  },
  {
    name: "Investment Portfolio Look-Through, Liquidity & YFYS Attribution",
    description:
      "Unify listed and unlisted asset holdings, daily unit pricing, liquidity stress tests, and APRA Your Future Your Super (YFYS) benchmark attribution.",
    rationale:
      "Custodian holdings & unit prices (A05) + unlisted asset valuations (A05) + member option switches (A01) + regulatory reporting tables (A07) power daily attribution.",
    modelType: "Intermediate — Traditional AI",
    kpiTarget: "Investment operations & regulatory reporting effort",
    benchmarkImpact: "-30%",
    benchmarkSource: "APRA -- SPS 530 Investment Governance & YFYS Performance Test",
    benchmarkUrl: "https://www.apra.gov.au/",
    strategicImperative: "Strengthen Compliance",
    strategicPillar: "Investment Data & APRA Reporting",
    dataAssetIds: ["A05", "A01", "A07"],
    dataAssetCriticality: {
      A05: "MC",
      A07: "MC",
      A01: "VA",
    },
    totalLoeEstimate: "Medium",
    mcAccessDifficulty: "Medium",
    vaAccessDifficulty: "Low",
    economicPatternName: "Risk Avoidance (Compliance / Penalties / Outage Impact)",
    economicImpactCategory: "Risk / Loss Avoidance",
    economicFormula: "Risk_exposure_yr * Delta_prob * Severity * Cap%",
    economicFormulaDescription:
      "Risk_exposure_yr = unit-pricing error compensation and APRA reporting breach exposure; Delta_prob = reduction from automated daily look-through validation.",
    economicPatternRationale:
      "Automated custodian-to-registry reconciliation catches unit-pricing and fee-cap errors before member transactions settle.",
  },
];

export const SUPERANNUATION_DATA_ASSETS: ReferenceDataAsset[] = [
  {
    id: "A01",
    name: "Member Registry, Accounts & Balances (Accumulation & Pension)",
    description:
      "Member demographics, TFN/KYC status, account balances, investment option allocations, and beneficiary nominations.",
    systemLocation: "Member Admin Registry (Acurity / Sonata / Bluedoor)",
    assetFamily: "Member Administration",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
    systemKind: "ERP",
  },
  {
    id: "A02",
    name: "SuperStream Contributions, Rollovers & ATO Gateway Logs",
    description:
      "SG employer contributions, salary sacrifice, personal deductible contributions, USM/MAAS/MATS ATO messages, and inward/outward rollovers.",
    systemLocation: "Clearing House / SuperStream Gateway",
    assetFamily: "Member Administration",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
    systemKind: "ERP",
  },
  {
    id: "A03",
    name: "Member Portal, Mobile App & Digital Engagement Events",
    description:
      "Web/app logins, balance checks, investment switch journeys, retirement calculator usage, and campaign clickstreams.",
    systemLocation: "CDP / Adobe / GA4 / Mobile App",
    assetFamily: "Digital & Engagement",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "Low",
    lakebridgeMigrate: "Low",
    bespoke: "Low",
    systemKind: "CDP",
  },
  {
    id: "A04",
    name: "Contact Centre Interactions, Advice Notes & Uploaded Forms",
    description:
      "Call transcripts, CRM cases, intra-fund financial advice records, complaints (IDR/AFCA), and scanned member PDF forms.",
    systemLocation: "Salesforce / Genesys / Document Volumes",
    assetFamily: "Digital & Engagement",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
    systemKind: "CRM",
  },
  {
    id: "A05",
    name: "Custodian Investment Holdings, Unit Prices & Unlisted Valuations",
    description:
      "Daily unit prices, custodian asset holdings, external manager mandates, private market valuations, and YFYS benchmark indices.",
    systemLocation: "Custodian / SimCorp / Aladdin / Bloomberg",
    assetFamily: "Investments",
    easeOfAccess: "Medium",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
    systemKind: "ERP",
  },
  {
    id: "A06",
    name: "Group Insurance Policies, Premiums & Claims (Death/TPD/IP)",
    description:
      "Default and voluntary Death, TPD, and Income Protection cover levels, premium deductions, and insurer claim statuses.",
    systemLocation: "Group Insurance Admin",
    assetFamily: "Insurance",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
    systemKind: "ERP",
  },
  {
    id: "A07",
    name: "APRA D2A / CPS 230 / FAR Regulatory & Risk Registers",
    description:
      "APRA Superannuation Data Transformation (SDT) submissions, critical operations registers (CPS 230), breach logs, and AML/CTF alerts.",
    systemLocation: "GRC / Regulatory Reporting",
    assetFamily: "Risk & Compliance",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
    systemKind: "Other",
  },
  {
    id: "A08",
    name: "Participating Employer & Default Fund Distribution Registry",
    description:
      "Default employer relationships, enterprise agreements, clearing house onboarding status, and BD relationship notes.",
    systemLocation: "CRM / Employer Portal",
    assetFamily: "Employer & Distribution",
    easeOfAccess: "Low",
    lakeflowConnect: "High",
    ucFederation: "High",
    lakebridgeMigrate: "High",
    bespoke: "Low",
    systemKind: "CRM",
  },
];
