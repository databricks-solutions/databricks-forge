import type { IndustryOutcome } from "./index";

export const INSURANCE: IndustryOutcome = {
  id: "insurance",
  name: "Insurance",
  subVerticals: [
    "Life Insurance",
    "Property & Casualty",
    "Health Insurance",
    "Reinsurance",
    "InsurTech",
  ],
  suggestedDomains: [
    "Underwriting",
    "Claims",
    "Risk & Compliance",
    "Marketing",
    "Customer Experience",
    "Operations",
  ],
  suggestedPriorities: [
    "Increase Revenue",
    "Mitigate Risk",
    "Reduce Cost",
    "Enhance Experience",
    "Optimize Operations",
  ],
  objectives: [
    {
      name: "Drive Growth",
      whyChange:
        "Insurers must accelerate data transformation driven by rising consumer expectations, competition from insurtechs, and new data sources like IoT sensors and telematics. Cloud technology and advanced analytics are imperative for improving underwriting, pricing, and customer satisfaction.",
      priorities: [
        {
          name: "Distribution Optimization",
          useCases: [
            {
              name: "Distribution Data Model",
              description:
                "Consolidate data from multiple brokerage systems into a common data model for unified reporting and insights.",
              typicalDataEntities: [
                "Producer Data",
                "Commission Records",
                "Policy Placements",
                "Channel Performance",
              ],
              typicalSourceSystems: [
                "Agency Management System",
                "Broker Portals",
                "Policy Admin System",
              ],
            },
            {
              name: "Producer Analysis",
              description:
                "Analyze broker and agent performance to optimize sales channel effectiveness and commission structures.",
              typicalDataEntities: [
                "Producer Profiles",
                "Sales Metrics",
                "Commission Data",
                "Policy Production",
              ],
              typicalSourceSystems: [
                "Agency Management System",
                "Policy Admin System",
                "Commission System",
              ],
            },
            {
              name: "Client New/Lost Business Analysis",
              description:
                "Track and analyze new business acquisition and client attrition patterns across distribution channels.",
              typicalDataEntities: [
                "Policy Inforce",
                "New Business",
                "Lapse Data",
                "Renewal History",
              ],
              typicalSourceSystems: ["Policy Admin System", "Agency Management System", "CRM"],
            },
          ],
          kpis: [
            "Active clients",
            "Average premium",
            "New vs lost business by industry and carrier",
          ],
          personas: [
            "Chief Distribution Officer",
            "Chief Transformation Officer",
            "Chief Operating Officer",
          ],
        },
        {
          name: "Underwriting & Actuarial",
          useCases: [
            {
              name: "Smart Underwriting Triage",
              description:
                "Automate submission review and triage using AI to speed up underwriting decisions and improve risk selection.",
              businessValue: "33% increase in policy origination, 25% increase in productivity.",
              typicalDataEntities: [
                "Submission Data",
                "Risk Attributes",
                "Historical Decisions",
                "Loss History",
              ],
              typicalSourceSystems: [
                "Policy Admin System",
                "Underwriting Workstation",
                "External Data Providers",
              ],
            },
            {
              name: "Touchless Underwriting",
              description:
                "Enable end-to-end digital underwriting for standard risks, reducing manual intervention by over 25%.",
              typicalDataEntities: [
                "Application Data",
                "Risk Scores",
                "Product Rules",
                "Automated Decisions",
              ],
              typicalSourceSystems: [
                "Policy Admin System",
                "Underwriting Engine",
                "External Data Providers",
              ],
            },
            {
              name: "Telematics-Based Pricing",
              description:
                "Leverage IoT and telematics data for usage-based insurance pricing that rewards good behavior.",
              typicalDataEntities: [
                "Driving Behavior Data",
                "Mileage",
                "Trip Patterns",
                "Risk Scores",
              ],
              typicalSourceSystems: [
                "Telematics Platform",
                "Policy Admin System",
                "Claims Management System",
              ],
            },
            {
              name: "Actuarial Modeling Automation",
              description:
                "Accelerate actuarial modeling with ML to improve pricing accuracy and reduce time to market for new products.",
              typicalDataEntities: [
                "Loss Triangles",
                "Exposure Data",
                "Rating Factors",
                "Model Outputs",
              ],
              typicalSourceSystems: [
                "Policy Admin System",
                "Actuarial Platform",
                "Claims Management System",
              ],
            },
          ],
          kpis: [
            "Combined ratio improvement",
            "Underwriting efficiency (15% target)",
            "Policy origination rate",
          ],
          personas: [
            "Chief Underwriting Officer",
            "Chief Actuary",
            "Head of Underwriting Experience",
          ],
        },
        {
          name: "Hyper Personalization & Lead Management",
          useCases: [
            {
              name: "Customer 360 for Insurance",
              description:
                "Build unified customer profiles across all lines of business to enable personalized product recommendations and next-best-action.",
              typicalDataEntities: [
                "Customer Profiles",
                "Policy Holdings",
                "Interaction History",
                "Product Affinity",
              ],
              typicalSourceSystems: ["Policy Admin System", "CRM", "Claims Management System"],
            },
            {
              name: "Churn Prediction and Retention",
              description:
                "Use ML models to predict policy churn and implement proactive retention strategies.",
              typicalDataEntities: [
                "Policy Inforce",
                "Renewal History",
                "Engagement Metrics",
                "Churn Risk Scores",
              ],
              typicalSourceSystems: ["Policy Admin System", "CRM", "Customer Portal"],
            },
            {
              name: "Cross-Sell and Upsell",
              description:
                "Identify cross-sell and upsell opportunities across insurance product lines using behavioral analytics.",
              typicalDataEntities: [
                "Policy Holdings",
                "Customer Demographics",
                "Propensity Scores",
                "Product Catalog",
              ],
              typicalSourceSystems: ["Policy Admin System", "CRM", "Product Management System"],
            },
          ],
          kpis: ["Customer lifetime value", "Cross-sell rate", "Customer retention rate"],
          personas: ["Chief Marketing Officer", "Head of Customer Experience", "Head of Digital"],
        },
      ],
    },
    {
      name: "Protect the Firm",
      whyChange:
        "Insurers face rising fraud costs, evolving regulatory requirements, and increasing cyber threats. AI-powered detection, automated compliance, and robust cybersecurity are essential to protect revenue and maintain customer trust.",
      priorities: [
        {
          name: "Claims & Fraud Prevention",
          useCases: [
            {
              name: "Claims Fraud Detection",
              description:
                "Use ML and network analytics to detect fraudulent claims patterns and reduce loss ratios.",
              typicalDataEntities: [
                "Claims History",
                "Policy Details",
                "Customer Profiles",
                "Provider Networks",
              ],
              typicalSourceSystems: [
                "Claims Management System",
                "Policy Admin System",
                "Fraud Detection Engine",
              ],
            },
            {
              name: "Automated Claims Processing",
              description:
                "Automate claims intake, assessment, and settlement using AI to reduce processing time and improve accuracy.",
              typicalDataEntities: [
                "Claims Data",
                "Policy Coverage",
                "Damage Assessments",
                "Settlement History",
              ],
              typicalSourceSystems: [
                "Claims Management System",
                "Policy Admin System",
                "Document Management",
              ],
            },
            {
              name: "Subrogation Recovery Optimization",
              description:
                "Identify subrogation opportunities using analytics to recover costs from third parties.",
            },
          ],
          kpis: ["Fraud detection rate", "Claims processing time", "Loss ratio improvement"],
          personas: ["Head of Claims", "Head of Fraud Prevention", "Chief Risk Officer"],
        },
        {
          name: "Regulatory Compliance",
          useCases: [
            {
              name: "Regulatory Reporting Automation",
              description:
                "Automate regulatory submissions and reporting processes across multiple jurisdictions.",
              typicalDataEntities: [
                "Regulatory Data",
                "Policy Summaries",
                "Claims Data",
                "Financial Reports",
              ],
              typicalSourceSystems: [
                "Policy Admin System",
                "Claims Management System",
                "Financial Consolidation",
              ],
            },
            {
              name: "Solvency Monitoring",
              description:
                "Monitor solvency ratios and capital adequacy in real-time to ensure compliance with Solvency II and local regulations.",
              typicalDataEntities: [
                "Capital Positions",
                "Risk Exposures",
                "Asset Liability Data",
                "Regulatory Ratios",
              ],
              typicalSourceSystems: [
                "General Ledger",
                "Asset Management",
                "Risk Management Platform",
              ],
            },
          ],
          kpis: ["Regulatory compliance rate", "Reporting timeliness", "Audit findings reduction"],
          personas: ["Chief Compliance Officer", "Chief Risk Officer", "Chief Financial Officer"],
        },
      ],
    },
    {
      name: "Operate Efficiently",
      whyChange:
        "Operational efficiency is critical for insurers facing margin pressure. Automation of back-office processes, intelligent channel optimization, and AI-powered analytics drive cost reduction and improved service delivery.",
      priorities: [
        {
          name: "Back/Middle Office Automation",
          useCases: [
            {
              name: "Document Intelligence",
              description:
                "Extract and classify information from policy documents, claims forms, and correspondence using AI.",
            },
            {
              name: "Policy Administration Automation",
              description:
                "Automate policy lifecycle management from issuance through renewal and cancellation.",
            },
          ],
          kpis: [
            "Straight-through processing rate",
            "Cost per policy",
            "Processing time reduction",
          ],
          personas: ["Chief Operating Officer", "Head of Operations", "Head of IT"],
        },
      ],
    },
  ],
};
