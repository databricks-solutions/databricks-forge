/**
 * Real Money Gaming (Digital) -- Industry Outcome Map
 *
 * Strategic imperatives and pillars are sourced from the Master Repository
 * XLSX (Use Case Summaries sheet). Use case names match the Master Repo
 * canonical taxonomy so `real-money-gaming.enrichment.ts` lookups (keyed
 * by lowercase name) keep resolving. Rich consultant-grade prose --
 * description, businessValue, typicalDataEntities, typicalSourceSystems
 * -- was lifted from the legacy SPORTS_BETTING outcome map during the
 * May 2026 registry consolidation. Benchmarks, model types, KPI targets,
 * dataAssetIds, and economic patterns remain in real-money-gaming.enrichment.ts.
 */

import type { IndustryOutcome } from "./index";

export const REAL_MONEY_GAMING: IndustryOutcome = {
  id: "real-money-gaming",
  name: "Real Money Gaming (Digital)",
  subVerticals: [
    "Online Sportsbook",
    "iGaming Casino",
    "DFS",
    "Poker",
    "Sports Betting (Fixed Odds)",
    "Racing (Thoroughbred, Harness, Greyhounds)",
    "In-Play / Live Betting",
    "Retail Wagering (TAB outlets, pubs, clubs)",
    "Lotteries & Keno",
  ],
  suggestedDomains: [
    "Bettor Experience",
    "Trading & Pricing",
    "Compliance",
    "Marketing",
    "Player Protection",
    "Responsible Gambling",
    "Finance",
    "Operations",
    "Data & Analytics",
  ],
  suggestedPriorities: [
    "Acquire & Retain Bettors",
    "Build the Bet",
    "Comply & Protect",
    "Increase Revenue",
    "Enhance Customer Experience",
    "Mitigate Risk",
    "Ensure Compliance",
    "Reduce Cost",
    "Drive Innovation",
  ],
  objectives: [
    {
      name: "Bettor Centric Experience",
      whyChange:
        "Customer acquisition costs in real-money gaming have tripled as competition intensifies and advertising restrictions tighten across the US, UK, EU, and APAC. Operators must unify fragmented bettor data across digital app, web, retail, and call-centre channels, personalise offers without breaching responsible gambling obligations, and retain high-value bettors to protect margins. Knowing, attracting, and protecting the bettor unlocks digital LTV while meeting responsible-gaming obligations -- those who cannot build a single view of the bettor will lose share to operators who can.",
      priorities: [
        {
          name: "Know the Bettor",
          useCases: [
            {
              name: "Bettor360",
              description:
                "Unified, queryable 360 degree bettor profile spanning digital app, web, retail, and call-centre channels -- combining bet history, deposit/withdrawal patterns, promotional responses, responsible-gambling settings, KYC artefacts, and customer-service interactions into a single view used by service, trading, and marketing.",
              businessValue:
                "Foundational for every personalisation, retention, and responsible-gambling use case; operators report 15-25% uplift in campaign effectiveness after deploying unified profiles.",
              typicalDataEntities: [
                "Bettor Profiles",
                "Bet History",
                "Deposit & Withdrawal Records",
                "Channel Interactions",
                "Responsible Gambling Settings",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "CRM",
                "Payment Gateway",
                "Retail Terminal System",
                "Customer Service Platform",
              ],
            },
            {
              name: "Segmentation",
              description:
                "Create actionable player cohorts using ML-driven clustering across dimensions including sport/racing preference, bet type (singles vs multis vs exotics), stake level, session frequency, channel preference, and promotional sensitivity to drive lifecycle programs and targeted engagement.",
              businessValue:
                "10-20% improvement in promotional ROI through segment-specific campaigns instead of blanket offers.",
              typicalDataEntities: [
                "Bet History",
                "Bettor Profiles",
                "Segment Definitions",
                "Engagement Scores",
                "Promotional Response Data",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "CRM",
                "Marketing Platform",
                "Analytics Platform",
              ],
            },
            {
              name: "Greater Fan Experience",
              description:
                "Tailor UX, content, markets, and event surfacing per bettor and context to simplify decisions and reduce friction in the bet placement journey.",
              businessValue:
                "Higher engagement and bets per session through context-aware experience design.",
              typicalDataEntities: [
                "Bettor Preferences",
                "Event Calendar",
                "Content Catalog",
                "Session Telemetry",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "CRM",
                "Content Management System",
              ],
            },
            {
              name: "Journey Analytics",
              description:
                "Map bettor journeys and drop-offs across registration, KYC, deposit, first bet, and retention milestones to optimise funnels and reduce friction at every stage.",
              businessValue:
                "Material lift in onboarding-to-first-bet conversion; data-driven prioritisation of UX investment.",
              typicalDataEntities: [
                "Funnel Step Events",
                "Drop-Off Points",
                "Cohort Definitions",
                "Conversion Rates",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "Analytics Platform",
                "A/B Testing Platform",
              ],
            },
            {
              name: "Identity Resolution",
              description:
                "Resolve cross-device, cross-channel, and retail-plus-digital identifiers to a single bettor graph honouring privacy controls -- closing the attribution gap between retail TAB / cash bets and digital accounts using loyalty cards, venue check-ins, and behavioural matching.",
              businessValue:
                "20-30% increase in attributable retail revenue; enables true omnichannel bettor understanding.",
              typicalDataEntities: [
                "Identity Graph",
                "Retail Transaction Logs",
                "Loyalty Card Events",
                "Digital Account IDs",
                "Venue Check-In Data",
              ],
              typicalSourceSystems: [
                "Retail Terminal System",
                "Loyalty Platform",
                "Betting Platform / PAM",
                "Venue Management System",
              ],
            },
            {
              name: "Single Wallet",
              description:
                "Provide a unified, compliant wallet across products (sportsbook, casino, racing, lotteries) with real-time balance, regulated cross-product play, and consolidated AML/CTF transaction monitoring.",
              businessValue:
                "Improved cross-product bet share; cleaner regulatory reporting; better bettor experience on multi-product platforms.",
              typicalDataEntities: [
                "Wallet Ledger",
                "Cross-Product Transactions",
                "Balance Snapshots",
                "Reconciliation Records",
              ],
              typicalSourceSystems: [
                "Wallet Service",
                "Betting Platform / PAM",
                "Payment Gateway",
                "Casino Platform",
              ],
            },
            {
              name: "Early VIP Identification",
              description:
                "Identify high-potential bettors quickly using deposit, frequency, stake, and behavioural signals so VIP relationship-management programs intercept them before competitor poach.",
              businessValue:
                "Higher VIP capture rate; protected high-value cohort that typically drives 40-60% of revenue.",
              typicalDataEntities: [
                "Bet History",
                "Deposit Patterns",
                "Engagement Scores",
                "VIP Tier Assignments",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "CRM",
                "VIP Management System",
              ],
            },
          ],
          kpis: [
            "Active bettors",
            "Bettor LTV",
            "Retention cohort decay",
            "Customer data completeness score",
          ],
          personas: [
            "Chief Marketing Officer",
            "VP Retention",
            "VP Player Protection",
            "Head of Customer Intelligence",
            "Chief Data Officer",
          ],
        },
        {
          name: "Attract Bettors",
          useCases: [
            {
              name: "Next Best Bet",
              description:
                "Contextual recommendations of markets, legs, and offers based on bettor context, recent bet history, sport/racing preferences, and current odds movements -- delivered at the optimal moment across push, app, and email channels.",
              businessValue:
                "15-25% increase in offer acceptance rates; measurable uplift in bets per active bettor.",
              typicalDataEntities: [
                "Bettor Preferences",
                "Event Calendar",
                "Odds Movements",
                "Promotional Catalog",
                "Real-Time Bet Activity",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "Odds Feed Provider",
                "CRM",
                "Marketing Platform",
                "Event Data Provider",
              ],
            },
            {
              name: "(Re)Marketing",
              description:
                "Orchestrate trigger-based retention, reactivation, and upsell journeys across the bettor lifecycle -- onboarding sequences for new sign-ups, reactivation flows for lapsed bettors, milestone rewards, and seasonal-event ramp-ups -- personalised by channel preference and behaviour.",
              businessValue:
                "30-40% improvement in onboarding-to-first-bet conversion; reduced manual campaign operations.",
              typicalDataEntities: [
                "Bettor Lifecycle Stage",
                "Journey Definitions",
                "Trigger Events",
                "Channel Preferences",
                "Campaign Performance",
              ],
              typicalSourceSystems: [
                "Marketing Platform",
                "CRM",
                "Betting Platform / PAM",
                "Email/Push Service",
              ],
            },
            {
              name: "Cohort Analysis",
              description:
                "Measure cohorts (by join date, product, promo) over time to understand retention, revenue, and behaviour trends and inform LTV models.",
              businessValue:
                "Better-allocated acquisition spend; cleaner LTV reporting for finance and investor communications.",
              typicalDataEntities: [
                "Cohort Definitions",
                "Retention Curves",
                "Revenue by Cohort",
              ],
              typicalSourceSystems: [
                "Analytics Platform",
                "Betting Platform / PAM",
                "Marketing Platform",
              ],
            },
            {
              name: "Pre-VIP Engagement",
              description:
                "Identify rising-value bettors and trigger host outreach early using propensity models on stake, frequency, and engagement trajectories.",
              businessValue:
                "Higher VIP-tier conversion; protected revenue base in the high-value cohort.",
              typicalDataEntities: [
                "Bet History",
                "VIP Propensity Scores",
                "Host Outreach Logs",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "CRM",
                "VIP Management System",
              ],
            },
            {
              name: "Promotions",
              description:
                "Optimise promotional spend by modelling the incremental revenue impact of each promotional type (bonus bets, boosted odds, deposit matches, refund specials) by bettor segment and event type, reallocating budget from low-ROI generics to high-impact targeted promotions.",
              businessValue:
                "10-20% improvement in promotional ROI; reduction in bonus-bet cost as a percentage of revenue.",
              typicalDataEntities: [
                "Promotion Definitions",
                "Redemption History",
                "Incremental Revenue Attribution",
                "Bonus Bet Costs",
                "Bettor Segments",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "CRM",
                "Finance System",
                "Marketing Platform",
              ],
            },
            {
              name: "Personalization",
              description:
                "Dynamic content, markets, and UX served by context -- featured races, promoted events, form guides, and tips personalised by sport/race preferences, betting history, and geographic location.",
              businessValue:
                "15-20% increase in content engagement; higher bets-per-session through relevant content surfacing.",
              typicalDataEntities: [
                "Content Catalog",
                "Bettor Preferences",
                "Geographic Data",
                "Engagement Metrics",
              ],
              typicalSourceSystems: [
                "Content Management System",
                "Betting Platform / PAM",
                "Racing Data Feed",
                "Sports Data Provider",
              ],
            },
            {
              name: "Loyalty Programs",
              description:
                "Tier rules, accrual/redemption optimisation, and proactive VIP relationship management -- with bespoke limits, personalised event experiences, and early detection of dissatisfaction or competitive switching signals for the high-value cohort.",
              businessValue:
                "Top 5% of bettors typically generate 40-60% of revenue -- protecting this cohort is existential.",
              typicalDataEntities: [
                "Loyalty Tier Assignments",
                "Accrual/Redemption Logs",
                "Relationship Manager Notes",
                "High-Value Bet Activity",
                "Event Attendance",
              ],
              typicalSourceSystems: [
                "Loyalty Platform",
                "CRM",
                "Betting Platform / PAM",
                "VIP Management System",
              ],
            },
          ],
          kpis: [
            "Active bettors",
            "Bettor LTV",
            "Retention cohort decay",
            "Promotional ROI",
            "Onboarding-to-first-bet conversion rate",
          ],
          personas: [
            "Chief Marketing Officer",
            "VP Retention",
            "Head of CRM",
            "VIP Relationship Manager",
          ],
        },
        {
          name: "Protect the Bettor",
          useCases: [
            {
              name: "Responsible Gaming",
              description:
                "Detect markers of harm and trigger interventions, limits, and cooling-off periods using ML on behavioural markers (escalating stakes, chasing losses, extended sessions, frequent deposit top-ups, erratic bet patterns) before harm materialises.",
              businessValue:
                "Reduces regulatory risk and bettor harm; operators report 20-30% reduction in harm-related complaints after deploying early-warning systems.",
              typicalDataEntities: [
                "Behavioural Markers",
                "Session Duration Data",
                "Deposit Frequency",
                "Stake Escalation Patterns",
                "Intervention Triggers",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "Responsible Gambling Platform",
                "Analytics Platform",
                "Customer Service Platform",
              ],
            },
            {
              name: "Detect Fraud During Bet",
              description:
                "Stop account/device abuse and arbitrage during bet placement using device-fingerprint, velocity, and behavioural anomaly models running on the bet-placement event stream.",
              businessValue:
                "Reduced fraud loss bps; protected margin against arbing rings.",
              typicalDataEntities: [
                "Bet Events",
                "Device Fingerprints",
                "Bettor Risk Scores",
                "Anomaly Flags",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "Fraud Detection Platform",
                "Device Intelligence",
              ],
            },
            {
              name: "Detect Fraud At Withdrawal",
              description:
                "Catch mule accounts, bonus abuse, and AML signals before payout using a combination of identity, transaction-pattern, and graph models.",
              businessValue:
                "Higher payment-integrity savings; lower bonus-abuse cost.",
              typicalDataEntities: [
                "Withdrawal Requests",
                "KYC Records",
                "Transaction Patterns",
                "Mule Network Indicators",
              ],
              typicalSourceSystems: [
                "Payment Gateway",
                "AML/CTF Platform",
                "Fraud Detection Platform",
              ],
            },
            {
              name: "Toxicity Mitigation",
              description:
                "Classify and act on abusive chat, voice, and text in social/community surfaces using moderation models with human-in-the-loop review.",
              businessValue:
                "Lower toxic-content exposure; better community health metrics.",
              typicalDataEntities: [
                "Chat Logs",
                "Moderation Decisions",
                "Toxicity Scores",
              ],
              typicalSourceSystems: [
                "Community Platform",
                "Moderation Tooling",
              ],
            },
            {
              name: "Churn Prediction",
              description:
                "Predict lapse risk using declining login frequency, reduced stake sizes, dormant account signals, and competitive switching indicators, then trigger automated win-back campaigns calibrated to lifetime value and responsible-gambling profile.",
              businessValue:
                "15-25% reduction in high-value bettor attrition through proactive intervention.",
              typicalDataEntities: [
                "Bettor Activity Logs",
                "Bet History",
                "Churn Risk Scores",
                "Win-Back Campaign Results",
                "Dormancy Indicators",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "CRM",
                "Marketing Platform",
                "Analytics Platform",
              ],
            },
          ],
          kpis: [
            "Active bettors",
            "Bettor LTV",
            "At-risk detection rate (%)",
            "Self-exclusion violations",
            "Fraud loss bps",
          ],
          personas: [
            "VP Player Protection",
            "Head of Responsible Gaming",
            "Head of Fraud",
          ],
        },
      ],
    },
    {
      name: "Optimize Trading & Revenue",
      whyChange:
        "Wagering margins are under sustained pressure from sophisticated bettors using odds-comparison tools, competitors offering best-price guarantees, and the rise of high-volume, low-margin multi-leg products. Trading desks must evolve from intuition-based pricing to model-driven, algorithmically-assisted operations -- managing in-play liability in real time, pricing complex multi-leg and same-game-multi products accurately, and optimising revenue mix across racing, sport, and novelty markets. Build-the-bet, dynamic pricing, and personalised offers drive handle and gross gaming revenue.",
      priorities: [
        {
          name: "Pricing & Market Making",
          useCases: [
            {
              name: "Dynamic Odds Compilation",
              description:
                "Use ML models incorporating form data, historical results, market movements, and competitor pricing to compile opening odds and dynamically adjust prices as money flows in -- balancing margin targets against market competitiveness.",
              businessValue:
                "1-3% improvement in theoretical margin through more accurate initial pricing and faster market response.",
              typicalDataEntities: [
                "Form & Statistics Data",
                "Market Movements",
                "Competitor Odds",
                "Liability Positions",
                "Historical Results",
              ],
              typicalSourceSystems: [
                "Odds Feed Provider",
                "Racing Data Feed",
                "Betting Platform / PAM",
                "Competitor Scraping Service",
                "Sports Data Provider",
              ],
            },
            {
              name: "In-Play Automated Trading",
              description:
                "Automate in-play odds adjustments using real-time match state (score, time, momentum) and streaming liability data, enabling sub-second price updates and automated suspension triggers for key events.",
              businessValue:
                "50-70% reduction in in-play trader manual interventions; improved margin capture during fast-moving events.",
              typicalDataEntities: [
                "Live Match State",
                "In-Play Liability",
                "Price Adjustment Rules",
                "Suspension Triggers",
                "Streaming Odds",
              ],
              typicalSourceSystems: [
                "Sports Data Provider",
                "Betting Platform / PAM",
                "In-Play Trading Engine",
                "Odds Feed Provider",
              ],
            },
            {
              name: "Multi-Leg & Same-Game-Multi Pricing",
              description:
                "Price correlated multi-leg and same-game-multi bets using correlation matrices derived from historical co-occurrence data, adjusting for leg dependencies that simple multiplication of individual odds fails to capture.",
              businessValue:
                "Multi-leg products are the fastest-growing bet type -- accurate correlation pricing protects margin on 30-50% of digital turnover.",
              typicalDataEntities: [
                "Correlation Matrices",
                "Leg Dependencies",
                "Historical Co-Occurrence Data",
                "Multi-Bet Configurations",
                "Margin Models",
              ],
              typicalSourceSystems: [
                "Sports Data Provider",
                "Betting Platform / PAM",
                "Trading Engine",
                "Analytics Platform",
              ],
            },
            {
              name: "Margin & Overround Optimization",
              description:
                "Dynamically adjust overround by market type, event profile, and competitive position using elasticity models to find the pricing sweet spot that maximises revenue without driving price-sensitive bettors to competitors.",
              businessValue:
                "0.5-1.5% improvement in achieved margin without material impact on turnover.",
              typicalDataEntities: [
                "Overround Settings",
                "Price Elasticity Models",
                "Competitive Price Index",
                "Market-Level P&L",
                "Turnover by Market",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "Odds Feed Provider",
                "Competitor Scraping Service",
                "Finance System",
              ],
            },
          ],
          kpis: [
            "Theoretical margin vs achieved margin (%)",
            "In-play turnover growth (%)",
            "Multi-leg product margin (%)",
            "Odds competitiveness index",
          ],
          personas: [
            "Head of Trading",
            "Chief Trading Officer",
            "Head of Sports Trading",
            "Head of Racing Trading",
          ],
        },
        {
          name: "Build Bets",
          useCases: [
            {
              name: "Bet Lines Optimization",
              description:
                "Optimise pricing and limits to balance hold vs handle using AI on historical bettor behaviour, market liquidity, and competitor positioning.",
              businessValue:
                "Higher achieved margin without measurable impact on turnover.",
              typicalDataEntities: [
                "Bet History",
                "Liability Positions",
                "Limit Configurations",
                "Margin Targets",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "Trading Engine",
                "Odds Feed Provider",
              ],
            },
            {
              name: "Information Summarization",
              description:
                "Summarise stats, rules, and promotions into bite-size explainers using LLMs grounded in the live form/event corpus -- so bettors get context without leaving the bet slip.",
              businessValue:
                "Higher engagement; reduced cognitive load on complex markets.",
              typicalDataEntities: [
                "Form Data",
                "Event Stats",
                "Promotional Rules",
                "Generated Summaries",
              ],
              typicalSourceSystems: [
                "Sports Data Provider",
                "Content Management System",
                "Betting Platform / PAM",
              ],
            },
            {
              name: "Risk Profiling",
              description:
                "Assess bettor and market risk to set limits and monitoring policies using ML on bet pattern, deposit, and outcome data.",
              businessValue:
                "Lower fraud / arbing loss; better-allocated trader attention.",
              typicalDataEntities: [
                "Bettor Risk Scores",
                "Market Risk Profiles",
                "Limit Configurations",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "Trading Engine",
                "Fraud Detection Platform",
              ],
            },
            {
              name: "Rated Play",
              description:
                "Compute ADT/TTD/handle-per-hour equivalents digitally to rate bettors and tier loyalty programs the way casinos rate land-based play.",
              businessValue:
                "Cleaner VIP tiering; better-targeted loyalty offers.",
              typicalDataEntities: [
                "Bet Volumes",
                "Time-On-Site",
                "Handle Per Hour",
                "Rated Play Tier",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "Loyalty Platform",
              ],
            },
            {
              name: "Game Data",
              description:
                "Curate complete, reliable game and event data for products -- ingesting and reconciling multiple feed providers with quality scoring and provenance.",
              businessValue:
                "Foundation for trading, content, and live products; reduced incident rate from feed errors.",
              typicalDataEntities: [
                "Event Data",
                "Game Stats",
                "Feed Provenance",
                "Quality Scores",
              ],
              typicalSourceSystems: [
                "Sports Data Provider",
                "Racing Data Feed",
                "Data Quality Platform",
              ],
            },
            {
              name: "Optimize Hold and Yield",
              description:
                "Balance promos, pricing, and limits to target hold percentages while maintaining bettor experience and market competitiveness.",
              businessValue:
                "Higher net wagering revenue per active bettor; defended hold target during peak events.",
              typicalDataEntities: [
                "Hold Targets",
                "Promotional Allocation",
                "Pricing Strategy",
                "Limit Configurations",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "Trading Engine",
                "Finance System",
              ],
            },
          ],
          kpis: [
            "Handle",
            "Gross gaming revenue",
            "In-play bet share",
            "Hold %",
          ],
          personas: [
            "Head of Trading",
            "VP Sportsbook Product",
            "Head of Pricing",
          ],
        },
        {
          name: "Offers",
          useCases: [
            {
              name: "Real Time In Game Lines",
              description:
                "Streamed pricing based on live state -- score, time, momentum, and liability -- delivered as sub-second updates on the bet slip.",
              businessValue:
                "Higher in-play turnover share; protected margin against fast-moving market events.",
              typicalDataEntities: [
                "Live Match State",
                "Streaming Odds",
                "In-Play Liability",
              ],
              typicalSourceSystems: [
                "Sports Data Provider",
                "In-Play Trading Engine",
                "Betting Platform / PAM",
              ],
            },
            {
              name: "Bet Carousels",
              description:
                "Rank and order markets on home and league pages using personalisation models that incorporate bettor preferences, current event state, and content recommendations.",
              businessValue:
                "Higher click-through and conversion on featured markets.",
              typicalDataEntities: [
                "Bettor Preferences",
                "Market Inventory",
                "Click Logs",
                "Conversion Outcomes",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "Recommendation Engine",
                "Content Management System",
              ],
            },
            {
              name: "Suggested Promotions",
              description:
                "Next-best-offer for engagement and margin -- choosing among bonus bets, boosted odds, refunds, and deposit matches based on bettor segment, promotional inventory, and incremental-revenue models.",
              businessValue:
                "Higher promotional ROI; reduced wasted bonus spend on bettors who would have wagered anyway.",
              typicalDataEntities: [
                "Promotion Catalog",
                "Bettor Segments",
                "Incremental Revenue Models",
              ],
              typicalSourceSystems: [
                "CRM",
                "Marketing Platform",
                "Betting Platform / PAM",
              ],
            },
            {
              name: "Informed Bets",
              description:
                "Provide context (injuries, form, weather, head-to-head) and explain lines so bettors place better-informed wagers and engage longer per session.",
              businessValue:
                "Higher engagement; cleaner story for responsible-gaming framing of the product.",
              typicalDataEntities: [
                "Form Data",
                "Injury Reports",
                "Weather Data",
                "Generated Explanations",
              ],
              typicalSourceSystems: [
                "Sports Data Provider",
                "Content Management System",
                "Betting Platform / PAM",
              ],
            },
            {
              name: "Understanding Lines",
              description:
                "Explain pricing, hold, and vig to bettors simply -- using LLM-generated explainers grounded in the actual market and trading rules.",
              businessValue:
                "Improved bettor education; reduced complaint volume on perceived pricing fairness.",
              typicalDataEntities: [
                "Pricing Rules",
                "Hold Calculations",
                "Generated Explanations",
              ],
              typicalSourceSystems: [
                "Trading Engine",
                "Content Management System",
              ],
            },
            {
              name: "Parlay Optimization",
              description:
                "Construct and prioritise parlay offers to maximise margin and bettor experience -- using correlation-aware suggestion models that pre-build SGM/parlay slips for hot events.",
              businessValue:
                "Higher parlay handle share; protected margin on the highest-margin product line.",
              typicalDataEntities: [
                "Correlation Matrices",
                "Parlay Inventory",
                "Bet Slip Construction Logs",
              ],
              typicalSourceSystems: [
                "Trading Engine",
                "Betting Platform / PAM",
                "Sports Data Provider",
              ],
            },
          ],
          kpis: [
            "Handle",
            "Gross gaming revenue",
            "In-play bet share",
            "Hold %",
          ],
          personas: [
            "Head of Trading",
            "VP Sportsbook Product",
            "Head of Pricing",
          ],
        },
        {
          name: "Revenue & Yield Management",
          useCases: [
            {
              name: "Yield per Customer Analytics",
              description:
                "Track net wagering revenue, turnover, and margin at the individual bettor level across all products and channels, enabling yield-based segmentation and identification of unprofitable cohorts.",
              businessValue:
                "5-10% improvement in net revenue per active bettor through yield-informed promotional allocation.",
              typicalDataEntities: [
                "Bettor-Level P&L",
                "Turnover by Product",
                "Promotional Costs per Bettor",
                "Yield Segments",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "Finance System",
                "CRM",
                "Analytics Platform",
              ],
            },
            {
              name: "Product Mix Optimization",
              description:
                "Analyse revenue, margin, and growth trends across the product portfolio (sport, racing, multis, in-play, casino, novelties) to inform investment, promotional weighting, and content scheduling.",
              businessValue:
                "Shift promotional spend toward highest-margin, highest-growth product categories.",
              typicalDataEntities: [
                "Product Taxonomy",
                "Revenue by Product",
                "Margin by Product",
                "Growth Trends",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "Finance System",
                "Analytics Platform",
              ],
            },
            {
              name: "Cash-Out Pricing & Liability Management",
              description:
                "Price cash-out offers in real time using current odds, liability exposure, and bettor behaviour models, balancing margin captured on early settlement against bettor-experience benefit.",
              businessValue:
                "Optimised cash-out pricing can improve cash-out margin by 2-5% while maintaining usage rates.",
              typicalDataEntities: [
                "Open Bet Positions",
                "Current Odds",
                "Cash-Out Propensity Scores",
                "Liability Exposure",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "Trading Engine",
                "Odds Feed Provider",
              ],
            },
            {
              name: "Bonus Bet ROI & Wagering Turnover Analytics",
              description:
                "Track the full lifecycle of bonus bets and promotional credits -- issuance, wagering turnover, conversion, incremental revenue -- to identify promotional structures that drive sustainable behaviour rather than one-time arbitrage.",
              businessValue:
                "Bonus bets are 5-15% of operator costs; rigorous ROI tracking can reclaim 10-20% of wasted spend.",
              typicalDataEntities: [
                "Bonus Bet Issuance",
                "Turnover Requirements",
                "Conversion Events",
                "Incremental Revenue",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "Finance System",
                "CRM",
                "Marketing Platform",
              ],
            },
          ],
          kpis: [
            "Net wagering revenue per active bettor",
            "Cash-out utilisation rate (%)",
            "Bonus bet ROI",
            "Wagering turnover growth (%)",
          ],
          personas: [
            "Chief Commercial Officer",
            "Head of Revenue",
            "VP Trading",
          ],
        },
      ],
    },
    {
      name: "Lead in Responsible Gambling & Compliance",
      whyChange:
        "Regulators (ACMA, AUSTRAC, UKGC, US state gaming commissions, MGA) are progressively tightening harm-minimisation obligations -- mandatory pre-commitment tools, deposit limits, activity statements, and advertising restrictions are now law or imminent in most major markets. AML/CTF requirements demand real-time transaction monitoring and automated suspicious-matter reporting. Non-compliance carries licence-threatening penalties (AUSTRAC enforcement actions have exceeded $1B) and severe reputational damage. Operators who embed responsible gambling into their data and analytics strategy turn a compliance burden into a competitive and social-licence advantage.",
      priorities: [
        {
          name: "Harm Minimisation & Player Protection",
          useCases: [
            {
              name: "Early Intervention & At-Risk Detection",
              description:
                "Use ML models to detect behavioural markers of gambling harm -- escalating stakes, chasing losses, extended session durations, frequent deposit top-ups, and erratic bet patterns -- triggering automated interventions (pop-up messages, cooling-off suggestions, staff alerts) before harm materialises.",
              businessValue:
                "20-30% reduction in harm-related complaints after deploying early-warning systems; reduced regulatory and reputational risk.",
              typicalDataEntities: [
                "Behavioural Markers",
                "Session Duration Data",
                "Deposit Frequency",
                "Stake Escalation Patterns",
                "Intervention Triggers",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "Responsible Gambling Platform",
                "Analytics Platform",
                "Customer Service Platform",
              ],
            },
            {
              name: "Affordability & Spend Monitoring",
              description:
                "Monitor individual bettor spend against configurable thresholds (self-set limits, operator-set limits, regulatory thresholds), integrating deposit data, net losses over time, and -- where available -- affordability signals to flag bettors who may be wagering beyond their means.",
              businessValue:
                "Proactive affordability monitoring is a regulatory expectation in multiple jurisdictions; early adoption reduces enforcement risk.",
              typicalDataEntities: [
                "Deposit History",
                "Net Loss Tracking",
                "Limit Configurations",
                "Affordability Indicators",
                "Threshold Breach Events",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "Payment Gateway",
                "Responsible Gambling Platform",
                "Finance System",
              ],
            },
            {
              name: "Self-Exclusion & Limit Management Analytics",
              description:
                "Track the effectiveness of self-exclusion programmes and voluntary limit-setting -- adoption rates, limit types, breach attempts, reinstatement patterns -- to continuously improve the design of player protection tools and demonstrate regulatory compliance.",
              businessValue:
                "Evidence-based refinement of harm-minimisation tools; supports regulatory submissions and licence renewals.",
              typicalDataEntities: [
                "Self-Exclusion Records",
                "Voluntary Limits",
                "Breach Attempts",
                "Reinstatement Requests",
                "Programme Effectiveness Metrics",
              ],
              typicalSourceSystems: [
                "Responsible Gambling Platform",
                "Betting Platform / PAM",
                "National Self-Exclusion Register",
                "CRM",
              ],
            },
            {
              name: "Responsible Gambling Reporting & Dashboards",
              description:
                "Provide executive and regulatory dashboards showing key responsible-gambling metrics -- harm indicator prevalence, intervention volumes, self-exclusion trends, limit adoption rates, complaint analysis -- enabling data-driven governance and transparent reporting to regulators and boards.",
              businessValue:
                "Board-level visibility into responsible-gambling posture; streamlined regulatory reporting.",
              typicalDataEntities: [
                "RG Metrics Summary",
                "Intervention Volumes",
                "Self-Exclusion Trends",
                "Complaint Categories",
                "Regulatory Submissions",
              ],
              typicalSourceSystems: [
                "Responsible Gambling Platform",
                "Betting Platform / PAM",
                "Customer Service Platform",
                "Analytics Platform",
              ],
            },
          ],
          kpis: [
            "At-risk detection rate (%)",
            "Time from detection to intervention (minutes)",
            "Self-exclusion adoption rate (%)",
            "Voluntary limit-setting rate (%)",
          ],
          personas: [
            "Head of Responsible Gambling",
            "Chief Risk Officer",
            "VP Compliance",
            "General Counsel",
          ],
        },
        {
          name: "Regulatory & AML/CTF Compliance",
          useCases: [
            {
              name: "Data and PII Governance",
              description:
                "Classify and tag PII, enforce policies and subject rights, and maintain auditable lineage for every PII data flow across the betting, marketing, and customer-service estate.",
              businessValue:
                "Reduced regulatory exposure under GDPR/CCPA/CPRA; faster DSR fulfilment; demonstrable AI governance for regulators.",
              typicalDataEntities: [
                "Data Classifications",
                "Consent Records",
                "DSR Tickets",
                "Lineage Records",
              ],
              typicalSourceSystems: [
                "Unity Catalog",
                "Consent Management Platform",
                "GRC Platform",
              ],
            },
            {
              name: "Financial Reporting",
              description:
                "Auditable gaming P&L, tax, and regulatory reports automated from operational data pipelines -- including wagering tax, point-of-consumption tax, and licence-condition reporting -- with audit trails and reconciliation checks.",
              businessValue:
                "60-80% reduction in manual regulatory reporting effort; improved accuracy and timeliness.",
              typicalDataEntities: [
                "Tax Calculations",
                "Wagering Revenue by Jurisdiction",
                "Regulatory Return Templates",
                "Audit Trails",
                "Reconciliation Records",
              ],
              typicalSourceSystems: [
                "Finance System",
                "Betting Platform / PAM",
                "Tax Engine",
                "State Regulatory Portals",
              ],
            },
            {
              name: "Fraud Reporting",
              description:
                "Generate SAR/CTR and case packages with auditable workflow for AUSTRAC/FinCEN/equivalent submissions -- automated from transaction-monitoring outputs.",
              businessValue:
                "Cleaner regulator submissions; lower per-case investigator cost.",
              typicalDataEntities: [
                "Suspicious Activity Indicators",
                "SMR Reports",
                "Bettor Risk Ratings",
                "Case Records",
              ],
              typicalSourceSystems: [
                "AML/CTF Platform",
                "Payment Gateway",
                "Betting Platform / PAM",
                "AUSTRAC Reporting",
              ],
            },
            {
              name: "Cyber Security DASL/Behavior",
              description:
                "Detect anomalous access and risky user/system behaviours via a security data lake combining identity, endpoint, and network telemetry with ML-based anomaly scoring.",
              businessValue:
                "Faster threat detection; lower MTTR on identity-based attacks.",
              typicalDataEntities: [
                "Identity Events",
                "Endpoint Logs",
                "Network Logs",
                "Anomaly Scores",
              ],
              typicalSourceSystems: [
                "SIEM",
                "Identity Provider",
                "EDR",
                "Security Data Lake",
              ],
            },
            {
              name: "DSPM Integration",
              description:
                "Classify sensitive data, monitor posture, and auto-remediate misconfigurations across the gaming data estate using a Data Security Posture Management platform integrated with Unity Catalog.",
              businessValue:
                "Lower PII exposure risk; cleaner audit posture; automated remediation of high-risk findings.",
              typicalDataEntities: [
                "Data Classifications",
                "Posture Findings",
                "Remediation Logs",
              ],
              typicalSourceSystems: [
                "DSPM Platform",
                "Unity Catalog",
                "Cloud Provider",
              ],
            },
            {
              name: "Banned Players",
              description:
                "Enforce bans and self-exclusions across systems (digital, retail, partner networks) using a unified player-ban registry with sub-second lookup at bet-placement time.",
              businessValue:
                "Reduced compliance breach incidents; cleaner regulator posture on self-exclusion enforcement.",
              typicalDataEntities: [
                "Ban Registry",
                "Self-Exclusion Records",
                "Identity Graph",
                "Enforcement Logs",
              ],
              typicalSourceSystems: [
                "Responsible Gambling Platform",
                "Betting Platform / PAM",
                "Identity Verification Provider",
              ],
            },
            {
              name: "AML Transaction Monitoring & Suspicious Activity Detection",
              description:
                "Apply rules-based and ML-driven transaction monitoring to detect suspicious patterns -- structuring, rapid deposit-and-withdrawal cycles, unusually large transactions, and third-party funding -- generating automated SMRs for regulators.",
              businessValue:
                "Reduces AML/CTF compliance risk; AUSTRAC enforcement actions have exceeded $1B -- automated monitoring is essential.",
              typicalDataEntities: [
                "Transaction Records",
                "Suspicious Activity Indicators",
                "SMR Reports",
                "Bettor Risk Ratings",
                "Threshold Rules",
              ],
              typicalSourceSystems: [
                "Payment Gateway",
                "Betting Platform / PAM",
                "AML/CTF Platform",
                "Identity Verification Provider",
                "AUSTRAC Reporting",
              ],
            },
            {
              name: "KYC & Identity Verification Analytics",
              description:
                "Track KYC completion rates, verification failure reasons, document-fraud attempts, and time-to-verify across the bettor onboarding pipeline -- identifying bottlenecks and fraud vectors while ensuring 100% compliance with identity-verification obligations.",
              businessValue:
                "Faster onboarding (reduced drop-off); improved fraud detection at the point of account creation.",
              typicalDataEntities: [
                "KYC Records",
                "Verification Status",
                "Document Fraud Flags",
                "Onboarding Funnel Metrics",
                "Verification Timelines",
              ],
              typicalSourceSystems: [
                "Identity Verification Provider",
                "Betting Platform / PAM",
                "Document Verification Service",
                "CRM",
              ],
            },
            {
              name: "Advertising Compliance Monitoring",
              description:
                "Monitor advertising and promotional content across channels (TV, digital, social, venue signage) for compliance with advertising codes -- inducement restrictions, responsible-gambling messaging, excluded-person targeting, time-of-day restrictions -- using automated content scanning and audience analytics.",
              businessValue:
                "Reduces risk of regulator enforcement action and reputational damage from advertising-code breaches.",
              typicalDataEntities: [
                "Ad Campaign Records",
                "Compliance Rules",
                "Channel Restrictions",
                "Audience Targeting Data",
                "Breach Incident Logs",
              ],
              typicalSourceSystems: [
                "Marketing Platform",
                "Ad Platform",
                "Compliance System",
                "CRM",
                "Social Media Monitoring",
              ],
            },
          ],
          kpis: [
            "Fraud loss bps",
            "AML alert turnaround",
            "SMR submission timeliness (%)",
            "KYC verification pass rate (%)",
            "Advertising compliance breach count",
          ],
          personas: [
            "Chief Compliance Officer",
            "Head of AML/CTF",
            "VP Regulatory Affairs",
            "Money Laundering Reporting Officer",
          ],
        },
      ],
    },
    {
      name: "Transform the Omnichannel Experience",
      whyChange:
        "Bettors expect seamless transitions between digital app, mobile web, desktop, retail outlets, and call-centre channels. Live streaming, in-play betting, social features, and instant cash-out are now table stakes. With 70%+ of wagering turnover shifting to digital, operators must deliver friction-free, engaging digital experiences while maintaining relevant retail presence for the significant cohort that still values the social and venue experience. Those who master the omnichannel journey will capture disproportionate share.",
      priorities: [
        {
          name: "Digital & In-Play Experience",
          useCases: [
            {
              name: "In-Play Betting Performance Analytics",
              description:
                "Monitor in-play platform performance in real time -- bet placement latency, odds refresh rates, suspension accuracy, and error rates by sport and market type -- to identify and resolve experience issues before they impact turnover.",
              businessValue:
                "Every 100ms of bet placement latency costs measurable turnover -- sub-second performance is a competitive differentiator.",
              typicalDataEntities: [
                "Bet Placement Latency",
                "Odds Refresh Metrics",
                "Suspension Events",
                "Error Rates",
                "Platform Health Metrics",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "APM",
                "In-Play Trading Engine",
                "CDN",
                "Analytics Platform",
              ],
            },
            {
              name: "Live Streaming Engagement Analytics",
              description:
                "Correlate live-streaming viewership with betting activity -- concurrent viewers, stream-to-bet conversion, sport/race preference by stream, streaming-quality metrics -- to optimise content investment and streaming-integrated betting features.",
              businessValue:
                "Bettors who stream and bet simultaneously have 2-3x higher session value -- understanding this link drives content ROI.",
              typicalDataEntities: [
                "Stream Viewership",
                "Concurrent Viewer Counts",
                "Stream-to-Bet Events",
                "Quality Metrics",
                "Content Costs",
              ],
              typicalSourceSystems: [
                "Live Streaming Platform",
                "Betting Platform / PAM",
                "CDN",
                "Analytics Platform",
              ],
            },
            {
              name: "App Performance & UX Optimization",
              description:
                "Analyse crash rates, load times, UX heatmaps, navigation flows, and A/B test results to continuously improve the digital betting experience and reduce friction in the bet placement journey.",
              businessValue:
                "10-15% improvement in bet placement completion rate through UX optimization.",
              typicalDataEntities: [
                "App Crash Reports",
                "Performance Metrics",
                "UX Heatmaps",
                "A/B Test Results",
                "Navigation Flows",
              ],
              typicalSourceSystems: [
                "APM",
                "Analytics Platform",
                "A/B Testing Platform",
                "Betting Platform / PAM",
              ],
            },
            {
              name: "Bet Placement Funnel Conversion",
              description:
                "Track the full bet placement funnel -- event browsing, market selection, bet slip construction, stake entry, confirmation -- identifying drop-off points and optimising each step to maximise conversion.",
              businessValue:
                "5-10% increase in bet placement conversion drives material incremental revenue at zero acquisition cost.",
              typicalDataEntities: [
                "Funnel Step Events",
                "Drop-Off Points",
                "Bet Slip Abandonment",
                "Stake Distribution",
                "Conversion Rates",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "Analytics Platform",
                "A/B Testing Platform",
              ],
            },
          ],
          kpis: [
            "In-play bet placement latency (ms)",
            "Stream-to-bet conversion rate (%)",
            "App crash rate (%)",
            "Bet placement funnel conversion (%)",
          ],
          personas: [
            "Head of Digital Product",
            "VP Customer Experience",
            "Head of Engineering",
            "Chief Technology Officer",
          ],
        },
        {
          name: "Retail & Venue Integration",
          useCases: [
            {
              name: "Retail-to-Digital Migration Analytics",
              description:
                "Track and encourage migration of retail-only bettors to digital channels -- measuring migration rates, dual-channel adoption, and the revenue uplift from bettors who use both -- while ensuring the transition does not cannibalise venue-operator relationships.",
              businessValue:
                "Dual-channel bettors typically generate 2-4x the revenue of single-channel bettors.",
              typicalDataEntities: [
                "Channel Migration Events",
                "Dual-Channel Bettor IDs",
                "Revenue by Channel",
                "Venue Operator Agreements",
                "Migration Campaign Results",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "Retail Terminal System",
                "CRM",
                "Analytics Platform",
                "Venue Management System",
              ],
            },
            {
              name: "Venue Performance & Terminal Optimization",
              description:
                "Analyse performance across the retail venue network -- turnover per terminal, peak usage patterns, product mix by venue, terminal uptime -- to optimise terminal deployment, venue selection, and retail product offering.",
              businessValue:
                "10-15% improvement in revenue per terminal through data-driven placement and product optimization.",
              typicalDataEntities: [
                "Terminal Transactions",
                "Venue Profiles",
                "Peak Usage Patterns",
                "Terminal Uptime",
                "Venue Revenue",
              ],
              typicalSourceSystems: [
                "Retail Terminal System",
                "Venue Management System",
                "Betting Platform / PAM",
                "Finance System",
              ],
            },
            {
              name: "Omnichannel Journey Tracking",
              description:
                "Map the complete bettor journey across retail, app, web, and call-centre touchpoints -- understanding how bettors discover events, research form, place bets, and collect winnings across channels -- to identify journey friction and optimise the cross-channel experience.",
              businessValue:
                "20-30% reduction in journey friction points; improved bettor satisfaction scores.",
              typicalDataEntities: [
                "Journey Events",
                "Touchpoint Sequence",
                "Channel Transitions",
                "Friction Points",
                "Satisfaction Scores",
              ],
              typicalSourceSystems: [
                "Betting Platform / PAM",
                "Retail Terminal System",
                "Analytics Platform",
                "CRM",
                "Customer Service Platform",
              ],
            },
            {
              name: "Race & Sports Content Personalisation",
              description:
                "Personalise the content experience -- featured races, promoted events, form guides, tips, expert content -- based on bettor's sport/race preferences, betting history, and geographic location (local racing, home-team sport) to increase engagement and bet frequency.",
              businessValue:
                "15-20% increase in content engagement; higher bets-per-session through relevant content surfacing.",
              typicalDataEntities: [
                "Content Catalog",
                "Bettor Preferences",
                "Geographic Data",
                "Form & Tips Content",
                "Engagement Metrics",
              ],
              typicalSourceSystems: [
                "Content Management System",
                "Betting Platform / PAM",
                "Racing Data Feed",
                "Sports Data Provider",
                "CRM",
              ],
            },
          ],
          kpis: [
            "Retail-to-digital migration rate (%)",
            "Dual-channel customer revenue uplift",
            "Revenue per terminal",
            "Omnichannel NPS",
          ],
          personas: [
            "Head of Retail Operations",
            "VP Omnichannel",
            "Head of Content",
          ],
        },
      ],
    },
    {
      name: "Drive Operational Excellence",
      whyChange:
        "Wagering platforms must handle massive, predictable spikes -- Melbourne Cup, Super Bowl, State of Origin, AFL/NRL Grand Finals -- where transaction volumes can surge 10-50x above baseline without any degradation in bet placement speed or odds accuracy. Legacy platforms inherited from acquisitions create data silos that prevent unified analytics. Modernising the data estate, democratising analytics access, and optimising infrastructure and operational costs are foundational to competing effectively in a margin-compressed industry.",
      priorities: [
        {
          name: "Platform & Data Modernisation",
          useCases: [
            {
              name: "Platform Scalability & Peak-Event Analytics",
              description:
                "Monitor and forecast platform capacity across peak wagering events -- modelling expected transaction volumes, pre-scaling infrastructure, and analysing real-time platform health to ensure zero-downtime performance on the biggest betting days of the year.",
              businessValue:
                "A single minute of downtime during a peak event can cost $500K+ in lost turnover -- predictive scaling prevents this.",
              typicalDataEntities: [
                "Transaction Volumes",
                "Infrastructure Metrics",
                "Capacity Forecasts",
                "Event Calendar",
                "Incident History",
              ],
              typicalSourceSystems: [
                "APM",
                "Cloud Platform",
                "Betting Platform / PAM",
                "Event Data Provider",
              ],
            },
            {
              name: "Data Estate Consolidation & Quality",
              description:
                "Consolidate fragmented data estates from acquired brands and legacy systems into a unified data lakehouse, implementing data quality rules, lineage tracking, and master data management to create a single source of truth.",
              businessValue:
                "30-50% reduction in data engineering overhead; trusted data foundation for all analytics and AI use cases.",
              typicalDataEntities: [
                "Data Quality Scores",
                "Lineage Maps",
                "Master Data Entities",
                "Schema Registries",
              ],
              typicalSourceSystems: [
                "Legacy Betting Platforms",
                "Data Warehouse",
                "ETL/ELT Pipelines",
                "Master Data Management",
              ],
            },
            {
              name: "Self-Service Analytics & Data Democratization",
              description:
                "Enable non-technical stakeholders -- trading, marketing, compliance, and commercial teams -- to explore data and build insights through self-service BI, natural-language query, and curated data products, reducing dependency on centralised data teams.",
              businessValue:
                "60-70% reduction in ad-hoc data request backlog; faster decision-making across the business.",
              typicalDataEntities: [
                "Curated Data Products",
                "Semantic Models",
                "User Query Logs",
                "Dashboard Catalog",
              ],
              typicalSourceSystems: [
                "BI Platform",
                "Data Catalog",
                "Betting Platform / PAM",
                "Analytics Platform",
              ],
            },
            {
              name: "Real-Time Data Pipeline Monitoring",
              description:
                "Monitor health, latency, and throughput of real-time data pipelines that feed trading, responsible-gambling, and bettor-facing systems -- detecting delays, schema changes, and data-quality anomalies before they impact downstream consumers.",
              businessValue:
                "Prevents cascade failures where stale data leads to incorrect odds, missed RG interventions, or inaccurate dashboards.",
              typicalDataEntities: [
                "Pipeline Health Metrics",
                "Latency Measurements",
                "Schema Change Events",
                "Data Quality Anomalies",
              ],
              typicalSourceSystems: [
                "Streaming Platform",
                "Data Pipeline Orchestrator",
                "Monitoring Platform",
                "Data Catalog",
              ],
            },
          ],
          kpis: [
            "Platform uptime during peak events (%)",
            "Data quality score (%)",
            "Pipeline latency (p95 ms)",
            "Self-service analytics adoption rate (%)",
          ],
          personas: [
            "Chief Technology Officer",
            "Head of Data Engineering",
            "VP Platform",
            "Head of Data Governance",
          ],
        },
        {
          name: "Financial Performance",
          useCases: [
            {
              name: "Customer Lifetime Value & Unit Economics",
              description:
                "Build CLV models incorporating acquisition cost, promotional spend, wagering turnover, margin contribution, servicing cost, and expected tenure -- understanding true unit economics by cohort, channel, and product mix.",
              businessValue:
                "CLV-informed acquisition spend prevents the common trap of buying bettors at negative ROI.",
              typicalDataEntities: [
                "Acquisition Costs",
                "Promotional Spend",
                "Margin Contribution",
                "Servicing Costs",
                "Tenure Predictions",
              ],
              typicalSourceSystems: [
                "Finance System",
                "Betting Platform / PAM",
                "CRM",
                "Marketing Platform",
              ],
            },
            {
              name: "Marketing Attribution & Channel ROI",
              description:
                "Implement multi-touch attribution across channels -- TV, digital advertising, affiliate, social, CRM, retail -- to measure the true cost per acquisition and incremental revenue contribution of each channel for evidence-based budget allocation.",
              businessValue:
                "15-25% improvement in marketing spend efficiency through evidence-based channel allocation.",
              typicalDataEntities: [
                "Marketing Touchpoints",
                "Attribution Models",
                "Channel Costs",
                "Conversion Events",
                "Incremental Revenue",
              ],
              typicalSourceSystems: [
                "Marketing Platform",
                "Ad Platform",
                "Analytics Platform",
                "CRM",
                "Finance System",
              ],
            },
            {
              name: "Operational Cost Benchmarking",
              description:
                "Benchmark operational costs -- technology, customer service, compliance, venue operations, content, payment processing -- against industry peers and internal targets, identifying cost-reduction and efficiency opportunities.",
              businessValue:
                "Identifies 5-15% cost reduction opportunities across operational categories.",
              typicalDataEntities: [
                "Cost Categories",
                "Benchmark Data",
                "Vendor Costs",
                "FTE Allocation",
                "Cost Trends",
              ],
              typicalSourceSystems: [
                "Finance System",
                "ERP",
                "Vendor Management System",
                "HR System",
              ],
            },
            {
              name: "Revenue Forecasting & Scenario Planning",
              description:
                "Build revenue forecasting models incorporating event calendars, seasonal patterns, regulatory changes (advertising bans, tax changes), competitive dynamics, and macro indicators to support budgeting, investor guidance, and strategic planning.",
              businessValue:
                "Improved forecast accuracy supports better capital allocation, investor confidence, and proactive risk management.",
              typicalDataEntities: [
                "Revenue History",
                "Event Calendar",
                "Regulatory Change Log",
                "Economic Indicators",
                "Scenario Definitions",
              ],
              typicalSourceSystems: [
                "Finance System",
                "Betting Platform / PAM",
                "Event Data Provider",
                "Economic Data Service",
              ],
            },
          ],
          kpis: [
            "Customer acquisition cost (CAC)",
            "CLV:CAC ratio",
            "Marketing ROI by channel",
            "Operating cost as % of revenue",
            "Revenue forecast accuracy (%)",
          ],
          personas: [
            "Chief Financial Officer",
            "Head of FP&A",
            "VP Commercial",
            "Head of Investor Relations",
          ],
        },
        {
          name: "Internal Optimization",
          useCases: [
            {
              name: "Internal Data Sharing",
              description:
                "Governed sharing of curated data across teams and domains via Delta Sharing or equivalent, with access policies and lineage transparency for every consumer.",
              businessValue:
                "Faster cross-team analytics; lower data-platform cost through deduplicated access.",
              typicalDataEntities: [
                "Curated Data Products",
                "Access Policies",
                "Lineage Records",
              ],
              typicalSourceSystems: [
                "Data Sharing Platform",
                "Data Catalog",
                "Identity & Access Management",
              ],
            },
            {
              name: "AI Powered Analytics",
              description:
                "Natural-language analytics on KPIs, content, and journeys via Genie/NL2SQL surfaces -- so business stakeholders can ask 'why did handle drop on Saturday?' and get a grounded answer.",
              businessValue:
                "Faster decision cycles; broader analytic coverage of long-tail business questions.",
              typicalDataEntities: [
                "Curated Data Products",
                "Semantic Models",
                "User Query Logs",
              ],
              typicalSourceSystems: [
                "Genie / NL2SQL",
                "BI Platform",
                "Data Catalog",
              ],
            },
            {
              name: "Data Discovery",
              description:
                "Search and catalog datasets, owners, and definitions so analysts and engineers can find trustworthy data without lengthy onboarding or tribal-knowledge dependencies.",
              businessValue:
                "Lower data-onboarding cost for new hires; reduced duplicated effort across teams.",
              typicalDataEntities: [
                "Dataset Inventory",
                "Owner Records",
                "Definitions",
                "Quality Scores",
              ],
              typicalSourceSystems: ["Data Catalog", "Unity Catalog"],
            },
            {
              name: "External Data Sharing",
              description:
                "Privacy-safe partner measurement and activation via clean rooms or governed shares -- enabling regulatory partner reporting, retail-media-style measurement, and joint analytics without exposing raw PII.",
              businessValue:
                "New partner-revenue lines; cleaner regulator submissions; faster partner-onboarding cycles.",
              typicalDataEntities: [
                "Partner Datasets",
                "Aggregate Audiences",
                "Consent Records",
              ],
              typicalSourceSystems: [
                "Clean Room",
                "Data Sharing Platform",
                "Identity Resolution Platform",
              ],
            },
            {
              name: "Empower Your Team",
              description:
                "Copilots for ops, trading, and customer-service teams with governed data access -- summarising customer cases, draft trader notes, and operations dashboards.",
              businessValue:
                "Higher per-FTE productivity; faster issue resolution.",
              typicalDataEntities: [
                "Internal Knowledge Articles",
                "Case Records",
                "Operations Dashboards",
              ],
              typicalSourceSystems: [
                "Knowledge Base",
                "Customer Service Platform",
                "Trading Engine",
              ],
            },
            {
              name: "Staff Optimization",
              description:
                "Forecast and optimise staffing for customer service, trading desks, and VIP teams using ML on call/chat volumes, event calendars, and bettor-base activity patterns.",
              businessValue:
                "Lower staffing cost as % of revenue; better service-level attainment.",
              typicalDataEntities: [
                "Volume Forecasts",
                "Roster History",
                "Skill Availability",
              ],
              typicalSourceSystems: [
                "Workforce Management",
                "Customer Service Platform",
                "HR System",
              ],
            },
            {
              name: "Procurement Analysis",
              description:
                "Optimise vendor spend, renewals, and SLA risk using analytics on contract terms, vendor performance, and total-cost-of-ownership data.",
              businessValue:
                "Lower vendor cost; improved leverage on renewal negotiations.",
              typicalDataEntities: [
                "Contract Terms",
                "Vendor Performance",
                "Spend by Category",
              ],
              typicalSourceSystems: ["Vendor Management System", "ERP"],
            },
          ],
          kpis: [
            "Data request backlog reduction (%)",
            "Data-product reuse rate",
            "Operations cost per active bettor",
          ],
          personas: [
            "Chief Operating Officer",
            "Head of Data Platform",
            "VP Operations",
          ],
        },
      ],
    },
  ],
};
