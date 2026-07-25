import type { IndustryOutcome } from "./index";

export const COMMUNICATIONS: IndustryOutcome = {
  id: "communications",
  name: "Communications & Telecom",
  subVerticals: [
    "Mobile Operators",
    "Fixed-Line Operators",
    "Cable & Broadband",
    "Internet Service Providers (ISPs)",
    "Wholesale & Aggregation Providers",
    "Fibre & Backbone Infrastructure",
    "MVNOs",
    "Satellite Communications",
  ],
  suggestedDomains: [
    "Customer Experience",
    "Network Operations",
    "Marketing",
    "Operations",
    "Risk & Compliance",
    "Wholesale & Partner Management",
    "Product & Pricing",
    "Infrastructure & Planning",
    "Finance",
  ],
  suggestedPriorities: [
    "Increase Revenue",
    "Enhance Experience",
    "Reduce Cost",
    "Optimize Operations",
    "Mitigate Risk",
    "Grow Subscribers",
    "Scale Wholesale",
    "Optimise Infrastructure",
  ],
  objectives: [
    // ------------------------------------------------------------------
    // Objective 1 -- Grow Consumer & SMB Broadband Profitably
    // ------------------------------------------------------------------
    {
      name: "Grow Consumer & SMB Broadband Profitably",
      whyChange:
        "Broadband is a high-churn, low-switching-cost market where ISPs compete on speed, price, and digital experience. Customer acquisition costs are rising while ARPU is compressed. Data-driven targeting, digital-first acquisition funnels, churn prediction, and personalised speed-tier upsell are essential to grow net adds profitably and defend market share against incumbents and new entrants.",
      priorities: [
        {
          name: "Digital Acquisition & Conversion",
          useCases: [
            {
              name: "Address-Level Broadband Availability Targeting",
              description:
                "Use address-level NBN/fibre availability data, competitor pricing, and demographic propensity models to target high-value prospects with digital ads and landing pages. Marketing teams use this to maximise conversion per acquisition dollar.",
              businessValue: "Reduce cost per acquisition by 20-30% through precision targeting.",
            },
            {
              name: "Flip-to-Fibre Migration Campaigns",
              description:
                "Identify customers on fixed wireless or HFC who can upgrade to fibre (FTTP/FTTC) and trigger automated migration offers with speed-tier upsell. Product and marketing teams use this to shift mix toward higher-ARPU fibre plans.",
              businessValue: "Increase ARPU by $5-10/month per migrated customer.",
            },
            {
              name: "Digital Funnel Conversion Analytics",
              description:
                "Track end-to-end digital acquisition funnel (ad click to activation) with attribution modelling, A/B test analysis, and drop-off prediction. Growth and digital teams use this to optimise landing pages, checkout flows, and offer presentation.",
              businessValue: "Improve online conversion rate by 15-25%.",
            },
            {
              name: "Competitive Pricing Intelligence",
              description:
                "Monitor competitor plan pricing, speed tiers, and promotional offers across the broadband market. Product and pricing teams use this to position plans competitively and respond to market moves within hours.",
              businessValue: "Maintain competitive pricing position while protecting margin.",
            },
          ],
          kpis: [
            "Net subscriber adds (monthly)",
            "Cost per acquisition ($)",
            "Digital conversion rate (%)",
            "Fibre mix (% of base on FTTP/FTTC)",
            "Ad spend ROI",
          ],
          personas: [
            "Head of Consumer Broadband",
            "Head of Growth & Digital",
            "Head of Marketing",
            "Head of Product",
          ],
        },
        {
          name: "Churn Prevention & ARPU Expansion",
          useCases: [
            {
              name: "Broadband Churn & Save-Offer Analytics",
              description:
                "Predict churn risk at the subscriber level using billing, usage, speed-test, complaint, and NPS data, then trigger personalised save offers (speed upgrade, price lock, bundle) through the optimal channel. Retention teams use this to intercept at-risk customers before they port out.",
              businessValue: "Reduce monthly churn by 15-25% in high-risk segments.",
            },
            {
              name: "Speed-Tier Upsell Propensity",
              description:
                "Identify customers consistently using capacity close to their plan limit and recommend speed-tier upgrades via app notification or email. Product teams use this to drive ARPU growth organically.",
              businessValue: "Drive 5-10% ARPU uplift through targeted upsell.",
            },
            {
              name: "Customer Lifetime Value Segmentation",
              description:
                "Calculate and segment customers by predicted CLV using tenure, ARPU, product mix, and engagement data. Finance and marketing teams use this to allocate retention spend and tailor service levels.",
              businessValue: "Optimise retention investment by focusing on highest-CLV segments.",
              typicalDataEntities: [
                "Tenure Data",
                "ARPU History",
                "Product Mix",
                "Engagement Metrics",
              ],
              typicalSourceSystems: ["BSS/OSS", "Billing Platform", "CRM", "Product Analytics"],
            },
            {
              name: "Win-Back & Re-Acquisition Targeting",
              description:
                "Score churned customers for win-back probability based on reason-for-leaving, tenure, and competitive landscape, then trigger timed re-acquisition campaigns. Marketing teams use this to recover high-value customers at lower cost than new acquisition.",
              businessValue: "Recover 8-12% of churned high-value customers within 90 days.",
            },
          ],
          kpis: [
            "Churn rate (monthly %)",
            "ARPU ($)",
            "Customer lifetime value ($)",
            "Save-offer acceptance rate (%)",
            "Win-back conversion rate (%)",
          ],
          personas: ["Head of Consumer Broadband", "Head of Retention", "CFO", "Head of Product"],
        },
        {
          name: "SMB Growth & Bundling",
          useCases: [
            {
              name: "SMB Propensity-to-Buy Scoring",
              description:
                "Score small business prospects by industry, size, location, and broadband needs to prioritise outbound sales and digital targeting. SMB sales teams use this to focus effort on highest-conversion opportunities.",
              businessValue: "Increase SMB new logo rate by 15-20%.",
            },
            {
              name: "Business Bundle Recommendation Engine",
              description:
                "Recommend optimal product bundles (broadband + security + VoIP + static IP) to SMB customers based on usage patterns and industry benchmarks. Self-service portal and account managers use this to increase attach rates.",
              businessValue: "Improve bundle attach rate by 20-30%, lifting SMB ARPU.",
            },
            {
              name: "SMB Onboarding & Activation Analytics",
              description:
                "Track time-to-activate and early-life experience for SMB customers, flagging delayed activations and poor early experiences for proactive outreach. Operations and CX teams use this to reduce early-life churn.",
              businessValue:
                "Reduce SMB early-life churn by 10-15% through proactive intervention.",
            },
          ],
          kpis: [
            "SMB net adds (monthly)",
            "Bundle attach rate (%)",
            "SMB ARPU ($)",
            "Time to activate (days)",
            "SMB early-life churn (%)",
          ],
          personas: ["Head of SMB", "Head of Product", "Head of Growth & Digital", "CEO"],
        },
      ],
    },
    // ------------------------------------------------------------------
    // Objective 2 -- Enhance Customer Experience
    // ------------------------------------------------------------------
    {
      name: "Enhance Customer Experience",
      whyChange:
        "Telecoms face poor customer satisfaction (consumer NPS -65 to -1), flat-to-negative revenue growth, and rising costs. Customer acquisition costs are at all-time highs. AI-driven customer experience transformation -- including self-service diagnostics, proactive outage comms, and closed-loop NPS management -- is critical for survival and differentiation.",
      priorities: [
        {
          name: "Consumer Experience & Self-Service",
          useCases: [
            {
              name: "Predictive Scripts for Contact Center",
              description:
                "Use AI to analyze customer communications, understand context and sentiment, and prepare tailored responses for first-point resolution.",
              businessValue: "20%+ reduction in care call volume, 10%+ reduction in handling time.",
              typicalDataEntities: [
                "Customer Communications",
                "Interaction History",
                "Product Holdings",
                "Resolution Scripts",
              ],
              typicalSourceSystems: ["Contact Center Platform", "CRM", "BSS/OSS"],
            },
            {
              name: "Churn Prediction and Retention",
              description:
                "Advanced ML models to predict churn by analyzing behavior, complaints, billing issues, renewal dates, and NPS scores.",
              businessValue:
                "1% churn reduction can increase profits by tens of millions annually.",
              typicalDataEntities: [
                "Usage Records",
                "Billing History",
                "Customer Interactions",
                "Service Tickets",
              ],
              typicalSourceSystems: ["BSS/OSS", "CRM", "Billing Platform"],
            },
            {
              name: "Intelligent Bill Analysis",
              description:
                "AI compares bills over time, explaining variations to customers and automating credit adjustments within designated limits.",
              businessValue: "Reduce billing-related support contacts by 25-35%.",
              typicalDataEntities: ["Bill History", "Usage Records", "Rate Plans", "Credit Rules"],
              typicalSourceSystems: ["Billing Platform", "BSS/OSS", "CRM"],
            },
            {
              name: "Hyper Personalized Offers",
              description:
                "Create hyper-personalized offers including cybersecurity products, network slicing, and additional bandwidth based on usage insights.",
              businessValue:
                "Increase offer acceptance rates by 20-30% compared to untargeted campaigns.",
              typicalDataEntities: [
                "Usage Patterns",
                "Product Holdings",
                "Customer Segments",
                "Offer Catalog",
              ],
              typicalSourceSystems: ["BSS/OSS", "CRM", "Product Catalog", "Marketing Platform"],
            },
            {
              name: "Self-Service Diagnostics & Speed-Test Intelligence",
              description:
                "Enable customers to run in-app diagnostics (speed test, latency check, WiFi optimisation) with AI-driven root cause analysis and automated remediation suggestions. Reduces inbound support contacts and improves perceived control.",
              businessValue: "Deflect 15-20% of support contacts through self-service resolution.",
              typicalDataEntities: [
                "Speed Test Results",
                "Network Diagnostics",
                "CPE Data",
                "Service Configuration",
              ],
              typicalSourceSystems: [
                "Network Analytics",
                "BSS/OSS",
                "CPE Management",
                "Customer App",
              ],
            },
            {
              name: "Proactive Outage Detection & Customer Comms",
              description:
                "Detect localised outages from network telemetry and customer-reported symptoms, automatically notify affected customers with ETA and status updates via app/SMS. CX teams use this to get ahead of complaint spikes.",
              businessValue:
                "Reduce inbound outage calls by 30-40% and improve NPS during incidents.",
              typicalDataEntities: [
                "Network Telemetry",
                "Fault Records",
                "Customer Service Links",
                "Outage Status",
              ],
              typicalSourceSystems: [
                "NOC/Network OSS",
                "Fault Management",
                "CRM",
                "Notification Platform",
              ],
            },
            {
              name: "Agent Support Copilot",
              description:
                "Equip contact centre agents with an AI copilot that surfaces customer history, diagnoses issues from network data, recommends next-best-action, and drafts responses. Support teams use this to improve first-call resolution and reduce handle time.",
              businessValue:
                "Improve first-call resolution by 20% and reduce average handle time by 25%.",
              typicalDataEntities: [
                "Customer History",
                "Network Diagnostics",
                "Product Configuration",
                "Resolution Knowledge",
              ],
              typicalSourceSystems: ["Contact Center Platform", "CRM", "BSS/OSS", "Network OSS"],
            },
          ],
          kpis: [
            "NPS improvement (20% YoY)",
            "Churn rate reduction (1-2%)",
            "First-call resolution (%)",
            "Average handle time (mins)",
            "Self-service resolution rate (%)",
            "ARPU growth (15%)",
          ],
          personas: [
            "Head of Customer Experience",
            "Head of Consumer Broadband",
            "Head of Contact Centre",
            "Head of Digital & Self-Service",
          ],
        },
        {
          name: "NPS & Closed-Loop Feedback",
          useCases: [
            {
              name: "NPS Driver Analysis & Action Engine",
              description:
                "Analyse NPS survey responses with NLP to identify key satisfaction drivers and detractors, then route actionable insights to responsible teams with SLA for follow-up. CX leadership uses this to close the loop on experience issues systematically.",
              businessValue: "Improve NPS by 10-15 points through systematic driver resolution.",
              typicalDataEntities: [
                "NPS Survey Responses",
                "Driver Themes",
                "Action Items",
                "Follow-up Status",
              ],
              typicalSourceSystems: ["Survey Platform", "CRM", "Contact Center Platform"],
            },
            {
              name: "Customer Journey Analytics",
              description:
                "Map end-to-end customer journeys (sign-up, activation, first bill, first support contact) and identify friction points using event data. Product and CX teams use this to prioritise UX improvements with highest retention impact.",
              businessValue: "Reduce journey drop-off by 15-20% at key friction points.",
            },
            {
              name: "Voice of Customer Text Mining",
              description:
                "Apply NLP to support tickets, chat logs, social media mentions, and app reviews to surface emerging themes, product issues, and competitive mentions. Product and CX teams use this for early warning on experience degradation.",
              businessValue:
                "Detect emerging experience issues 2-4 weeks earlier than traditional reporting.",
            },
          ],
          kpis: [
            "NPS (consumer and enterprise)",
            "Closed-loop action completion rate (%)",
            "Customer effort score",
            "App engagement (MAU)",
            "Support contact rate per 1,000 customers",
          ],
          personas: [
            "Head of Customer Experience",
            "Head of Product",
            "CEO",
            "Head of Digital & Self-Service",
          ],
        },
        {
          name: "B2B & Enterprise",
          useCases: [
            {
              name: "AI-Powered Pricing and Quoting",
              description:
                "Integrate maps, fiber network data, and customer insights to generate accurate quotes in seconds rather than days.",
              businessValue:
                "Reduce quote turnaround from days to minutes, improving win rates by 15-20%.",
            },
            {
              name: "Automated MACs Processing",
              description:
                "AI monitors and automates Moves, Adds, and Changes requests (25-35% of B2B service requests) across channels.",
              businessValue: "Reduce MACs processing time by 60% and error rates by 80%.",
            },
            {
              name: "Proactive SMB Offers",
              description:
                "Identify high-LTV SMB customers and proactively offer tailored packages for IoT, network slicing, and 5G solutions.",
              businessValue: "20% increase in new logo sales.",
            },
          ],
          kpis: [
            "Quote-to-cash cycle time (40% improvement)",
            "SLA compliance (99.9%)",
            "Cross-sell revenue (20% increase)",
            "Enterprise NPS",
          ],
          personas: [
            "Head of Enterprise Sales",
            "Head of SMB",
            "Head of Service Delivery",
            "Head of Product",
          ],
        },
        {
          name: "Service Delivery",
          useCases: [
            {
              name: "Automated Order Entry & Activation",
              description:
                "Use AI to automate order entry across systems, reducing error rates from 40% to near-zero and enabling 24/7 activation.",
              businessValue: "Reduce order errors by 90% and enable 24/7 self-service activation.",
            },
            {
              name: "Intelligent Provisioning",
              description:
                "AI-driven provisioning with predictive analytics to anticipate network needs and optimize resource allocation.",
              businessValue:
                "Reduce provisioning time by 40-50% through automation and prediction.",
            },
            {
              name: "Proactive Service Assurance",
              description:
                "AI-driven monitoring for proactive identification and resolution of service issues before they impact customers.",
              businessValue:
                "Reduce customer-affecting incidents by 25-30% through proactive detection.",
            },
          ],
          kpis: [
            "Order accuracy (99.9%)",
            "Service activation time (50% reduction)",
            "Order-to-cash cycle (20% reduction)",
            "Provisioning time (hours)",
          ],
          personas: ["Head of Service Delivery", "VP Operations", "Chief Information Officer"],
        },
      ],
    },
    // ------------------------------------------------------------------
    // Objective 3 -- Scale Enterprise & Wholesale Connectivity
    // ------------------------------------------------------------------
    {
      name: "Scale Enterprise & Wholesale Connectivity",
      whyChange:
        "Enterprise and wholesale connectivity is a high-margin, relationship-driven business where fibre-first providers compete on provisioning speed, SLA reliability, and partner portal experience. Data-driven wholesale partner management, automated quoting, and real-time SLA dashboards are critical to scale revenue without proportional headcount growth.",
      priorities: [
        {
          name: "Enterprise Connectivity Portfolio",
          useCases: [
            {
              name: "Fibre & SD-WAN Quote-to-Activate Acceleration",
              description:
                "Automate feasibility, pricing, and provisioning for enterprise fibre and SD-WAN orders using address-level network data, cost models, and capacity checks. Sales and pre-sales teams use this to reduce quote turnaround from days to minutes.",
              businessValue: "Reduce enterprise quote-to-activate cycle by 50-60%.",
            },
            {
              name: "Cloud Interconnect Demand Forecasting",
              description:
                "Predict enterprise demand for cloud interconnect (AWS, Azure, GCP) by region and capacity tier to pre-provision capacity and reduce lead times. Network planning and enterprise sales teams use this to stay ahead of demand.",
              businessValue: "Reduce cloud interconnect provisioning time by 40%.",
            },
            {
              name: "Enterprise SLA Performance Dashboard",
              description:
                "Real-time monitoring of SLA metrics (uptime, latency, jitter, packet loss) per enterprise customer with automated breach alerting and root cause analysis. Account managers and NOC teams use this to maintain trust and reduce penalties.",
              businessValue: "Achieve 99.95%+ SLA attainment across enterprise portfolio.",
            },
            {
              name: "Managed Security Attach Analytics",
              description:
                "Identify enterprise and SMB customers most likely to purchase managed security services (DDoS protection, firewall, threat monitoring) based on industry, traffic patterns, and risk profile. Sales teams use this to grow the security revenue stream.",
              businessValue: "Increase managed security attach rate by 25-35%.",
            },
          ],
          kpis: [
            "Enterprise revenue growth (%)",
            "Quote-to-activate time (days)",
            "SLA attainment (%)",
            "Managed security attach rate (%)",
            "Cloud interconnect revenue ($)",
          ],
          personas: [
            "Head of Enterprise & Wholesale",
            "Head of Enterprise Sales",
            "Head of Product",
            "CFO",
          ],
        },
        {
          name: "Wholesale & Partner Experience",
          useCases: [
            {
              name: "Wholesale Partner Performance Cockpit",
              description:
                "Provide RSPs and wholesale partners with self-service analytics on order volumes, provisioning times, fault rates, and SLA performance across their customer base. Head of Wholesale uses this to drive partner satisfaction and retention.",
              businessValue: "Improve wholesale partner NPS by 20+ points.",
            },
            {
              name: "NBN Aggregation Utilisation & Margin Analytics",
              description:
                "Track bandwidth utilisation, CVC costs, and margin per POI across the NBN aggregation portfolio. Finance and wholesale teams use this to optimise CVC provisioning and identify under/over-provisioned POIs.",
              businessValue: "Improve NBN aggregation margin by 5-10% through CVC optimisation.",
            },
            {
              name: "Automated Wholesale Provisioning & Fault Triage",
              description:
                "Automate order processing, provisioning, and fault triage for wholesale services, reducing manual intervention and improving turnaround times. Operations teams use this to scale wholesale without proportional headcount.",
              businessValue:
                "Reduce wholesale provisioning time by 40% and fault resolution by 30%.",
            },
            {
              name: "Partner Revenue & Growth Analytics",
              description:
                "Track revenue, growth trajectory, and product mix per wholesale partner to identify upsell opportunities, at-risk partners, and whitespace. Wholesale account managers use this for data-driven partner engagement.",
              businessValue: "Identify 15-20% more upsell opportunities across the partner base.",
            },
          ],
          kpis: [
            "Wholesale revenue ($)",
            "Partner NPS",
            "Provisioning time (hours)",
            "CVC cost per Mbps ($)",
            "Partner churn rate (%)",
          ],
          personas: [
            "Head of Wholesale",
            "Head of Enterprise & Wholesale",
            "CFO",
            "Head of Service Delivery",
          ],
        },
      ],
    },
    // ------------------------------------------------------------------
    // Objective 4 -- Optimise Network & Infrastructure Performance
    // ------------------------------------------------------------------
    {
      name: "Optimise Network & Infrastructure Performance",
      whyChange:
        "Network complexity is increasing with fibre rollouts, backbone expansion, and growing bandwidth demand. AI-driven network optimisation, predictive fault detection, and infrastructure capacity planning are essential for maintaining service quality, maximising asset utilisation, and controlling costs across backbone, subsea, metro fibre, and access networks.",
      priorities: [
        {
          name: "Network Operations",
          useCases: [
            {
              name: "Network Performance Monitoring",
              description:
                "Monitor network and service performance in real-time using AI to detect anomalies and predict capacity needs across access, metro, and backbone layers.",
              businessValue: "Reduce network-related customer complaints by 20-30%.",
            },
            {
              name: "Predictive Network Demand",
              description:
                "Predict network demand changes to proactively optimize capacity and avoid congestion across POIs, backbone links, and peering points.",
              businessValue:
                "Avoid 80-90% of congestion events through proactive capacity adjustment.",
            },
            {
              name: "Network Capacity Planning",
              description:
                "Track network capacity in real-time with proactive planning based on usage patterns, subscriber growth projections, and traffic trends.",
              businessValue: "Reduce over-provisioning costs by 10-15% while maintaining headroom.",
            },
            {
              name: "Backbone & Subsea Link Utilisation Optimisation",
              description:
                "Monitor utilisation, latency, and error rates across backbone and subsea cable segments to optimise traffic routing, plan capacity augments, and avoid congestion. Network planning teams use this for strategic capacity decisions.",
              businessValue:
                "Improve backbone utilisation by 10-15% while maintaining latency SLAs.",
            },
            {
              name: "NBN POI Capacity & Cost Management",
              description:
                "Track bandwidth utilisation and cost per Mbps at each NBN Point of Interconnect, flagging POIs approaching congestion thresholds and optimising CVC purchases. Network and finance teams use this to balance cost and quality.",
              businessValue:
                "Reduce cost per Mbps by 8-12% through proactive POI capacity management.",
            },
            {
              name: "Fibre Network Route Planning & Expansion",
              description:
                "Use demand heatmaps, competitor presence, and construction cost models to prioritise metro fibre build and duct extensions. Network planning teams use this to maximise ROI on infrastructure capital.",
              businessValue:
                "Improve fibre build ROI by 15-25% through data-driven route prioritisation.",
            },
          ],
          kpis: [
            "Network availability (%)",
            "Backbone utilisation (%)",
            "POI utilisation per link (%)",
            "Cost per Mbps ($)",
            "Mean time to repair (hours)",
            "Capacity headroom (%)",
          ],
          personas: [
            "Chief Network Officer",
            "Head of Network Planning",
            "Head of NOC",
            "VP Engineering",
            "Chief Technology Officer",
          ],
        },
        {
          name: "Incident & Fault Management",
          useCases: [
            {
              name: "Predictive Fault Detection & Auto-Remediation",
              description:
                "Detect emerging faults from network telemetry (optical power, error rates, temperature) before service impact, and trigger automated remediation (route failover, port reset) where possible. NOC teams use this to reduce MTTR and customer-affecting incidents.",
              businessValue: "Reduce mean time to repair by 30-40%.",
            },
            {
              name: "Outage Impact Radius & Customer Notification",
              description:
                "When a fault occurs, automatically map the blast radius to affected services and customers, prioritise restoration by customer impact, and trigger proactive communications. NOC and CX teams use this to manage incidents transparently.",
              businessValue: "Reduce inbound fault calls by 30% through proactive notification.",
            },
            {
              name: "Network Resilience & Redundancy Analysis",
              description:
                "Model single points of failure across the fibre, backbone, and subsea network to prioritise redundancy investments and validate failover paths. Chief Network Officer uses this for strategic resilience planning.",
              businessValue:
                "Eliminate critical single points of failure and reduce major outage frequency by 40-50%.",
            },
          ],
          kpis: [
            "MTTR (hours)",
            "Incidents per 1,000 customers",
            "Proactive notification coverage (%)",
            "Subsea link availability (%)",
            "Single points of failure count",
          ],
          personas: [
            "Head of NOC",
            "Chief Network Officer",
            "Head of Customer Experience",
            "VP Engineering",
          ],
        },
        {
          name: "Field Operations",
          useCases: [
            {
              name: "AI-Powered Field Tech Support",
              description:
                "Equip field technicians with AI assistants for real-time troubleshooting guidance and knowledge access during fibre installs, repairs, and network builds.",
              businessValue: "Improve first-time fix rate by 15-20% and reduce repeat visits.",
            },
            {
              name: "Predictive Field Service",
              description:
                "Predict equipment failures and dispatch field technicians proactively before service is affected, using telemetry from CPE, ONTs, and network equipment.",
              businessValue: "Reduce truck rolls by 20-25% through predictive dispatch.",
              typicalDataEntities: [
                "CPE Telemetry",
                "ONT Data",
                "Equipment Health",
                "Failure Predictions",
              ],
              typicalSourceSystems: ["Network OSS", "CPE Management", "Field Service Management"],
            },
          ],
          kpis: [
            "First-time fix rate (%)",
            "Average repair time (hours)",
            "Truck roll reduction (%)",
            "Field technician utilisation (%)",
          ],
          personas: ["Head of Field Operations", "VP Engineering", "Chief Operating Officer"],
        },
      ],
    },
    // ------------------------------------------------------------------
    // Objective 5 -- Security & Compliance
    // ------------------------------------------------------------------
    {
      name: "Security & Compliance",
      whyChange:
        "Telecoms face sophisticated fraud, evolving privacy regulations, increasing cybersecurity threats, and growing demand for managed security services. AI-powered detection, automated compliance, and proactive security posture management are essential for protecting revenue, customer trust, and regulatory standing.",
      priorities: [
        {
          name: "Fraud Prevention",
          useCases: [
            {
              name: "Fraud Detection & Prevention",
              description:
                "Detect and prevent fraud including subscription fraud, international revenue share fraud, and account takeover using ML pattern detection across billing, usage, and identity data.",
              businessValue: "Reduce fraud losses by 40-60% through real-time detection.",
              typicalDataEntities: [
                "Usage Records",
                "Billing History",
                "Identity Data",
                "Fraud Patterns",
              ],
              typicalSourceSystems: [
                "BSS/OSS",
                "Billing Platform",
                "Identity Verification",
                "Fraud Detection Engine",
              ],
            },
            {
              name: "Robo-calling & Bot Detection",
              description:
                "Use AI to monitor and detect robocalling, bot activities, and SIM swap attempts in real-time, protecting customers and network integrity.",
              businessValue: "Block 95%+ of automated fraud attempts in real-time.",
            },
          ],
          kpis: [
            "Fraud loss reduction ($)",
            "Detection accuracy (%)",
            "False positive rate (%)",
            "Time to detect (minutes)",
          ],
          personas: [
            "Head of Fraud Prevention",
            "Chief Information Security Officer",
            "VP Revenue Assurance",
          ],
        },
        {
          name: "Cybersecurity & Managed Security",
          useCases: [
            {
              name: "Network Security Posture Monitoring",
              description:
                "Continuously assess the security posture of network infrastructure (DDoS exposure, misconfiguration, vulnerability scanning) using AI-driven analysis of logs and threat intelligence feeds. CISO and security operations teams use this to maintain a hardened network perimeter.",
              businessValue: "Reduce critical vulnerability exposure window by 60-70%.",
            },
            {
              name: "Customer-Facing Threat Intelligence",
              description:
                "Aggregate threat data across the customer base to identify emerging attack patterns, compromised endpoints, and botnet participation, feeding into managed security service offerings. Security product teams use this to differentiate the managed security portfolio.",
              businessValue:
                "Enhance managed security value proposition, supporting 15-20% price premium.",
            },
            {
              name: "Regulatory Compliance Automation",
              description:
                "Automate compliance monitoring and reporting for telecommunications obligations, privacy regulations, and critical infrastructure requirements. Compliance and legal teams use this to reduce manual audit burden and ensure continuous compliance.",
              businessValue:
                "Reduce compliance reporting effort by 50-60% and eliminate overdue findings.",
              typicalDataEntities: [
                "Compliance Obligations",
                "Audit Evidence",
                "Policy State",
                "Finding Records",
              ],
              typicalSourceSystems: [
                "GRC Platform",
                "BSS/OSS",
                "Network OSS",
                "Document Management",
              ],
            },
          ],
          kpis: [
            "Security incident count",
            "Compliance audit pass rate (%)",
            "Time to patch critical vulnerabilities (hours)",
            "Managed security revenue ($)",
            "DDoS mitigation response time (seconds)",
          ],
          personas: [
            "Chief Information Security Officer",
            "Head of Compliance",
            "Head of Security Product",
            "Chief Technology Officer",
          ],
        },
      ],
    },
  ],
};
