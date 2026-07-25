export function normalizeDomainLabel(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (!value) return "Analytics";
  if (/(customer|client|consumer|crm)/.test(value)) return "Customer Insights";
  if (/(sales|revenue|order|commerce)/.test(value)) return "Sales Analytics";
  if (/(supply|supplier|vendor|inventory|procurement)/.test(value)) return "Supply Chain";
  if (/(finance|billing|payment|invoice)/.test(value)) return "Finance";
  if (/(marketing|campaign|attribution)/.test(value)) return "Marketing";
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function inferNormalizedDomainFromTables(tables: string[], fallback = "Analytics"): string {
  const schemas = tables.map((t) => t.split(".")[1]).filter(Boolean);
  if (schemas.length === 0) return normalizeDomainLabel(fallback);
  const counts = new Map<string, number>();
  for (const s of schemas) counts.set(s, (counts.get(s) ?? 0) + 1);
  let best = schemas[0];
  let bestCount = 0;
  for (const [schema, count] of counts.entries()) {
    if (count > bestCount) {
      best = schema;
      bestCount = count;
    }
  }
  return normalizeDomainLabel(best);
}
