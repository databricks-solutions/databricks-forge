/**
 * Economic Patterns and Impact Categories.
 *
 * Sourced from the Master Repository XLSX. There are 10 canonical patterns
 * grouped into 5 impact categories. Every use case in the master repository
 * maps to exactly one pattern, which determines the formula skeleton used by
 * the Business Value engine for financial quantification.
 *
 * Counts (from the Master Repo, all industries combined):
 *   Cost                          132 use cases
 *   Revenue                       170 use cases
 *   Productivity / Capacity       128 use cases
 *   Risk / Loss Avoidance         128 use cases
 *   Cash / Working Capital         20 use cases
 *
 * NOTE: this module is the single source of truth for the EconomicPatternName
 * and EconomicImpactCategory unions. Both ReferenceDataAsset / MasterRepoUseCase
 * and the Business Value prompt builder import from here.
 */

export type EconomicImpactCategory =
  | "Cost"
  | "Revenue"
  | "Productivity / Capacity"
  | "Risk / Loss Avoidance"
  | "Cash / Working Capital";

export const ECONOMIC_IMPACT_CATEGORIES: readonly EconomicImpactCategory[] = [
  "Cost",
  "Revenue",
  "Productivity / Capacity",
  "Risk / Loss Avoidance",
  "Cash / Working Capital",
] as const;

export type EconomicPatternName =
  | "Cost Takeout (Labor / Opex Reduction)"
  | "Price Realization (Yield / Rate Optimization)"
  | "Productivity Capacity (Time-to-Decision / Ticket Deflection)"
  | "Revenue Uplift (Conversion / Attach / Cross-sell)"
  | "Capex Avoidance (Infrastructure / Tool Consolidation)"
  | "Loss Avoidance (Fraud / Shrink / Leakage / Errors)"
  | "Churn Reduction (Retention / LTV Protection)"
  | "Risk Avoidance (Compliance / Penalties / Outage Impact)"
  | "Waste Reduction (Spoilage / Returns / Write-downs)"
  | "Working Capital Improvement (Inventory / AR / AP Efficiency)";

export interface EconomicPattern {
  name: EconomicPatternName;
  category: EconomicImpactCategory;
  /**
   * Canonical formula skeleton using variable placeholders. Real formulas in
   * the master repository often instantiate these placeholders with concrete
   * variables specific to the use case (e.g. Pipes_yr, Tickets_yr).
   */
  defaultFormula: string;
  /** Short narrative describing each variable in the default formula. */
  variableHints: string[];
  /**
   * Optional D4B-style benchmark range, as a percentage delta applied to the
   * relevant KPI. Use only as a sanity check — actual benchmarks live on each
   * `MasterRepoUseCase.benchmarkImpact`.
   */
  expectedRangePct?: { low: number; high: number };
}

export const ECONOMIC_PATTERNS: Record<EconomicPatternName, EconomicPattern> = {
  "Cost Takeout (Labor / Opex Reduction)": {
    name: "Cost Takeout (Labor / Opex Reduction)",
    category: "Cost",
    defaultFormula: "Units_yr x Delta_hrs x Rate_hr x Adopt% x Cap%",
    variableHints: [
      "Units_yr = number of work units performed per year (e.g. pipelines, tickets, reports)",
      "Delta_hrs = hours saved per unit when automated / AI-assisted",
      "Rate_hr = fully-loaded labor cost per hour",
      "Adopt% = share of units actually using the new capability in year 1",
      "Cap% = cap on captured savings to account for residual oversight",
    ],
    expectedRangePct: { low: 10, high: 30 },
  },
  "Price Realization (Yield / Rate Optimization)": {
    name: "Price Realization (Yield / Rate Optimization)",
    category: "Revenue",
    defaultFormula: "Volume_yr x Delta_price x Adopt% x Cap%",
    variableHints: [
      "Volume_yr = transactions / units / impressions priced per year",
      "Delta_price = net per-unit price uplift attributable to AI-driven yield management",
      "Adopt% = share of volume actually re-priced",
      "Cap% = realization cap to account for elasticity and competitive response",
    ],
    expectedRangePct: { low: 2, high: 10 },
  },
  "Productivity Capacity (Time-to-Decision / Ticket Deflection)": {
    name: "Productivity Capacity (Time-to-Decision / Ticket Deflection)",
    category: "Productivity / Capacity",
    defaultFormula: "Decisions_yr x Delta_hrs x Rate_hr x Adopt% x Cap%",
    variableHints: [
      "Decisions_yr = decisions / tickets / analyses produced per year",
      "Delta_hrs = hours saved per decision",
      "Rate_hr = fully-loaded labor cost per hour",
      "Adopt% = share of decisions touched by the new capability in year 1",
      "Cap% = effective capture rate",
    ],
    expectedRangePct: { low: 15, high: 40 },
  },
  "Revenue Uplift (Conversion / Attach / Cross-sell)": {
    name: "Revenue Uplift (Conversion / Attach / Cross-sell)",
    category: "Revenue",
    defaultFormula: "Audience_yr x Delta_conv x AOV x Adopt% x Cap%",
    variableHints: [
      "Audience_yr = addressable audience exposed to the experience per year",
      "Delta_conv = incremental conversion rate lift (decimal, e.g. 0.02)",
      "AOV = average order value or per-conversion revenue",
      "Adopt% = share of audience receiving the new experience",
      "Cap% = realization cap to control for selection bias",
    ],
    expectedRangePct: { low: 5, high: 20 },
  },
  "Capex Avoidance (Infrastructure / Tool Consolidation)": {
    name: "Capex Avoidance (Infrastructure / Tool Consolidation)",
    category: "Cost",
    defaultFormula: "Capex_avoided_yr x Cap%",
    variableHints: [
      "Capex_avoided_yr = annualized infrastructure / tooling spend avoided through consolidation",
      "Cap% = realization cap reflecting transition costs",
    ],
    expectedRangePct: { low: 5, high: 25 },
  },
  "Loss Avoidance (Fraud / Shrink / Leakage / Errors)": {
    name: "Loss Avoidance (Fraud / Shrink / Leakage / Errors)",
    category: "Risk / Loss Avoidance",
    defaultFormula: "Loss_yr x Delta_pct x Adopt% x Cap%",
    variableHints: [
      "Loss_yr = total annual losses from the category (fraud, shrink, leakage)",
      "Delta_pct = percentage reduction in losses attributable to the AI capability",
      "Adopt% = share of transactions / events scored",
      "Cap% = realization cap to account for adversarial adaptation",
    ],
    expectedRangePct: { low: 10, high: 30 },
  },
  "Churn Reduction (Retention / LTV Protection)": {
    name: "Churn Reduction (Retention / LTV Protection)",
    category: "Revenue",
    defaultFormula: "Customers_yr x Delta_churn x LTV x Adopt% x Cap%",
    variableHints: [
      "Customers_yr = customers at risk of churn in the period",
      "Delta_churn = absolute churn rate reduction (decimal)",
      "LTV = average customer lifetime value",
      "Adopt% = share of at-risk customers receiving retention intervention",
      "Cap% = realization cap reflecting attribution uncertainty",
    ],
    expectedRangePct: { low: 5, high: 15 },
  },
  "Risk Avoidance (Compliance / Penalties / Outage Impact)": {
    name: "Risk Avoidance (Compliance / Penalties / Outage Impact)",
    category: "Risk / Loss Avoidance",
    defaultFormula: "Risk_exposure_yr x Delta_prob x Severity x Cap%",
    variableHints: [
      "Risk_exposure_yr = annual exposure base (fines, outage hours, breach scope)",
      "Delta_prob = reduction in probability of the adverse event",
      "Severity = average financial severity per occurrence",
      "Cap% = realization cap reflecting residual risk",
    ],
    expectedRangePct: { low: 10, high: 50 },
  },
  "Waste Reduction (Spoilage / Returns / Write-downs)": {
    name: "Waste Reduction (Spoilage / Returns / Write-downs)",
    category: "Cost",
    defaultFormula: "Waste_yr x Delta_pct x Adopt% x Cap%",
    variableHints: [
      "Waste_yr = annual cost of waste (spoilage, returns, write-downs)",
      "Delta_pct = percentage reduction in waste",
      "Adopt% = share of SKUs / locations covered",
      "Cap% = realization cap",
    ],
    expectedRangePct: { low: 10, high: 30 },
  },
  "Working Capital Improvement (Inventory / AR / AP Efficiency)": {
    name: "Working Capital Improvement (Inventory / AR / AP Efficiency)",
    category: "Cash / Working Capital",
    defaultFormula: "WC_base x Delta_days x Cost_of_capital x Adopt% x Cap%",
    variableHints: [
      "WC_base = baseline working capital tied up (inventory, AR, AP)",
      "Delta_days = days of working capital released",
      "Cost_of_capital = annualized cost of capital",
      "Adopt% = share of WC pool optimized",
      "Cap% = realization cap",
    ],
    expectedRangePct: { low: 5, high: 15 },
  },
};

export const ECONOMIC_PATTERN_NAMES: readonly EconomicPatternName[] = Object.keys(
  ECONOMIC_PATTERNS,
) as EconomicPatternName[];

/**
 * Back-compatibility map: today's free-form `ValueEstimate.valueType` strings
 * map to the new structured EconomicImpactCategory taxonomy.
 *
 * Used by the Business Value engine to translate legacy LLM outputs into the
 * structured category and by the Data Gap engine when aggregating value at
 * risk across mixed-vintage runs.
 */
export const LEGACY_VALUE_TYPE_MAP: Record<string, EconomicImpactCategory> = {
  cost_savings: "Cost",
  revenue_uplift: "Revenue",
  risk_reduction: "Risk / Loss Avoidance",
  efficiency_gain: "Productivity / Capacity",
};

export function getEconomicPattern(name: string): EconomicPattern | undefined {
  return ECONOMIC_PATTERNS[name as EconomicPatternName];
}

export function isEconomicPatternName(value: string): value is EconomicPatternName {
  return value in ECONOMIC_PATTERNS;
}

export function isEconomicImpactCategory(value: string): value is EconomicImpactCategory {
  return (ECONOMIC_IMPACT_CATEGORIES as readonly string[]).includes(value);
}
