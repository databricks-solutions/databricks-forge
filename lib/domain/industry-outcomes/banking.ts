import type { IndustryOutcome } from "./index";

export const BANKING: IndustryOutcome = {
  id: "banking",
  name: "Banking & Payments",
  subVerticals: [
    "Retail Banking",
    "Commercial Banking",
    "Wealth Management",
    "Payments",
    "Capital Markets",
    "Digital / Neobank",
    "Broker & Intermediary",
  ],
  suggestedDomains: [
    "Finance",
    "Risk & Compliance",
    "Marketing",
    "Operations",
    "Customer Experience",
    "Lending",
  ],
  suggestedPriorities: ["Increase Revenue", "Mitigate Risk", "Reduce Cost", "Enhance Experience"],
  objectives: [
    {
      name: "Drive Growth",
      whyChange:
        "Banking is being reshaped by fintech disruptors, open banking mandates, and digital-first customer expectations. Both large and mid-tier banks must modernize payment systems, leverage AI for hyper-personalized services, optimise broker and digital channels, and unify fragmented customer data across brands while ensuring compliance.",
      priorities: [
        {
          name: "Hyper Personalization & Lead Management",
          useCases: [
            {
              name: "Prospecting & Campaign Development",
              description:
                "Utilize data analytics to identify potential customers and tailor marketing campaigns that resonate with their needs, enhancing engagement and conversion rates.",
              businessValue: "Increased customer acquisition through targeted campaigns.",
              typicalDataEntities: [
                "Customer Demographics",
                "Campaign Interactions",
                "Lead Scores",
                "Product Holdings",
              ],
              typicalSourceSystems: ["Salesforce CRM", "Adobe Campaign", "Core Banking Platform"],
            },
            {
              name: "Hyper Personalized Banking",
              description:
                "Leverage AI and customer data to deliver tailored banking experiences, improving customer satisfaction and loyalty through personalized insights and recommendations.",
              typicalDataEntities: [
                "Customer Profiles",
                "Transaction History",
                "Product Holdings",
                "Channel Interactions",
              ],
              typicalSourceSystems: ["Core Banking Platform", "CRM", "Digital Banking Platform"],
            },
            {
              name: "Cross Sell and Upsell Products",
              description:
                "Implement targeted strategies to offer complementary or upgraded products to existing customers, boosting revenue and customer retention.",
              typicalDataEntities: [
                "Customer Profiles",
                "Product Catalog",
                "Transaction History",
                "Propensity Scores",
              ],
              typicalSourceSystems: ["Core Banking Platform", "Product Management System", "CRM"],
            },
            {
              name: "Churn Prediction and Customer Segmentation",
              description:
                "Use ML models to predict customer churn and segment the customer base effectively, enabling proactive retention efforts and tailored service offerings.",
              typicalDataEntities: [
                "Customer Profiles",
                "Transaction History",
                "Engagement Metrics",
                "Churn Risk Scores",
              ],
              typicalSourceSystems: ["Core Banking Platform", "CRM", "Digital Banking Platform"],
            },
          ],
          kpis: [
            "Personalizing customer experiences",
            "Optimizing marketing spend",
            "Measuring campaign effectiveness",
          ],
          personas: [
            "Head of Consumer Banking",
            "Head of Marketing Strategy",
            "Head of Customer Experience",
            "Head of Digital Banking",
          ],
        },
        {
          name: "Cards & Payments Innovation",
          useCases: [
            {
              name: "Partner Offers and Rewards",
              description:
                "Leverage customer transaction data to deliver personalized offers, rewards, and cashback opportunities in collaboration with partner merchants.",
              typicalDataEntities: [
                "Transaction History",
                "Merchant Data",
                "Reward Programs",
                "Customer Preferences",
              ],
              typicalSourceSystems: ["Core Banking Platform", "Card Network", "Loyalty Platform"],
            },
            {
              name: "Transaction Enrichment",
              description:
                "Automate the classification of merchants from transaction data to deliver clearer insights into spending patterns.",
              typicalDataEntities: [
                "Transaction Data",
                "Merchant Classifications",
                "Spending Categories",
                "Customer Profiles",
              ],
              typicalSourceSystems: ["Core Banking Platform", "Card Network", "Merchant Directory"],
            },
            {
              name: "Open Banking & Consumer Data Right",
              description:
                "Enable consent-driven data sharing and action initiation under open banking and Consumer Data Right (CDR) regimes, connecting with accredited third parties, fintechs, and aggregators through standardised APIs.",
              typicalDataEntities: [
                "Account Data",
                "Transaction History",
                "Consent Records",
                "API Usage Logs",
                "CDR Data Holder Registers",
              ],
              typicalSourceSystems: [
                "Core Banking Platform",
                "Open Banking / CDR Gateway",
                "API Management Platform",
                "Consent Management System",
              ],
            },
            {
              name: "Data Monetization",
              description:
                "Generate new revenue streams by leveraging anonymized customer data to deliver insights and create value for third-party partners.",
              typicalDataEntities: [
                "Aggregated Customer Data",
                "Market Insights",
                "Consent Records",
                "Usage Analytics",
              ],
              typicalSourceSystems: ["Core Banking Platform", "Data Marketplace", "API Gateway"],
            },
          ],
          kpis: [
            "Increasing cardholder acquisition and retention",
            "Reducing processing costs",
            "Optimizing payment transaction flows",
          ],
          personas: [
            "Head of Consumer Banking",
            "Head of Payments / Operations",
            "Head of Innovation & Product Strategy",
            "Head of Digital Banking",
          ],
        },
        {
          name: "Loans & Origination",
          useCases: [
            {
              name: "Mortgage/Loan Origination Automation",
              description:
                "Streamline and automate loan onboarding and origination processes, reducing operational costs by 30-70% while enhancing the customer experience through faster approvals.",
              businessValue: "Up to 45% increase in conversion rates for loan offerings.",
              typicalDataEntities: [
                "Loan Applications",
                "Credit Reports",
                "Income Verification",
                "Property Valuations",
              ],
              typicalSourceSystems: [
                "Loan Origination System",
                "Credit Bureau",
                "Core Banking Platform",
              ],
            },
            {
              name: "Broker Channel Optimization",
              description:
                "Analyze broker performance, turnaround time SLAs, trail commission structures, and conversion funnels to maximize the broker-originated lending channel that accounts for the majority of mortgage volume at many banks.",
              businessValue:
                "Improved broker satisfaction and faster time-to-decision driving higher conversion rates.",
              typicalDataEntities: [
                "Broker Profiles",
                "Application Pipelines",
                "Turnaround Metrics",
                "Trail Commission Ledger",
                "Conversion Funnels",
              ],
              typicalSourceSystems: [
                "Loan Origination System",
                "Broker Portal",
                "Core Banking Platform",
                "Commission Management System",
              ],
            },
            {
              name: "Digital Onboarding & Straight-Through Processing",
              description:
                "Optimize the end-to-end digital account and loan opening journey by analyzing ID verification pass rates, drop-off points, and straight-through processing rates to increase digital acquisition.",
              businessValue:
                "Higher completion rates and lower cost-to-acquire through reduced manual intervention.",
              typicalDataEntities: [
                "Application Funnels",
                "ID Verification Results",
                "Drop-off Events",
                "Processing Times",
                "Channel Attribution",
              ],
              typicalSourceSystems: [
                "Digital Banking Platform",
                "Identity Verification Services",
                "Loan Origination System",
                "Core Banking Platform",
              ],
            },
          ],
          kpis: [
            "Loan conversion rates",
            "Broker turnaround time (hours to conditional approval)",
            "Digital straight-through processing rate",
            "Cost per originated loan",
          ],
          personas: [
            "Head of Lending",
            "Head of Consumer Banking",
            "Head of Broker Distribution",
            "Head of Digital Acquisition",
          ],
        },
        {
          name: "Business Banking & SMB",
          useCases: [
            {
              name: "SMB Cash Flow Lending",
              description:
                "Use real-time transaction data and cash flow analysis to assess creditworthiness for small business loans, replacing reliance on traditional financial statements with data-driven decisioning.",
              businessValue:
                "Faster credit decisions and broader access to finance for underserved small businesses.",
              typicalDataEntities: [
                "Business Transaction History",
                "Cash Flow Projections",
                "Industry Benchmarks",
                "Bureau Scores",
              ],
              typicalSourceSystems: [
                "Core Banking Platform",
                "Accounting Software Integrations",
                "Credit Bureau",
                "Open Banking / CDR Gateway",
              ],
            },
            {
              name: "Industry Benchmarking for SMBs",
              description:
                "Compare business customers against anonymized industry cohorts to surface advisory insights, product recommendations, and early warning signals for financial stress.",
              typicalDataEntities: [
                "Business Profiles",
                "Industry Classification Codes",
                "Aggregated Cohort Metrics",
                "Product Holdings",
              ],
              typicalSourceSystems: ["Core Banking Platform", "Industry Data Providers", "CRM"],
            },
            {
              name: "Trade Finance & Supply Chain Analytics",
              description:
                "Optimize trade finance decisioning using supply chain data, invoice patterns, counterparty risk assessments, and working capital cycle analysis.",
              typicalDataEntities: [
                "Invoice Data",
                "Supply Chain Relationships",
                "Counterparty Risk Profiles",
                "Working Capital Metrics",
              ],
              typicalSourceSystems: [
                "Core Banking Platform",
                "Trade Finance Platform",
                "ERP Systems",
                "Supply Chain Data Providers",
              ],
            },
          ],
          kpis: [
            "SMB loan book growth",
            "Time-to-decision for business lending",
            "Portfolio concentration risk",
            "Business customer NPS",
          ],
          personas: [
            "Head of Business Banking",
            "Head of SMB Lending",
            "Head of Trade Finance",
            "Head of Commercial Banking",
          ],
        },
      ],
    },
    {
      name: "Protect the Firm",
      whyChange:
        "Escalating regulatory pressures — from prudential capital requirements to conduct obligations around hardship and vulnerability — and severe financial and reputational risks of non-compliance drive the need for sophisticated, real-time data capabilities for AML, KYC, fraud detection, and margin management.",
      priorities: [
        {
          name: "Risk Management",
          useCases: [
            {
              name: "Dynamic Pricing",
              description:
                "Implement dynamic pricing strategies to adjust loan rates based on real-time risk assessments and customer profiles.",
              typicalDataEntities: [
                "Customer Risk Profiles",
                "Market Rates",
                "Product Terms",
                "Competitive Intelligence",
              ],
              typicalSourceSystems: ["Core Banking Platform", "Risk Engine", "Pricing System"],
            },
            {
              name: "Credit Decisioning",
              description:
                "Utilize advanced analytics and ML to streamline credit decisioning, improving accuracy in assessing borrower risk.",
              typicalDataEntities: [
                "Credit Reports",
                "Application Data",
                "Payment History",
                "Bureau Scores",
              ],
              typicalSourceSystems: [
                "Core Banking Platform",
                "Credit Bureau",
                "Loan Origination System",
              ],
            },
            {
              name: "Credit Limit Management",
              description:
                "Leverage data-driven insights to proactively assess and adjust credit limits based on customer behavior and creditworthiness.",
              typicalDataEntities: [
                "Credit Utilization",
                "Payment History",
                "Income Data",
                "Risk Scores",
              ],
              typicalSourceSystems: ["Core Banking Platform", "Credit Bureau", "Risk Engine"],
            },
            {
              name: "Debt Collection Optimization",
              description:
                "Employ predictive analytics to optimize debt collection strategies, identifying the most effective approaches for different customer segments.",
              typicalDataEntities: [
                "Delinquency History",
                "Customer Contact Data",
                "Payment Propensity",
                "Collection Outcomes",
              ],
              typicalSourceSystems: ["Core Banking Platform", "Collections System", "CRM"],
            },
            {
              name: "NIM & Deposit Pricing Optimization",
              description:
                "Model net interest margin sensitivity across product lines, optimize deposit pricing tiers, and forecast funding cost movements to protect margins — particularly critical for mid-tier banks where basis-point shifts materially impact profitability.",
              typicalDataEntities: [
                "Deposit Balances",
                "Product Rate Cards",
                "Funding Cost Curves",
                "Competitor Rate Intelligence",
                "Customer Price Sensitivity",
              ],
              typicalSourceSystems: [
                "Core Banking Platform",
                "Treasury Management System",
                "ALM Platform",
                "Market Data Feeds",
              ],
            },
          ],
          kpis: [
            "Assessing customer creditworthiness",
            "Managing portfolio risk under market fluctuations",
            "Ensuring data transparency for regulators",
            "NIM basis point improvement",
          ],
          personas: [
            "Head of Credit Risk Management",
            "Head of Consumer/Commercial Banking",
            "Head of Enterprise Risk Management",
            "Head of Balance Sheet Management",
          ],
        },
        {
          name: "Regulatory Compliance",
          useCases: [
            {
              name: "AML/KYC Automation",
              description:
                "Automate anti-money laundering and know-your-customer processes using AI to improve detection accuracy and reduce false positives.",
              typicalDataEntities: [
                "Customer Identity Data",
                "Transaction History",
                "Watchlist Matches",
                "Suspicious Activity Reports",
              ],
              typicalSourceSystems: [
                "Core Banking Platform",
                "AML/KYC Platform",
                "Identity Verification Services",
              ],
            },
            {
              name: "Regulatory Reporting Automation",
              description:
                "Streamline prudential reporting (APRA/Basel), transaction reporting (AUSTRAC/FinCEN), and conduct reporting with automated data pipelines, ensuring accuracy and timeliness of submissions across jurisdictions.",
              typicalDataEntities: [
                "Regulatory Data",
                "General Ledger",
                "Risk Exposures",
                "Transaction Summaries",
                "Capital Adequacy Returns",
              ],
              typicalSourceSystems: [
                "Core Banking Platform",
                "ERP",
                "Regulatory Reporting System",
                "Risk Data Warehouse",
              ],
            },
            {
              name: "Compliance Monitoring",
              description:
                "Implement real-time compliance monitoring systems that detect potential violations before they escalate.",
              typicalDataEntities: [
                "Transaction Logs",
                "Policy Rules",
                "Employee Actions",
                "Exception Reports",
              ],
              typicalSourceSystems: [
                "Core Banking Platform",
                "Compliance Management System",
                "Audit Logs",
              ],
            },
            {
              name: "Hardship & Vulnerability Detection",
              description:
                "Identify customers experiencing financial hardship or vulnerability early through transaction pattern analysis, behavioural signals, and payment stress indicators, enabling proactive outreach and meeting conduct obligations.",
              typicalDataEntities: [
                "Transaction Patterns",
                "Payment Arrears",
                "Customer Contact History",
                "Hardship Applications",
                "Behavioural Indicators",
              ],
              typicalSourceSystems: [
                "Core Banking Platform",
                "Collections System",
                "CRM",
                "Contact Center Platform",
              ],
            },
            {
              name: "Capital Adequacy & Stress Testing",
              description:
                "Automate regulatory capital calculations under Basel III/IV frameworks, run stress scenario modelling across credit, market, and operational risk, and optimize risk-weighted asset allocation.",
              typicalDataEntities: [
                "Risk-Weighted Assets",
                "Capital Ratios",
                "Stress Scenarios",
                "Loss-Given-Default Models",
                "Exposure Data",
              ],
              typicalSourceSystems: [
                "Core Banking Platform",
                "Risk Engine",
                "ALM Platform",
                "Regulatory Reporting System",
              ],
            },
          ],
          kpis: [
            "False positive rate reduction",
            "Regulatory submission timeliness",
            "Compliance cost reduction",
            "Hardship intervention rate (% identified before 90-day arrears)",
            "Capital buffer optimization",
          ],
          personas: [
            "Chief Compliance Officer",
            "Head of Regulatory Affairs",
            "Head of AML",
            "Head of Prudential Risk",
            "Head of Customer Vulnerability",
          ],
        },
        {
          name: "Fraud Prevention",
          useCases: [
            {
              name: "Real-Time Transaction Monitoring",
              description:
                "Monitor transactions in real-time to detect fraud and anomalies using AI models, reducing financial losses.",
              typicalDataEntities: [
                "Transaction Stream",
                "Customer Profiles",
                "Device Data",
                "Historical Patterns",
              ],
              typicalSourceSystems: [
                "Core Banking Platform",
                "Fraud Detection Engine",
                "Card Network",
              ],
            },
            {
              name: "Identity Fraud Detection",
              description:
                "Use ML to detect identity fraud and synthetic identities during account opening and transactions.",
              typicalDataEntities: [
                "Identity Documents",
                "Application Data",
                "Device Fingerprints",
                "Behavioral Biometrics",
              ],
              typicalSourceSystems: [
                "Core Banking Platform",
                "Identity Verification Services",
                "Fraud Detection Engine",
              ],
            },
            {
              name: "Network Fraud Analysis",
              description:
                "Apply graph analytics to uncover fraud rings and complex fraud networks across customer relationships.",
              typicalDataEntities: [
                "Customer Relationships",
                "Transaction Networks",
                "Account Linkages",
                "Shared Attributes",
              ],
              typicalSourceSystems: [
                "Core Banking Platform",
                "Fraud Detection Engine",
                "Graph Analytics Platform",
              ],
            },
          ],
          kpis: ["Fraud detection rate", "False positive reduction", "Loss prevention amount"],
          personas: [
            "Head of Fraud Prevention",
            "Chief Risk Officer",
            "Chief Information Security Officer",
          ],
        },
      ],
    },
    {
      name: "Operate Efficiently",
      whyChange:
        "Banks face pressure to reduce cost-to-income ratios while improving service quality across an increasingly complex multi-brand, multi-channel landscape. Automation, AI-powered analytics, granular cost attribution, and channel optimization are essential for both large and mid-tier banks to maintain competitiveness.",
      priorities: [
        {
          name: "CFO & Treasury",
          useCases: [
            {
              name: "Financial Reporting Automation",
              description:
                "Automate financial reporting with real-time data pipelines, improving accuracy and reducing manual effort.",
              typicalDataEntities: [
                "General Ledger",
                "Trial Balance",
                "Chart of Accounts",
                "Reconciliation Data",
              ],
              typicalSourceSystems: [
                "Core Banking Platform",
                "ERP",
                "Financial Consolidation System",
              ],
            },
            {
              name: "Liquidity Management",
              description:
                "Use predictive models to optimize liquidity management and cash flow forecasting across the organization.",
              typicalDataEntities: [
                "Cash Positions",
                "Funding Sources",
                "Liquidity Buffers",
                "Stress Scenarios",
              ],
              typicalSourceSystems: [
                "Core Banking Platform",
                "Treasury Management System",
                "ALM Platform",
              ],
            },
            {
              name: "Cost-to-Serve Analytics",
              description:
                "Build granular product-level and customer-level cost attribution models to identify which segments and products generate value versus consume margin, enabling informed decisions about portfolio simplification and investment.",
              typicalDataEntities: [
                "Activity-Based Costs",
                "Product P&L",
                "Customer Segment Profitability",
                "Operational Volumes",
              ],
              typicalSourceSystems: [
                "Core Banking Platform",
                "ERP",
                "Cost Allocation System",
                "Data Warehouse",
              ],
            },
          ],
          kpis: [
            "Reporting cycle time",
            "Forecast accuracy",
            "Cost-to-income ratio",
            "Product-level return on equity",
          ],
          personas: [
            "Chief Financial Officer",
            "Head of Treasury",
            "Head of Finance Operations",
            "Head of Strategic Planning",
          ],
        },
        {
          name: "Back/Middle Office Automation",
          useCases: [
            {
              name: "Intelligent Document Processing",
              description:
                "Use AI to extract, classify, and process information from unstructured documents like contracts, applications, and correspondence.",
              typicalDataEntities: [
                "Document Metadata",
                "Extracted Fields",
                "Classification Labels",
                "Workflow State",
              ],
              typicalSourceSystems: [
                "Document Management System",
                "Core Banking Platform",
                "Content Repository",
              ],
            },
            {
              name: "Process Mining and Optimization",
              description:
                "Analyze operational processes to identify bottlenecks and optimize workflows across back and middle office functions.",
              typicalDataEntities: [
                "Process Event Logs",
                "Workflow State",
                "Task Durations",
                "Resource Utilization",
              ],
              typicalSourceSystems: ["Core Banking Platform", "BPM/Workflow System", "ERP"],
            },
          ],
          kpis: ["Process automation rate", "Cost per transaction", "Error rate reduction"],
          personas: ["Chief Operating Officer", "Head of Operations", "Head of Transformation"],
        },
        {
          name: "Channel & Network Optimization",
          useCases: [
            {
              name: "Customer Service AI Agent",
              description:
                "Deploy AI agents to handle routine customer inquiries, reducing wait times and freeing human agents for complex issues.",
              typicalDataEntities: [
                "Customer Profiles",
                "Account Data",
                "Interaction History",
                "Knowledge Base",
              ],
              typicalSourceSystems: ["Core Banking Platform", "CRM", "Contact Center Platform"],
            },
            {
              name: "Channel Performance Analytics",
              description:
                "Analyze performance across digital and physical channels to optimize resource allocation and customer experience.",
              typicalDataEntities: [
                "Channel Interactions",
                "Transaction Volumes",
                "Customer Journeys",
                "Conversion Funnels",
              ],
              typicalSourceSystems: ["Digital Banking Platform", "Branch Systems", "CRM"],
            },
            {
              name: "Multi-Brand & Channel Attribution",
              description:
                "Resolve customer identities across brand portfolios, measure cross-brand cannibalization, and attribute acquisition and engagement to the correct brand and channel — essential for banks operating multiple retail brands.",
              typicalDataEntities: [
                "Unified Customer IDs",
                "Brand Affiliation",
                "Marketing Attribution",
                "Cross-Brand Activity",
                "NPS by Brand",
              ],
              typicalSourceSystems: [
                "Core Banking Platform",
                "CRM",
                "Marketing Platforms",
                "Digital Banking Platform",
                "Identity Resolution Engine",
              ],
            },
            {
              name: "Branch Network Analytics",
              description:
                "Analyze branch catchment areas, foot traffic trends, digital migration rates, and franchise or owner-manager performance to optimize the physical network and inform closure or transformation decisions.",
              typicalDataEntities: [
                "Branch Transaction Volumes",
                "Catchment Demographics",
                "Digital Adoption Rates",
                "Branch P&L",
                "Foot Traffic Data",
              ],
              typicalSourceSystems: [
                "Core Banking Platform",
                "Branch Systems",
                "Geospatial Data Providers",
                "HR / Workforce Systems",
              ],
            },
          ],
          kpis: [
            "First contact resolution rate",
            "Average handling time",
            "Customer satisfaction score",
            "Brand NPS delta",
            "Branch cost-to-serve",
          ],
          personas: [
            "Head of Customer Service",
            "Head of Digital Channels",
            "Chief Operating Officer",
            "Head of Network Strategy",
            "Head of Brand Management",
          ],
        },
      ],
    },
  ],
};
