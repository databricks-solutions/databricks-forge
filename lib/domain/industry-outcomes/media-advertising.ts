import type { IndustryOutcome } from "./index";

export const MEDIA_ADVERTISING: IndustryOutcome = {
  id: "media-advertising",
  name: "Media & Advertising",
  subVerticals: [
    "Streaming & OTT",
    "Broadcasting",
    "Publishing",
    "Advertising Technology",
    "Digital Media",
  ],
  suggestedDomains: ["Marketing", "Customer Experience", "Operations", "Sales", "Cybersecurity"],
  suggestedPriorities: [
    "Increase Revenue",
    "Enhance Experience",
    "Protect Revenue",
    "Drive Innovation",
    "Reduce Cost",
  ],
  objectives: [
    {
      name: "Know Your Audience",
      whyChange:
        "Google, Meta, and Amazon control more than 60% of digital advertising and own the deepest first-party audience data in the industry. Cookie deprecation, Apple's ATT, and tightening privacy regulation (GDPR, CPRA, state-level laws) have collapsed the third-party identity layer that traditional media businesses leaned on for targeting. The only durable counter is a first-party identity spine -- household, person, and device-level -- powered by authenticated streaming, registered subscribers, and consented engagement signals. Publishers, broadcasters, and streamers who build this spine command premium CPMs and can credibly compete with the duopoly; those who don't watch yield collapse as cookies fully retire.",
      priorities: [
        {
          name: "Identity & Customer 360",
          useCases: [
            {
              name: "First-Party Identity Spine",
              description:
                "Build a unified first-party identity framework storing and organizing PII at household, person, and device levels with consent-aware governance -- the foundational asset for every downstream targeting, personalization, attribution, and clean-room measurement use case in a post-cookie world.",
              businessValue:
                "Foundation for every other audience and monetization use case; enables sustained premium CPMs against duopoly comparables.",
              typicalDataEntities: [
                "Household Profiles",
                "Person Identity Records",
                "Device Identifiers",
                "Identity Link Graph",
                "Consent Records",
              ],
              typicalSourceSystems: [
                "CDP",
                "Website Analytics",
                "App Analytics",
                "CRM",
                "Consent Management Platform",
              ],
            },
            {
              name: "Household Device Graphing",
              description:
                "Link CTV devices, mobile, web, and shared logins to individual households using probabilistic models on first-party login + IP + STB / OTT signals -- dramatically expanding addressable audience for advertisers without leaking PII.",
              businessValue:
                "20-40% increase in addressable cross-device audience; enables co-viewing measurement and household-level frequency capping.",
              typicalDataEntities: [
                "Device Fingerprints",
                "Household Clusters",
                "Cross-Device Signals",
                "Login Graph",
                "Co-Viewing Indicators",
              ],
              typicalSourceSystems: [
                "CDP",
                "Ad Server",
                "Streaming Platform",
                "Analytics Platform",
                "STB / OTT Telemetry",
              ],
            },
            {
              name: "Customer Profile Enrichment",
              description:
                "Aggregate signals from streaming watch behaviour, web reading, app sessions, subscription state, and offline events into rich profiles describing genre affinity, demographics, and intent -- governed by consent and PII policy.",
              businessValue:
                "Higher targeting precision; foundation for premium audience segments sold at duopoly-comparable CPMs.",
              typicalDataEntities: [
                "Customer Profiles",
                "Engagement History",
                "Demographic Attributes",
                "Interest Signals",
                "Subscription State",
              ],
              typicalSourceSystems: [
                "CDP",
                "Content CMS",
                "Analytics Platform",
                "CRM",
                "Subscription / Billing System",
              ],
            },
            {
              name: "Audience Segmentation",
              description:
                "ML-driven algorithms to create dynamic, sellable audience segments based on behavioral patterns, content affinity, demographics, and predicted intent -- shipped automatically to ad servers, DSPs, and clean rooms for activation.",
              businessValue:
                "Premium segment CPMs (1.5-3x baseline); cleaner self-serve advertiser experience; foundation for retail-media-style monetization.",
              typicalDataEntities: [
                "Audience Segments",
                "Behavioral Events",
                "Content Preferences",
                "Demographic Attributes",
                "Predicted Intent Scores",
              ],
              typicalSourceSystems: [
                "CDP",
                "Content CMS",
                "Analytics Platform",
                "Ad Server",
                "DSP / SSP",
              ],
            },
          ],
          kpis: [
            "Identity resolution rate (%)",
            "Cross-device match rate",
            "Customer profile completeness",
          ],
          personas: ["Chief Data Officer", "Head of Ad Sales", "Head of Audience Insights"],
        },
      ],
    },
    {
      name: "Grow & Retain Your Audience",
      whyChange:
        "Streaming churn averages 4-7% monthly across the industry, content libraries are commoditized through bundling and licensing wars, and subscriber acquisition costs continue to climb. Differentiation now lives in the experience: how fast users find content they love, how relevant the homepage is, how well the platform anticipates churn signals, and how surgically retention dollars are spent. AI-powered personalization, predictive churn intervention, and rigorously attributed marketing turn passive subscribers into engaged, long-tenure customers; without these, CAC payback periods extend indefinitely.",
      priorities: [
        {
          name: "Marketing & Acquisition",
          useCases: [
            {
              name: "Subscriber Churn Prediction",
              description:
                "Predict churn risk using viewing decay, engagement decline, billing-event signals, and account-sharing indicators -- triggering targeted retention offers, content recommendations, or service-tier downgrades calibrated to lifetime value.",
              businessValue:
                "10-25% reduction in monthly churn through proactive intervention; protected CLV in the highest-value subscriber cohorts.",
              typicalDataEntities: [
                "Subscriber Activity",
                "Viewing Patterns",
                "Engagement Decay Signals",
                "Churn Risk Scores",
                "Retention Offer Outcomes",
              ],
              typicalSourceSystems: [
                "Streaming Platform",
                "Subscription / Billing System",
                "CRM",
                "Marketing Platform",
                "Analytics Platform",
              ],
            },
            {
              name: "Content Recommendation Engine",
              description:
                "Build personalized recommendation systems using collaborative filtering, deep learning sequence models, and contextual bandits -- powering homepage rows, search ranking, and end-of-content next-up surfaces in millisecond budgets.",
              businessValue:
                "10-30% lift in engaged time-per-session; higher D7/D30 retention; foundation for content-personalization moat.",
              typicalDataEntities: [
                "Content Catalog",
                "Viewing History",
                "Embedding Indices",
                "Session Context",
                "Recommendation Logs",
              ],
              typicalSourceSystems: [
                "Streaming Platform",
                "Recommendation Service",
                "Content CMS",
                "Vector Database",
                "Analytics Platform",
              ],
            },
            {
              name: "Campaign Attribution & Optimization",
              description:
                "Measure marketing effectiveness across channels (paid social, search, CTV, influencer, brand TV) with multi-touch attribution and incrementality testing -- replacing last-click attribution with causal lift measurement to reallocate spend toward channels that actually drive incremental subscribers.",
              businessValue:
                "15-25% improvement in marketing ROI through evidence-based channel reallocation.",
              typicalDataEntities: [
                "Campaign Events",
                "Touchpoint Data",
                "Conversion Events",
                "Channel Performance",
                "Incrementality Test Results",
              ],
              typicalSourceSystems: [
                "Marketing Platform",
                "Ad Server",
                "Analytics Platform",
                "CRM",
                "Subscription / Billing System",
              ],
            },
          ],
          kpis: ["Subscriber retention rate", "Content engagement time", "Marketing ROI"],
          personas: ["Chief Marketing Officer", "Head of Growth", "VP Content Strategy"],
        },
      ],
    },
    {
      name: "Monetize Your Audience & Content",
      whyChange:
        "Cord-cutting has eroded the historical distribution-fee revenue base of cable and broadcast operators while ad-supported and hybrid streaming tiers (FAST, AVOD, hybrid SVOD) explode in number. The industry is rewriting its monetization model in real time: targeted programmatic advertising on first-party data, retail-media-style data partnerships, AI-enriched content metadata for higher discoverability, and rigorous content performance analytics to inform $billion+ licensing decisions. Operators who modernize their advertising stack -- direct, programmatic, and self-serve -- and underpin every content investment with viewership analytics replace lost distribution revenue with higher-yield digital monetization streams.",
      priorities: [
        {
          name: "Advertising Monetization",
          useCases: [
            {
              name: "Programmatic Ad Targeting",
              description:
                "Enable precise, privacy-compliant programmatic targeting using first-party audience data and ML-driven lookalike modeling -- exposing premium first-party segments to DSPs through clean rooms or contextual signals where direct PII is constrained.",
              businessValue:
                "Premium CPMs (1.5-3x baseline contextual rates); bigger share of programmatic ad spend captured.",
              typicalDataEntities: [
                "Audience Segments",
                "Ad Inventory",
                "Bid Data",
                "Conversion Events",
                "Lookalike Models",
              ],
              typicalSourceSystems: [
                "CDP",
                "Ad Server",
                "DSP / SSP",
                "Analytics Platform",
                "Clean Room",
              ],
            },
            {
              name: "Yield Optimization",
              description:
                "Optimize ad inventory yield using ML-driven CPM forecasting, dynamic floor pricing, header-bidding waterfall optimization, and inventory-allocation across direct vs programmatic channels.",
              businessValue:
                "5-15% lift in eCPM and overall yield; better fill rate on premium inventory.",
              typicalDataEntities: [
                "Ad Inventory",
                "CPM Forecasts",
                "Placement Performance",
                "Fill Rates",
                "Floor Price Configurations",
              ],
              typicalSourceSystems: [
                "Ad Server",
                "SSP",
                "Analytics Platform",
                "Programmatic Platform",
                "Header Bidding Wrapper",
              ],
            },
            {
              name: "Ad Measurement & Attribution",
              description:
                "Provide advertisers with accurate cross-platform measurement -- impressions, viewability, completion rates, attribution -- in a privacy-respecting way (clean rooms, aggregated reporting) to prove campaign effectiveness and command premium prices.",
              businessValue:
                "Stronger advertiser case for renewals and budget shift from duopoly to first-party publishers.",
              typicalDataEntities: [
                "Ad Impressions",
                "Viewability Data",
                "Conversion Events",
                "Attribution Models",
                "Clean Room Outputs",
              ],
              typicalSourceSystems: [
                "Ad Server",
                "Analytics Platform",
                "DMP",
                "CRM",
                "Clean Room",
              ],
            },
          ],
          kpis: ["CPM growth", "Ad fill rate", "Ad revenue per user"],
          personas: ["Head of Ad Sales", "VP Ad Operations", "Chief Revenue Officer"],
        },
        {
          name: "Content Supply Chain",
          useCases: [
            {
              name: "Content Performance Analytics",
              description:
                "Quantify content performance across platforms -- viewership, engagement, share-of-tune, demographic skew, ad-load tolerance, licensing-cost-per-watched-hour -- to inform content investment, scheduling, and licensing-renewal decisions in a $billion-stakes business.",
              businessValue:
                "Better-allocated content spend; cleaner license-renewal negotiations; data-grounded greenlight decisions.",
              typicalDataEntities: [
                "Content Catalog",
                "Viewership Metrics",
                "Platform Performance",
                "Licensing Data",
                "Cost-per-Watched-Hour",
              ],
              typicalSourceSystems: [
                "Content CMS",
                "Streaming Platform",
                "Analytics Platform",
                "Rights Management",
                "Finance System",
              ],
            },
            {
              name: "AI-Powered Content Metadata",
              description:
                "Use AI (computer vision, ASR, scene detection, NER) to automatically tag, classify, and enrich content metadata -- extracting cast, scene types, genre signals, content warnings, and search-friendly descriptions to power discovery, recommendations, and ad-suitability targeting.",
              businessValue:
                "Higher content discoverability; reduced manual taxonomy effort; richer ad-targeting context.",
              typicalDataEntities: [
                "Content Catalog",
                "Raw Media Assets",
                "Tag Taxonomy",
                "Enriched Metadata",
                "Generated Descriptions",
              ],
              typicalSourceSystems: [
                "Content CMS",
                "MAM",
                "Transcription Service",
                "Analytics Platform",
                "Computer Vision Service",
              ],
            },
          ],
          kpis: ["Content ROI", "Content discovery rate", "Production efficiency"],
          personas: ["VP Content Strategy", "Head of Programming", "Chief Content Officer"],
        },
      ],
    },
  ],
};
