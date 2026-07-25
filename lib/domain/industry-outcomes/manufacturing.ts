import type { IndustryOutcome } from "./index";

export const MANUFACTURING: IndustryOutcome = {
  id: "manufacturing",
  name: "Manufacturing & Automotive",
  subVerticals: [
    "Automotive & Mobility",
    "Industrial Machinery",
    "Semiconductors & High-Tech",
    "Chemicals & Materials",
    "Aerospace & Defense",
  ],
  suggestedDomains: [
    "Manufacturing",
    "Supply Chain",
    "Engineering",
    "Operations",
    "Customer Experience",
    "Finance",
  ],
  suggestedPriorities: [
    "Optimize Operations",
    "Reduce Cost",
    "Drive Innovation",
    "Increase Revenue",
    "Achieve ESG",
  ],
  objectives: [
    {
      name: "Connected Products",
      whyChange:
        "Service-based offerings contribute over 60% of manufacturing operating profits while accounting for only 30% of offerings. Connected products generate vast data that can be monetized through outcome-based offerings, with 4x higher enterprise value per dollar of revenue.",
      priorities: [
        {
          name: "Connected Product Analytics",
          useCases: [
            {
              name: "Predictive Maintenance",
              description:
                "Use sensor data to predict equipment failures and schedule proactive maintenance, reducing downtime and extending asset life.",
              businessValue:
                "$30-35M bottom line impact through real-time machine data access for predicting issues.",
              typicalDataEntities: [
                "IoT Sensor Readings",
                "Equipment Maintenance History",
                "Asset Registry",
              ],
              typicalSourceSystems: ["SCADA/Historian", "CMMS", "ERP"],
            },
            {
              name: "Remote Monitoring and Diagnostics",
              description:
                "Enable real-time monitoring and diagnostics of products in the field, reducing service costs and improving uptime.",
              typicalDataEntities: [
                "Telemetry Data",
                "Fault Codes",
                "Asset Configuration",
                "Service History",
              ],
              typicalSourceSystems: ["IoT Platform", "Product Cloud", "CMMS"],
            },
            {
              name: "Product Feature Usage Analytics",
              description:
                "Analyze how customers use products to inform design improvements and tailor offerings.",
              typicalDataEntities: [
                "Feature Usage Events",
                "Product Configuration",
                "Customer Segments",
                "Usage Aggregates",
              ],
              typicalSourceSystems: ["Product Cloud", "IoT Platform", "CRM"],
            },
            {
              name: "Warranty Cost Optimization",
              description:
                "Optimize warranty claims by analyzing product performance data to identify patterns leading to high warranty expenses.",
            },
          ],
          kpis: [
            "Downtime reduction (%)",
            "Service response time",
            "First-time fix rate (%)",
            "Customer satisfaction (CSAT)",
          ],
          personas: [
            "Chief Digital Officer",
            "VP Connected Products/Services",
            "Head of Product Innovation",
          ],
        },
      ],
    },
    {
      name: "Industrial AI",
      whyChange:
        "Industrial productivity has plateaued while costs increase. 99% of industrial data is wasted. 65% of manufacturing leaders see data issues as the main challenge for AI adoption. The role of data and AI is to increase automation and make the workforce more efficient.",
      priorities: [
        {
          name: "Manufacturing Intelligence",
          useCases: [
            {
              name: "Predictive Quality Control",
              description:
                "Detect and mitigate product defects in real-time during manufacturing using advanced analytics and computer vision.",
              businessValue: "20-40% reduction in defect rate.",
              typicalDataEntities: [
                "In-Line Sensor Data",
                "Quality Inspections",
                "Process Parameters",
                "Defect Classifications",
              ],
              typicalSourceSystems: ["MES", "SCADA", "Quality Management System"],
            },
            {
              name: "Root Cause Analysis",
              description:
                "Identify complex, non-local factors contributing to sub-optimal performance through multi-dimensional data correlation.",
            },
            {
              name: "Production Scheduling Optimization",
              description:
                "Dynamically optimize manufacturing workflows by balancing demand forecasts, resource availability, and operational constraints.",
            },
            {
              name: "Digital Twins for Manufacturing",
              description:
                "Create high-fidelity digital simulations to model and analyze performance variations across production scenarios.",
            },
            {
              name: "Energy Use Efficiency",
              description:
                "Optimize energy consumption through granular metering, benchmarking, and identification of inefficiencies.",
              businessValue: "15-25% reduction in energy costs.",
            },
          ],
          kpis: [
            "Downtime reduction (30-50%)",
            "Defect rate reduction (20-40%)",
            "Production throughput increase (10-20%)",
            "Energy savings (15-25%)",
          ],
          personas: [
            "VP Manufacturing",
            "Head of Quality",
            "Industrial AI Leader",
            "Smart Factory Leader",
          ],
        },
      ],
    },
    {
      name: "Digital Supply Chain",
      whyChange:
        "Supply chains are responsible for 50-70% of manufacturing operating costs. Manual processes increase supply chain costs by up to 15% and account for 71% of supply chain errors. Real-time AI-driven optimization is essential.",
      priorities: [
        {
          name: "Supply Chain Optimization",
          useCases: [
            {
              name: "Demand Forecasting",
              description:
                "Analyze historical data and market trends to accurately predict future product demand using ML models.",
              businessValue: "30-50% improvement in forecast accuracy.",
              typicalDataEntities: [
                "Sales History",
                "Order Book",
                "Market Indicators",
                "Seasonality",
              ],
              typicalSourceSystems: ["ERP", "Demand Planning System", "CRM"],
            },
            {
              name: "Inventory Optimization",
              description:
                "Automate inventory replenishment based on AI-driven safety level calculations and demand sensing.",
              businessValue: "25% reduction in inventory carrying costs.",
            },
            {
              name: "Order Processing Automation",
              description:
                "Deploy AI agents to automate order processing, reducing administrative costs and improving accuracy.",
              businessValue: "80%+ cost savings in order entry.",
            },
            {
              name: "Supplier Risk Monitoring",
              description:
                "Develop n-tier supplier maps using internal and external data to assess and mitigate supply chain risks.",
            },
            {
              name: "Logistics Optimization",
              description:
                "Optimize transportation routes, carrier selection, and load planning for improved efficiency and reduced costs.",
              businessValue:
                "15% reduction in logistics costs, 42% improvement in logistics costs through ML-optimized routing.",
            },
          ],
          kpis: [
            "OTD/OTIF performance (7-10% improvement)",
            "Inventory carrying costs (25% reduction)",
            "Order cycle time (50% reduction)",
            "Demand forecast accuracy (30-50% improvement)",
          ],
          personas: ["Chief Supply Chain Officer", "VP Demand Planning", "VP Procurement"],
        },
      ],
    },
    {
      name: "Engineering & R&D Transformation",
      whyChange:
        "Companies must rapidly develop and iterate on new products. Emerging technologies like GenAI, digital twins, and simulation tools enable smarter design, testing, and iteration.",
      priorities: [
        {
          name: "R&D Innovation",
          useCases: [
            {
              name: "Design Space Exploration",
              description:
                "Optimize product design by evaluating multiple parameters and constraints using simulations, generative design, and predictive analytics.",
              typicalDataEntities: [
                "Design Parameters",
                "Simulation Results",
                "Material Properties",
                "Constraints",
              ],
              typicalSourceSystems: ["PLM", "CAD", "Simulation Platform"],
            },
            {
              name: "Product Testing Optimization",
              description:
                "Use ML to optimize testing strategies, reduce test cycles, and predict product performance from simulated data.",
              typicalDataEntities: [
                "Test Results",
                "Test Plans",
                "Simulation Outputs",
                "Performance Specs",
              ],
              typicalSourceSystems: ["PLM", "Test Management System", "Simulation Platform"],
            },
            {
              name: "Proprietary Coding Assistants",
              description:
                "Deploy AI-powered tools to assist R&D teams in coding tasks, improving developer productivity.",
            },
          ],
          kpis: ["Time to market", "R&D cost efficiency", "Design iteration speed"],
          personas: ["VP Engineering", "Head of R&D", "Chief Technology Officer"],
        },
      ],
    },
    {
      name: "Customer Experience",
      whyChange:
        "Manufacturers are realizing how critical seamless, personalized, proactive experiences are for building loyalty and boosting sales. Common data silos between product, manufacturing, supply chain, and customer must be unified.",
      priorities: [
        {
          name: "Customer Experience Optimization",
          useCases: [
            {
              name: "Customer 360 for Manufacturing",
              description:
                "Build unified customer profiles combining product, transaction, service, and engagement data beyond just CRM.",
              typicalDataEntities: [
                "Customer Profiles",
                "Order History",
                "Service Records",
                "Product Usage",
              ],
              typicalSourceSystems: ["CRM", "ERP", "Service Management", "IoT Platform"],
            },
            {
              name: "Next Best Commercial Offer",
              description:
                "Use AI to identify the optimal offer for each customer based on purchase history, product usage, and lifecycle stage.",
              typicalDataEntities: [
                "Customer Profiles",
                "Purchase History",
                "Product Catalog",
                "Propensity Scores",
              ],
              typicalSourceSystems: ["CRM", "ERP", "Product Cloud"],
            },
            {
              name: "Churn Modeling",
              description:
                "Predict customer churn and implement proactive retention strategies based on engagement patterns.",
              typicalDataEntities: [
                "Customer Profiles",
                "Engagement Metrics",
                "Contract Data",
                "Churn Risk Scores",
              ],
              typicalSourceSystems: ["CRM", "ERP", "Service Management"],
            },
          ],
          kpis: ["Customer satisfaction (NPS)", "Customer retention rate", "Cross-sell revenue"],
          personas: ["VP Sales", "Head of Customer Experience", "Chief Marketing Officer"],
        },
      ],
    },
  ],
};
