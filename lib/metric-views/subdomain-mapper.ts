/**
 * Maps subdomains to their constituent tables via use case metadata.
 *
 * Collects the union of `tablesInvolved` from all UseCase entries in each
 * subdomain, producing a focused table set for metric view generation.
 */

import type { UseCase, DataDomain } from "@/lib/domain/types";

export interface SubdomainTableGroup {
  domain: string;
  subdomain: string;
  tables: string[];
  useCases: UseCase[];
}

/**
 * Group use cases by subdomain and collect the union of tables involved.
 *
 * Falls back to domain-level grouping when subdomain is empty/missing.
 * Returns groups sorted by the number of use cases (descending) so the
 * most data-rich subdomains are processed first.
 */
export function mapSubdomainsToTables(
  useCases: UseCase[],
  dataDomains?: DataDomain[],
): SubdomainTableGroup[] {
  const groupKey = (uc: UseCase): string => {
    const sub = uc.subdomain?.trim();
    const dom = uc.domain?.trim();
    return sub ? `${dom}|||${sub}` : `${dom}|||${dom}`;
  };

  const groups = new Map<
    string,
    { domain: string; subdomain: string; tables: Set<string>; useCases: UseCase[] }
  >();

  for (const uc of useCases) {
    const key = groupKey(uc);
    let group = groups.get(key);
    if (!group) {
      const sub = uc.subdomain?.trim() || uc.domain?.trim() || "unknown";
      group = {
        domain: uc.domain?.trim() || "unknown",
        subdomain: sub,
        tables: new Set<string>(),
        useCases: [],
      };
      groups.set(key, group);
    }
    group.useCases.push(uc);
    for (const t of uc.tablesInvolved ?? []) {
      group.tables.add(t);
    }
  }

  // If dataDomains are available, backfill any tables that are in a domain
  // but weren't referenced by any use case
  if (dataDomains) {
    for (const dd of dataDomains) {
      const key = dd.subdomain ? `${dd.domain}|||${dd.subdomain}` : `${dd.domain}|||${dd.domain}`;
      const group = groups.get(key);
      if (group) {
        for (const t of dd.tables) {
          group.tables.add(t);
        }
      }
    }
  }

  return Array.from(groups.values())
    .map((g) => ({
      domain: g.domain,
      subdomain: g.subdomain,
      tables: Array.from(g.tables),
      useCases: g.useCases,
    }))
    .sort((a, b) => b.useCases.length - a.useCases.length);
}
