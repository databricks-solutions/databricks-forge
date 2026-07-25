import type { IndustryOutcome } from "./index";

export const GAMES: IndustryOutcome = {
  id: "games",
  name: "Gaming",
  subVerticals: [
    "Mobile Games",
    "Console & PC Games",
    "MMO & Live Service",
    "Game Publishing",
    "Esports",
  ],
  suggestedDomains: ["Marketing", "Customer Experience", "Operations", "Finance", "Engineering"],
  suggestedPriorities: [
    "Increase Revenue",
    "Enhance Experience",
    "Protect Revenue",
    "Reduce Cost",
    "Drive Innovation",
  ],
  objectives: [
    {
      name: "Player Centric Experience",
      whyChange:
        "The games industry is content-saturated and player acquisition costs have doubled to quadrupled across mobile, console, and PC over the last three years. Apple's ATT and Google's Privacy Sandbox have collapsed precision targeting in ad-driven UA, while live-service economics demand higher D7/D30 retention than ever. Monetization is directly correlated to engaged time-in-game, which makes a unified, real-time understanding of the player -- across studios, titles, and devices -- the only durable competitive moat. Studios that build a player-graph + ML personalization layer convert acquisition spend into LTV; those that don't bleed margin to UA inefficiency.",
      priorities: [
        {
          name: "Know Your Player",
          useCases: [
            {
              name: "Player 360",
              description:
                "Create a unified view of the player spanning multiple games, studios, and ecosystems including play sessions, efficacy, preferences, and purchase propensity.",
              businessValue:
                "Foundational for all engagement, acquisition, and monetization use cases.",
              typicalDataEntities: [
                "Player Profiles",
                "Session Data",
                "Purchase History",
                "Cross-Game Activity",
              ],
              typicalSourceSystems: [
                "Game Telemetry System",
                "Player Database",
                "Payment Platform",
                "Analytics Platform",
              ],
            },
            {
              name: "Churn Mitigation",
              description:
                "Detect early churn signals (declining session length, lapsed daily streaks, drop-off after specific levels or events) and trigger personalized retention interventions -- targeted offers, re-engagement notifications, content recommendations -- calibrated to each player's churn risk and value tier.",
              businessValue:
                "10-25% improvement in D7/D30 retention via early intervention; protected LTV in the high-value cohort that drives most revenue.",
              typicalDataEntities: [
                "Player Session Data",
                "In-Game Events",
                "Engagement Metrics",
                "Churn Risk Scores",
                "Intervention Outcomes",
              ],
              typicalSourceSystems: [
                "Game Telemetry System",
                "Player Database",
                "Analytics Platform",
                "CRM",
                "Push / Notification Service",
              ],
            },
            {
              name: "Player Segmentation",
              description:
                "Use ML-driven clustering across spend behaviour, session patterns, social graph activity, and content preferences to build actionable cohorts (whales, dolphins, minnows; PvE-first vs PvP-first; social vs solo) that drive every downstream personalization, offer, and retention strategy.",
              businessValue:
                "Foundation for personalized monetization and retention; 10-20% lift in offer take-rates from segment-targeted promotions.",
              typicalDataEntities: [
                "Player Clusters",
                "Behavioral Attributes",
                "Engagement Scores",
                "Segment Definitions",
                "Spend Tiers",
              ],
              typicalSourceSystems: [
                "Game Telemetry System",
                "Player Database",
                "Analytics Platform",
                "Marketing Platform",
                "Live Ops Platform",
              ],
            },
            {
              name: "Player Identity Resolution",
              description:
                "Stitch identities across web marketing, ad networks, app stores, console accounts, social logins, and multiple titles into a single player graph -- honouring privacy constraints (ATT, Privacy Sandbox, regional consent) -- so attribution, personalization, and cross-title progression actually work.",
              businessValue:
                "20-30% lift in attributable UA; foundation for cross-title player journeys and franchise-level LTV models.",
              typicalDataEntities: [
                "Identity Graph",
                "Device Identifiers",
                "Cross-Platform Events",
                "Login Records",
                "Consent Records",
              ],
              typicalSourceSystems: [
                "Auth System",
                "Game Telemetry System",
                "Ad Platform",
                "Analytics Platform",
                "App Store APIs",
              ],
            },
          ],
          kpis: [
            "Lifetime Value (LTV)",
            "Retention (D1, D7, D30)",
            "Session length",
            "Daily/Monthly Active Users",
          ],
          personas: ["VP of Data / Analytics", "Studio General Manager", "Head of Player Insights"],
        },
        {
          name: "Grow Your Revenue",
          useCases: [
            {
              name: "Dynamic Offer Optimization",
              description:
                "Use reinforcement-learning and propensity models to personalize offer composition, price points, bundle contents, and surfacing timing per segment -- maximising contribution margin per offer rather than headline conversion alone.",
              businessValue:
                "10-20% lift in ARPPU and offer take-rate vs static merchandising; reduced cannibalisation of full-price purchases.",
              typicalDataEntities: [
                "Offer Catalog",
                "Player Segments",
                "Purchase Propensity Scores",
                "Price Elasticity Models",
                "Bundle Configurations",
              ],
              typicalSourceSystems: [
                "Live Ops Platform",
                "Player Database",
                "Payment Platform",
                "Analytics Platform",
                "Promotion / Offer Engine",
              ],
            },
            {
              name: "Ad Monetization Optimization",
              description:
                "Balance ad revenue and player experience by optimizing rewarded-ad placement, frequency cap, format mix, and waterfall mediation per cohort -- maximising eCPM without driving churn in the spending cohort.",
              businessValue:
                "10-15% lift in ad ARPDAU; better retention in high-spend cohorts via experience-aware ad load.",
              typicalDataEntities: [
                "Ad Impressions",
                "Mediation Waterfall",
                "Player Session Data",
                "Ad Network Performance",
                "Ad Frequency Caps",
              ],
              typicalSourceSystems: [
                "Ad SDK / Mediation Platform",
                "Game Telemetry System",
                "Ad Network APIs",
                "Analytics Platform",
              ],
            },
            {
              name: "User Acquisition Optimization",
              description:
                "Predict day-30 / day-90 / lifetime LTV for each acquisition cohort and channel using survival models on play and spend patterns, then route bid budgets to high-LTV creatives, channels, and audiences -- replacing CPI/CPM optimization with ROAS-driven UA.",
              businessValue:
                "20-30% improvement in marketing ROAS; reduction in CAC payback period.",
              typicalDataEntities: [
                "UA Touchpoints",
                "Channel Costs",
                "Cohort LTV Predictions",
                "Creative Performance",
                "Conversion Events",
              ],
              typicalSourceSystems: [
                "Ad Platform",
                "MMP (Mobile Measurement Partner)",
                "Marketing Platform",
                "Game Telemetry System",
                "Analytics Platform",
              ],
            },
          ],
          kpis: [
            "ARPU/ARPPU",
            "Conversion rate",
            "Customer acquisition cost (CAC)",
            "Marketing ROI",
          ],
          personas: ["Chief Revenue Officer", "Head of Monetization", "Head of User Acquisition"],
        },
      ],
    },
    {
      name: "Build Great Games",
      whyChange:
        "AAA budgets now exceed $200M and live-service titles routinely cost $100M+ with multi-year tail support, so a single failure can destabilize a publisher. Player tastes shift fast, marketplaces are saturated, and platform owners (Apple, Google, console manufacturers) impose increasingly punitive economics. Data-driven decisions throughout the development lifecycle -- pre-production market sizing, prototyping playtests, soft-launch geo tests, and continuous live-ops tuning post-launch -- are no longer a competitive advantage but a survival requirement. Studios that operationalize playtesting, balance analytics, and live-content optimization extend title lifespans 2-3x and convert development bets into franchise revenue streams.",
      priorities: [
        {
          name: "De-Risk Game Development",
          useCases: [
            {
              name: "Playtesting Analytics",
              description:
                "Analyze internal QA, focus group, and soft-launch telemetry to find design issues, difficulty walls, narrative drop-off points, and economy imbalances before global launch -- closing the loop between game-design intent and observed player behaviour.",
              businessValue:
                "Reduced risk of post-launch reputation damage; higher D1/D7 retention on shipped titles; fewer emergency post-launch patches.",
              typicalDataEntities: [
                "Playtest Sessions",
                "Player Telemetry",
                "Survey Responses",
                "Funnel Drop-Off Points",
                "Economy Metrics",
              ],
              typicalSourceSystems: [
                "Game Telemetry System",
                "Survey / Sentiment Tooling",
                "Soft-Launch Analytics",
                "Bug Tracker",
              ],
            },
            {
              name: "Market Opportunity Analysis",
              description:
                "Quantify market size, genre saturation, competitor pipelines, audience preferences, and platform economics for new game concepts using internal performance data and external market intelligence.",
              businessValue:
                "Better-informed greenlight decisions; reduced concentration of capital in over-saturated genres.",
              typicalDataEntities: [
                "Market Size Estimates",
                "Genre Performance",
                "Competitor Pipeline Data",
                "Audience Preferences",
                "Platform Economics",
              ],
              typicalSourceSystems: [
                "Market Intelligence Provider",
                "App Store APIs",
                "Sales Data Provider",
                "Analytics Platform",
              ],
            },
          ],
          kpis: [
            "Playtest completion rate",
            "Pre-launch sentiment score",
            "Development milestone accuracy",
          ],
          personas: ["Studio General Manager", "Game Director", "Head of Product"],
        },
        {
          name: "Effective Live Operations",
          useCases: [
            {
              name: "Live Event Performance Analytics",
              description:
                "Monitor and optimize live events, seasonal content, and game updates in real-time to maximize player engagement.",
              typicalDataEntities: [
                "Event Definitions",
                "Participation Metrics",
                "Engagement Rates",
                "Revenue per Event",
              ],
              typicalSourceSystems: [
                "Game Telemetry System",
                "Live Ops Platform",
                "Analytics Platform",
                "Content CMS",
              ],
            },
            {
              name: "Game Balance Optimization",
              description:
                "Use analytics to continuously monitor and adjust game balance, economy, and difficulty to maintain player satisfaction.",
              typicalDataEntities: [
                "Economy Metrics",
                "Win Rates",
                "Item Usage",
                "Difficulty Progression",
              ],
              typicalSourceSystems: [
                "Game Telemetry System",
                "Economy Config",
                "Analytics Platform",
                "A/B Testing Platform",
              ],
            },
            {
              name: "Content Pipeline Optimization",
              description:
                "Optimize content delivery scheduling based on player engagement patterns and seasonal trends.",
              typicalDataEntities: [
                "Content Calendar",
                "Engagement Patterns",
                "Release Metrics",
                "Seasonal Trends",
              ],
              typicalSourceSystems: [
                "Content CMS",
                "Game Telemetry System",
                "Analytics Platform",
                "Live Ops Platform",
              ],
            },
          ],
          kpis: [
            "Event participation rate",
            "Player satisfaction post-update",
            "Content engagement metrics",
          ],
          personas: ["Head of Live Operations", "Game Producer", "Head of Analytics"],
        },
      ],
    },
    {
      name: "Efficient Business Operations",
      whyChange:
        "Studios run 24/7 live games with massive ingest from multi-region telemetry, content publishing across many platforms, and finance/regulatory reporting across jurisdictions. Cost efficiency, data democratization, and reliability matter more than ever as margins compress. The studios that consolidate fragmented data estates onto a single lakehouse, give designers and producers self-service analytics, and ML-tune cloud spend keep CAC payback under control while shipping more iterations -- the operational compounding that separates breakout franchises from one-and-done releases.",
      priorities: [
        {
          name: "Operational Excellence",
          useCases: [
            {
              name: "Infrastructure Cost Optimization",
              description:
                "Use ML on traffic forecasts, regional play patterns, and event calendars to right-size compute, storage, and CDN capacity in advance of launches and live events -- preventing both costly over-provisioning and SLO-breaking under-provisioning.",
              businessValue:
                "15-25% reduction in infrastructure cost per DAU; better SLO attainment during peak events.",
              typicalDataEntities: [
                "Resource Utilization",
                "Cost by Service",
                "DAU/MAU Metrics",
                "Peak Load Patterns",
                "Capacity Forecasts",
              ],
              typicalSourceSystems: [
                "Cloud Platform",
                "APM",
                "Billing System",
                "Game Telemetry System",
                "FinOps Tooling",
              ],
            },
            {
              name: "Data Democratization",
              description:
                "Enable producers, designers, marketing, and live-ops teams to explore data via self-service BI and natural-language analytics on curated, governed data products -- replacing analyst ticket queues with on-demand answers grounded in trusted definitions.",
              businessValue:
                "60-70% reduction in ad-hoc analytics request backlog; faster live-ops decision cycles.",
              typicalDataEntities: [
                "Curated Data Products",
                "Semantic Models",
                "User Query Logs",
                "Definitions / Glossary",
                "Dashboard Catalog",
              ],
              typicalSourceSystems: [
                "BI Platform",
                "Data Catalog",
                "Genie / NL2SQL Surface",
                "Analytics Platform",
              ],
            },
          ],
          kpis: ["Infrastructure cost per DAU", "Data access time", "Self-service adoption rate"],
          personas: ["Chief Technology Officer", "VP Engineering", "Head of Data Platform"],
        },
      ],
    },
  ],
};
