/**
 * Pass 0: Table Selection + Grouping
 *
 * Rule-based pass that groups tables into domains (respecting the 30-table
 * Genie space limit), applies customer overrides, and ranks tables by
 * use-case frequency and lineage centrality.
 */

import type { UseCase, MetadataSnapshot, MetricViewInfo } from "@/lib/domain/types";
import type { GenieEngineConfig } from "../types";
import { normalizeDomainLabel } from "../domain-normalization";
import { logger } from "@/lib/logger";

export interface DomainGroup {
  domain: string;
  subdomains: string[];
  tables: string[];
  metricViews: MetricViewInfo[];
  useCases: UseCase[];
}

const TABLE_FQN_REGEX = /^[a-zA-Z_]\w*\.[a-zA-Z_]\w*\.[a-zA-Z_]\w*$/;

export function runTableSelection(
  useCases: UseCase[],
  metadata: MetadataSnapshot,
  config: GenieEngineConfig,
): DomainGroup[] {
  const maxTables = config.maxTablesPerSpace;

  // Build override map: tableFqn -> targetDomain
  const overrideMap = new Map<string, string>();
  for (const o of config.tableGroupOverrides) {
    overrideMap.set(o.tableFqn.toLowerCase(), o.targetDomain);
  }

  // Group use cases by domain
  const domainMap = new Map<string, UseCase[]>();
  for (const uc of useCases) {
    const d = uc.domain || "Uncategorised";
    if (!domainMap.has(d)) domainMap.set(d, []);
    domainMap.get(d)!.push(uc);
  }

  // Collect tables per domain, considering overrides
  const domainTables = new Map<string, Set<string>>();
  const tableFrequency = new Map<string, number>();

  for (const [domain, ucs] of domainMap.entries()) {
    if (!domainTables.has(domain)) domainTables.set(domain, new Set());
    const tableSet = domainTables.get(domain)!;

    for (const uc of ucs) {
      for (const t of uc.tablesInvolved) {
        const clean = t.replace(/`/g, "");
        if (!TABLE_FQN_REGEX.test(clean)) continue;

        const overrideDomain = overrideMap.get(clean.toLowerCase());
        if (overrideDomain && overrideDomain !== domain) {
          // Table is overridden to a different domain
          if (!domainTables.has(overrideDomain)) domainTables.set(overrideDomain, new Set());
          domainTables.get(overrideDomain)!.add(clean);
        } else {
          tableSet.add(clean);
        }

        tableFrequency.set(clean, (tableFrequency.get(clean) ?? 0) + 1);
      }
    }
  }

  // Add tables from overrides that may not appear in use cases
  for (const override of config.tableGroupOverrides) {
    const domain = override.targetDomain;
    if (!domainTables.has(domain)) domainTables.set(domain, new Set());
    if (TABLE_FQN_REGEX.test(override.tableFqn)) {
      domainTables.get(domain)!.add(override.tableFqn);
    }
  }

  // Rank and truncate tables per domain
  const results: DomainGroup[] = [];

  for (const [domain, tableSet] of domainTables.entries()) {
    const ucs = domainMap.get(domain) ?? [];
    if (tableSet.size === 0 && ucs.length === 0) continue;

    // Sort tables: highest use-case frequency first
    const sortedTables = [...tableSet].sort((a, b) => {
      const freqA = tableFrequency.get(a) ?? 0;
      const freqB = tableFrequency.get(b) ?? 0;
      return freqB - freqA;
    });

    // Enforce table limit
    const selected = sortedTables.slice(0, maxTables);
    if (sortedTables.length > maxTables) {
      logger.warn("Domain exceeds max tables per space; truncating", {
        domain,
        totalTables: sortedTables.length,
        maxTables,
        droppedTables: sortedTables.slice(maxTables),
      });
    }

    // Find metric views in same catalog.schema
    const domainCatalogSchemas = new Set<string>();
    for (const fqn of selected) {
      const parts = fqn.split(".");
      if (parts.length >= 2) domainCatalogSchemas.add(`${parts[0]}.${parts[1]}`);
    }
    const metricViews = (metadata.metricViews ?? []).filter((mv) =>
      domainCatalogSchemas.has(`${mv.catalog}.${mv.schema}`),
    );

    // Collect subdomains
    const subdomains = [...new Set(ucs.map((uc) => uc.subdomain).filter(Boolean))];

    // Sort use cases by score
    const sorted = [...ucs].sort((a, b) => b.overallScore - a.overallScore);

    results.push({
      domain,
      subdomains,
      tables: selected,
      metricViews,
      useCases: sorted,
    });
  }

  // Merge groups whose normalized domain labels collide (e.g. "Procurement" and
  // "Supply" both normalize to "Supply Chain"). Without this, the persistence
  // layer hits a unique constraint on (run_id, domain).
  const mergedMap = new Map<string, DomainGroup>();
  for (const group of results) {
    const normalized = normalizeDomainLabel(group.domain);
    const existing = mergedMap.get(normalized);
    if (existing) {
      logger.info("Merging domain groups with same normalized label", {
        rawDomains: [existing.domain, group.domain],
        normalizedLabel: normalized,
      });
      const mergedTables = [...new Set([...existing.tables, ...group.tables])];
      const mergedSubdomains = [...new Set([...existing.subdomains, ...group.subdomains])];
      const mergedUseCases = [...existing.useCases, ...group.useCases].sort(
        (a, b) => b.overallScore - a.overallScore,
      );
      const mergedMetricViews = [
        ...existing.metricViews,
        ...group.metricViews.filter(
          (mv) =>
            !existing.metricViews.some(
              (e) =>
                `${e.catalog}.${e.schema}.${e.name}` === `${mv.catalog}.${mv.schema}.${mv.name}`,
            ),
        ),
      ];
      mergedMap.set(normalized, {
        domain: normalized,
        subdomains: mergedSubdomains,
        tables: mergedTables.slice(0, maxTables),
        metricViews: mergedMetricViews,
        useCases: mergedUseCases,
      });
    } else {
      mergedMap.set(normalized, { ...group, domain: normalized });
    }
  }

  const merged = [...mergedMap.values()];
  merged.sort((a, b) => b.useCases.length - a.useCases.length);
  return merged;
}
