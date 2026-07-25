/**
 * Casinos & Resorts -- Industry Outcome Map
 *
 * Strategic imperatives and pillars are sourced verbatim from the Master
 * Repository XLSX (Use Case Summaries sheet). Use case names and short
 * descriptions come from the same source. Rich enrichment fields (model
 * type, KPI, benchmarks, data asset linkage, MC/VA, economic patterns)
 * live in casinos-resorts.enrichment.ts and are produced by the master repo seed.
 */

import type { IndustryOutcome } from "./index";

export const CASINOS_RESORTS: IndustryOutcome = {
  id: "casinos-resorts",
  name: "Casinos & Resorts",
  subVerticals: ["Integrated Resorts","Regional Casinos","Cruise Gaming","Online Casino"],
  suggestedDomains: ["Guest Experience","Gaming Operations","Hospitality","Marketing","Compliance","Loyalty"],
  suggestedPriorities: ["Grow Guests","Protect the Guest","Optimize Operations"],
  objectives: [
    {
      name: "Guest Centric Experience",
      whyChange: "Knowing, attracting, and protecting the guest unlocks loyalty and lifetime value across gaming and hospitality.",
      priorities: [
        {
          name: "Know the Guest",
          useCases: [
            {
              name: "Guest360",
              description: "Create a unified, real-time guest view.",
            },
            {
              name: "Segmentation",
              description: "Build actionable guest segments across lifecycle.",
            },
            {
              name: "Greater Guest Experience",
              description: "Personalize service across property and digital.",
            },
            {
              name: "Journey Analytics",
              description: "Visualize end-to-end guest journeys.",
            },
            {
              name: "Identity Resolution",
              description: "Persist identities across channels/devices.",
            },
            {
              name: "Single Wallet",
              description: "Seamless funding across products/channels.",
            },
            {
              name: "Early VIP Identification",
              description: "Spot rising high-rollers early.",
            },
          ],
          kpis: ["Guest LTV","Theoretical win per visit","Loyalty enrollment"],
          personas: ["Chief Marketing Officer","VP Loyalty","VP Guest Services"],
        },
        {
          name: "Attact the Guest",
          useCases: [
            {
              name: "Next Best Bet",
              description: "Recommend the most relevant bets for each guest.",
            },
            {
              name: "(Re)Marketing",
              description: "Orchestrate re-engagement across channels.",
            },
            {
              name: "Cohort Analysis",
              description: "Measure behavior/outcomes by cohorts.",
            },
            {
              name: "Pre-VIP Engagement",
              description: "Nurture emerging high-value guests.",
            },
            {
              name: "Promotions",
              description: "Manage and distribute promos with control.",
            },
            {
              name: "Personalization",
              description: "Tailor content, offers, and UX.",
            },
            {
              name: "Loyalty Programs",
              description: "Operate tiers, benefits, and comps.",
            },
          ],
          kpis: ["Guest LTV","Theoretical win per visit","Loyalty enrollment"],
          personas: ["Chief Marketing Officer","VP Loyalty","VP Guest Services"],
        },
        {
          name: "Protect the Guest",
          useCases: [
            {
              name: "Responsible Gaming",
              description: "Proactively detect and intervene on risky behavior.",
            },
            {
              name: "Detect Fraud At Signup",
              description: "Stop fake/abusive accounts at creation.",
            },
            {
              name: "Detect Fraud At Withdrawal",
              description: "Block mule/bonus abuse at cash-out.",
            },
            {
              name: "Toxicity Mitigation",
              description: "Moderate abusive chats/calls.",
            },
            {
              name: "Churn Prediction",
              description: "Predict lapse risk and intervene.",
            },
          ],
          kpis: ["Guest LTV","Theoretical win per visit","Loyalty enrollment"],
          personas: ["Chief Marketing Officer","VP Loyalty","VP Guest Services"],
        },
      ],
    },
    {
      name: "Betting",
      whyChange: "Build-the-bet and offers personalization drive wagering revenue while maintaining responsible gaming standards.",
      priorities: [
        {
          name: "Build Bets",
          useCases: [
            {
              name: "Bet Lines Optimization",
              description: "Set profitable, competitive lines.",
            },
            {
              name: "Information Summarization",
              description: "Summarize interactions, issues, or policies.",
            },
            {
              name: "Risk Profiling",
              description: "Assess guest/product risk.",
            },
            {
              name: "Rated Play",
              description: "Accurately rate theo for comps.",
            },
            {
              name: "Game Data",
              description: "Centralize game metadata and configs.",
            },
            {
              name: "Optimize Hold and Yield",
              description: "Balance margin vs. volume.",
            },
          ],
          kpis: ["Handle per active","Hold %","Promo cost-to-revenue"],
          personas: ["VP Sportsbook","Head of Trading","VP Promotions"],
        },
        {
          name: "Offers",
          useCases: [
            {
              name: "Real Time In Game Lines",
              description: "Update in-play odds dynamically.",
            },
            {
              name: "Bet Carousels",
              description: "Curate bet shelves on home screens.",
            },
            {
              name: "Suggested Promotions",
              description: "Recommend the best offer per guest.",
            },
            {
              name: "Informed Bets",
              description: "Provide insights to help bettors.",
            },
            {
              name: "Understanding Lines",
              description: "Explain line moves and value.",
            },
            {
              name: "Parlay Optimization",
              description: "Suggest profitable parlay combos.",
            },
          ],
          kpis: ["Handle per active","Hold %","Promo cost-to-revenue"],
          personas: ["VP Sportsbook","Head of Trading","VP Promotions"],
        },
      ],
    },
    {
      name: "Hospitality",
      whyChange: "Hospitality growth and operational excellence convert gaming traffic into integrated resort revenue.",
      priorities: [
        {
          name: "Grow Guests",
          useCases: [
            {
              name: "Dynamic Pricing",
              description: "Price rooms, tables, and comps dynamically.",
            },
            {
              name: "Offer Optimization",
              description: "Test and optimize creative, timing, and value.",
            },
            {
              name: "Advertising Optimization",
              description: "Allocate media to highest ROI.",
            },
            {
              name: "Personalization And VIP",
              description: "White-glove personalization for VIPs.",
            },
            {
              name: "Convention Offers",
              description: "Price and package group/convention deals.",
            },
            {
              name: "Hotel Booking",
              description: "Seamless search, book, and upsell.",
            },
          ],
          kpis: ["RevPAR","F&B cover counts","Length of stay"],
          personas: ["Chief Hospitality Officer","VP F&B","GM Property"],
        },
        {
          name: "Operate",
          useCases: [
            {
              name: "Contact Center Deflection",
              description: "Resolve intents via bots/self-serve.",
            },
            {
              name: "Cross Channel Partnership",
              description: "Coordinate partner offers and tracking.",
            },
            {
              name: "Optimize Event & Programming",
              description: "Plan shows and property programming for ROI.",
            },
            {
              name: "Revenue Projection",
              description: "Forecast gaming/hotel/media revenue.",
            },
            {
              name: "Digital Concierge",
              description: "AI concierge for info and tasks.",
            },
            {
              name: "Ads Attribution",
              description: "Attribute conversions to media.",
            },
            {
              name: "Staff Optimization",
              description: "Align staffing with demand.",
            },
          ],
          kpis: ["RevPAR","F&B cover counts","Length of stay"],
          personas: ["Chief Hospitality Officer","VP F&B","GM Property"],
        },
      ],
    },
    {
      name: "Operations",
      whyChange: "Compliance and operational optimization protect license and margin.",
      priorities: [
        {
          name: "Comply",
          useCases: [
            {
              name: "Data and PII Governance",
              description: "Govern sensitive data end-to-end.",
            },
            {
              name: "Financial Reporting",
              description: "Close and report financials.",
            },
            {
              name: "Fraud Reporting",
              description: "Produce SARs and fraud KPIs.",
            },
            {
              name: "Cyber Security DASL/Behavior",
              description: "Monitor data access and anomalies.",
            },
            {
              name: "DSPM Integration",
              description: "Integrate data security posture tools.",
            },
            {
              name: "Banned Players",
              description: "Enforce bans across channels.",
            },
            {
              name: "Procurement Analysis",
              description: "Analyze vendor spend and savings.",
            },
          ],
          kpis: ["SAR/STR turnaround time","AML alerts per FTE","Game floor downtime"],
          personas: ["Chief Compliance Officer","VP Gaming Operations","Director of Surveillance"],
        },
        {
          name: "Optimize Operations",
          useCases: [
            {
              name: "Internal Data Sharing",
              description: "Safely share data across teams.",
            },
            {
              name: "AI Powered Analytics",
              description: "Embedded AI for analysis and BI.",
            },
            {
              name: "Data Discovery",
              description: "Find and understand enterprise data.",
            },
            {
              name: "External Data Sharing",
              description: "Governed sharing with partners.",
            },
            {
              name: "Empower Your Team",
              description: "Enable agents with knowledge and insights.",
            },
            {
              name: "Human Resources",
              description: "Workforce planning and compliance.",
            },
          ],
          kpis: ["SAR/STR turnaround time","AML alerts per FTE","Game floor downtime"],
          personas: ["Chief Compliance Officer","VP Gaming Operations","Director of Surveillance"],
        },
      ],
    },
  ],
};
