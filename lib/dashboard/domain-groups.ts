import type { UseCase } from "@/lib/domain/types";
import type { SemanticAssetManifest } from "@/lib/semantic-assets/types";

export interface DashboardDomainGroup {
  domain: string;
  subdomains: string[];
  useCases: UseCase[];
  tables: string[];
}

export function normalizeDashboardDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

export function selectDashboardDomainGroups(
  useCases: UseCase[],
  domainFilter?: string[],
): DashboardDomainGroup[] {
  const domainMap = new Map<string, DashboardDomainGroup>();
  for (const useCase of useCases) {
    const domain = useCase.domain.trim();
    const key = normalizeDashboardDomain(domain);
    if (!key) continue;
    if (!domainMap.has(key)) {
      domainMap.set(key, {
        domain,
        subdomains: [],
        useCases: [],
        tables: [],
      });
    }
    const group = domainMap.get(key)!;
    group.useCases.push(useCase);
    if (useCase.subdomain && !group.subdomains.includes(useCase.subdomain)) {
      group.subdomains.push(useCase.subdomain);
    }
    for (const fqn of useCase.tablesInvolved) {
      if (!group.tables.includes(fqn)) group.tables.push(fqn);
    }
  }

  const filterKeys = new Set((domainFilter ?? []).map(normalizeDashboardDomain).filter(Boolean));
  return [...domainMap.values()]
    .filter(
      (group) => filterKeys.size === 0 || filterKeys.has(normalizeDashboardDomain(group.domain)),
    )
    .sort((left, right) => right.useCases.length - left.useCases.length);
}

export function indexSemanticManifests(
  manifests: Record<string, SemanticAssetManifest>,
): Map<string, SemanticAssetManifest> {
  return new Map(
    Object.entries(manifests)
      .filter(
        ([domain, manifest]) =>
          manifest.version === "1" &&
          normalizeDashboardDomain(domain) === normalizeDashboardDomain(manifest.domain),
      )
      .map(([domain, manifest]) => [normalizeDashboardDomain(domain), manifest]),
  );
}

export function missingDashboardManifestDomains(
  groups: DashboardDomainGroup[],
  manifests: Record<string, SemanticAssetManifest>,
): string[] {
  const indexed = indexSemanticManifests(manifests);
  return groups
    .filter((group) => !indexed.has(normalizeDashboardDomain(group.domain)))
    .map((group) => group.domain);
}
