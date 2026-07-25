const CANONICAL_KEY_SYNONYMS: Record<string, string[]> = {
  customer_id: ["customer_id", "customerid", "cust_id", "customer_key", "custkey"],
  order_id: ["order_id", "orderid", "ord_id", "order_key", "ordkey"],
  product_id: ["product_id", "productid", "sku_id", "item_id", "product_key"],
  supplier_id: ["supplier_id", "supplierid", "vendor_id", "supplier_key"],
  franchise_id: ["franchise_id", "franchiseid", "store_id", "location_id"],
  user_id: ["user_id", "userid", "member_id"],
  account_id: ["account_id", "accountid", "acct_id", "account_key"],
  employee_id: ["employee_id", "employeeid", "emp_id", "employee_key", "staff_id"],
  department_id: ["department_id", "departmentid", "dept_id", "department_key"],
  transaction_id: ["transaction_id", "transactionid", "txn_id", "trans_id", "transaction_key"],
  invoice_id: ["invoice_id", "invoiceid", "inv_id", "invoice_key"],
  payment_id: ["payment_id", "paymentid", "pmt_id", "payment_key"],
  region_id: ["region_id", "regionid", "territory_id", "area_id"],
  category_id: ["category_id", "categoryid", "cat_id", "category_key"],
  company_id: ["company_id", "companyid", "org_id", "organization_id", "company_key"],
  contract_id: ["contract_id", "contractid", "agreement_id", "contract_key"],
  campaign_id: ["campaign_id", "campaignid", "promo_id", "promotion_id"],
  shipment_id: ["shipment_id", "shipmentid", "delivery_id", "shipping_id"],
  warehouse_id: ["warehouse_id", "warehouseid", "wh_id", "warehouse_key"],
  project_id: ["project_id", "projectid", "proj_id", "project_key"],
  ticket_id: ["ticket_id", "ticketid", "case_id", "incident_id"],
  event_id: ["event_id", "eventid", "occurrence_id", "event_key"],
  policy_id: ["policy_id", "policyid", "pol_id", "policy_key"],
  claim_id: ["claim_id", "claimid", "claim_key"],
  session_id: ["session_id", "sessionid", "sess_id"],
  channel_id: ["channel_id", "channelid", "channel_key"],
  vendor_id: ["vendor_id", "vendorid", "vendor_key"],
  branch_id: ["branch_id", "branchid", "branch_key", "office_id"],
};

export function canonicalKeyGroups(): Record<string, string[]> {
  return CANONICAL_KEY_SYNONYMS;
}

/**
 * Check whether two tables share a join-key column, first via the explicit
 * synonym dictionary then via a generic `_id` / `_key` suffix match.
 */
export function tableHasSynonymPair(
  leftColumns: Set<string>,
  rightColumns: Set<string>,
): { canonical: string; leftColumn: string; rightColumn: string } | null {
  for (const [canonical, variants] of Object.entries(CANONICAL_KEY_SYNONYMS)) {
    const left = variants.find((v) => leftColumns.has(v));
    const right = variants.find((v) => rightColumns.has(v));
    if (left && right) {
      return { canonical, leftColumn: left, rightColumn: right };
    }
  }

  // Generic fallback: if both tables share a column ending in _id or _key
  // with the exact same name, treat it as a join candidate.
  for (const col of leftColumns) {
    if ((col.endsWith("_id") || col.endsWith("_key")) && col !== "id" && rightColumns.has(col)) {
      return { canonical: col, leftColumn: col, rightColumn: col };
    }
  }

  return null;
}
