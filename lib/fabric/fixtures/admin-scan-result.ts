/**
 * Mock Admin Scanner API response for dev/CI.
 *
 * Derived from real responses with PII scrubbed.
 * Activated via FABRIC_USE_FIXTURES=true env var.
 */

export const MOCK_ADMIN_SCAN_RESULT = {
  workspaces: [
    {
      id: "ws-001-sales",
      name: "Sales Analytics",
      state: "Active",
      type: "Workspace",
      datasets: [
        {
          id: "ds-001-revenue",
          name: "Revenue Model",
          configuredBy: "admin@contoso.com",
          tables: [
            {
              name: "Sales",
              columns: [
                { name: "OrderId", dataType: "Int64", isHidden: false },
                { name: "OrderDate", dataType: "DateTime", isHidden: false },
                { name: "CustomerId", dataType: "Int64", isHidden: false },
                { name: "ProductId", dataType: "Int64", isHidden: false },
                { name: "Quantity", dataType: "Int64", isHidden: false },
                { name: "UnitPrice", dataType: "Double", isHidden: false },
                { name: "Discount", dataType: "Double", isHidden: false },
                { name: "Revenue", dataType: "Double", isHidden: false },
                { name: "Region", dataType: "String", isHidden: false },
              ],
              measures: [
                {
                  name: "Total Revenue",
                  expression: "SUM(Sales[Revenue])",
                  description: "Sum of all revenue",
                },
                {
                  name: "Total Orders",
                  expression: "COUNTROWS(Sales)",
                  description: "Count of order rows",
                },
                {
                  name: "Avg Order Value",
                  expression: "DIVIDE([Total Revenue], [Total Orders], 0)",
                  description: "Average revenue per order",
                },
                {
                  name: "YoY Growth",
                  expression:
                    "VAR CurrentYear = [Total Revenue]\nVAR PriorYear = CALCULATE([Total Revenue], DATEADD(Calendar[Date], -1, YEAR))\nRETURN DIVIDE(CurrentYear - PriorYear, PriorYear, 0)",
                  description: "Year over year revenue growth",
                },
              ],
              isHidden: false,
            },
            {
              name: "Calendar",
              columns: [
                { name: "Date", dataType: "DateTime", isHidden: false },
                { name: "Year", dataType: "Int64", isHidden: false },
                { name: "Quarter", dataType: "String", isHidden: false },
                { name: "Month", dataType: "String", isHidden: false },
                { name: "MonthNumber", dataType: "Int64", isHidden: false },
                { name: "WeekDay", dataType: "String", isHidden: false },
              ],
              measures: [],
              isHidden: false,
            },
            {
              name: "Customers",
              columns: [
                { name: "CustomerId", dataType: "Int64", isHidden: false },
                { name: "CustomerName", dataType: "String", isHidden: false },
                { name: "Segment", dataType: "String", isHidden: false },
                { name: "City", dataType: "String", isHidden: false },
                { name: "Country", dataType: "String", isHidden: false },
              ],
              measures: [
                { name: "Customer Count", expression: "DISTINCTCOUNT(Customers[CustomerId])" },
              ],
              isHidden: false,
            },
            {
              name: "Products",
              columns: [
                { name: "ProductId", dataType: "Int64", isHidden: false },
                { name: "ProductName", dataType: "String", isHidden: false },
                { name: "Category", dataType: "String", isHidden: false },
                { name: "SubCategory", dataType: "String", isHidden: false },
                { name: "ListPrice", dataType: "Double", isHidden: false },
              ],
              measures: [],
              isHidden: false,
            },
          ],
          relationships: [
            {
              fromTable: "Sales",
              fromColumn: "OrderDate",
              toTable: "Calendar",
              toColumn: "Date",
              crossFilteringBehavior: "OneDirection",
            },
            {
              fromTable: "Sales",
              fromColumn: "CustomerId",
              toTable: "Customers",
              toColumn: "CustomerId",
              crossFilteringBehavior: "OneDirection",
            },
            {
              fromTable: "Sales",
              fromColumn: "ProductId",
              toTable: "Products",
              toColumn: "ProductId",
              crossFilteringBehavior: "OneDirection",
            },
          ],
          expressions: [
            {
              name: "Source",
              expression:
                'let\n  Source = Sql.Database("sqlserver.database.windows.net", "SalesDB")\nin\n  Source',
            },
          ],
          roles: [
            {
              name: "Regional Manager",
              members: [{ memberName: "managers@contoso.com" }],
              tablePermissions: [
                { name: "Sales", filterExpression: "[Region] = USERPRINCIPALNAME()" },
              ],
            },
          ],
          datasourceUsages: [],
          sensitivityLabel: { labelId: "general" },
        },
      ],
      reports: [
        {
          id: "rpt-001-exec",
          name: "Executive Revenue Dashboard",
          datasetId: "ds-001-revenue",
          reportType: "PowerBIReport",
          sensitivityLabel: { labelId: "general" },
        },
        {
          id: "rpt-002-regional",
          name: "Regional Sales Breakdown",
          datasetId: "ds-001-revenue",
          reportType: "PowerBIReport",
        },
      ],
      dashboards: [
        {
          id: "dash-001-kpi",
          displayName: "Sales KPI Dashboard",
          tiles: [
            { id: "tile-1", title: "Total Revenue", datasetId: "ds-001-revenue" },
            { id: "tile-2", title: "Orders by Region", datasetId: "ds-001-revenue" },
            { id: "tile-3", title: "YoY Growth Trend", datasetId: "ds-001-revenue" },
          ],
        },
      ],
      dataflows: [],
      datamarts: [],
    },
    {
      id: "ws-002-finance",
      name: "Finance Analytics",
      state: "Active",
      type: "Workspace",
      datasets: [
        {
          id: "ds-002-finance",
          name: "Financial Reporting",
          configuredBy: "finance@contoso.com",
          tables: [
            {
              name: "GeneralLedger",
              columns: [
                { name: "TransactionId", dataType: "String", isHidden: false },
                { name: "AccountCode", dataType: "String", isHidden: false },
                { name: "PostingDate", dataType: "DateTime", isHidden: false },
                { name: "Amount", dataType: "Decimal", isHidden: false },
                { name: "Department", dataType: "String", isHidden: false },
                { name: "CostCenter", dataType: "String", isHidden: false },
              ],
              measures: [
                {
                  name: "Net Income",
                  expression:
                    'CALCULATE(SUM(GeneralLedger[Amount]), GeneralLedger[AccountCode] >= "4000" && GeneralLedger[AccountCode] < "9000")',
                },
                {
                  name: "Total Expenses",
                  expression:
                    'CALCULATE(SUM(GeneralLedger[Amount]), GeneralLedger[AccountCode] >= "5000")',
                },
                {
                  name: "Budget Variance",
                  expression: "DIVIDE([Net Income] - [Budget Amount], [Budget Amount], 0)",
                },
              ],
              isHidden: false,
            },
            {
              name: "Budget",
              columns: [
                { name: "Period", dataType: "DateTime", isHidden: false },
                { name: "AccountCode", dataType: "String", isHidden: false },
                { name: "BudgetAmount", dataType: "Decimal", isHidden: false },
                { name: "Department", dataType: "String", isHidden: false },
              ],
              measures: [{ name: "Budget Amount", expression: "SUM(Budget[BudgetAmount])" }],
              isHidden: false,
            },
          ],
          relationships: [
            {
              fromTable: "GeneralLedger",
              fromColumn: "AccountCode",
              toTable: "Budget",
              toColumn: "AccountCode",
              crossFilteringBehavior: "OneDirection",
            },
          ],
          expressions: [],
          roles: [],
          datasourceUsages: [],
          sensitivityLabel: { labelId: "confidential" },
        },
      ],
      reports: [
        {
          id: "rpt-003-pnl",
          name: "P&L Report",
          datasetId: "ds-002-finance",
          reportType: "PowerBIReport",
          sensitivityLabel: { labelId: "confidential" },
        },
      ],
      dashboards: [],
      dataflows: [
        {
          objectId: "df-001",
          name: "Finance ETL",
          configuredBy: "finance@contoso.com",
          description: "Daily refresh of GL data",
        },
      ],
      datamarts: [],
    },
  ],
};

export const MOCK_WORKSPACES = MOCK_ADMIN_SCAN_RESULT.workspaces.map((ws) => ({
  id: ws.id,
  name: ws.name,
  state: ws.state,
  type: ws.type,
}));
