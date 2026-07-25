import type { UseCase } from "@/lib/domain/types";
import { normalizeDomainLabel } from "@/lib/genie/domain-normalization";
import type { SemanticAssetManifest } from "@/lib/semantic-assets/types";

export interface DashboardDomainGroup {
  domain: string;
  subdomains: string[];
  useCases: UseCase[];
  tables: string[];
}

export function normalizeDashboardDomain(domain: string): string {
  if (!domain.trim()) return "";
  return normalizeDomainLabel(domain).toLowerCase();
}

export function selectDashboardDomainGroups(
  useCases: UseCase[],
  domainFilter?: string[],
): DashboardDomainGroup[] {
  const domainMap = new Map<string, DashboardDomainGroup>();
  for (const useCase of useCases) {
    const key = normalizeDashboardDomain(useCase.domain);
    if (!key) continue;
    if (!domainMap.has(key)) {
      domainMap.set(key, {
        domain: normalizeDomainLabel(useCase.domain),
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

/**
 * Index persisted Genie manifests by canonical domain key.
 *
 * The record key is the raw domain recorded on the Genie recommendation while
 * `manifest.domain` is the label the Genie engine emitted. Requiring the two to
 * agree in the *canonical* vocabulary -- not as identical raw strings -- is
 * intentional: `normalizeDomainLabel` deliberately collapses aliases such as
 * Procurement and Inventory into one Supply Chain bucket, so a recommendation
 * keyed "Procurement" legitimately carries a "Supply Chain" manifest. Comparing
 * raw labels here would reject those correct pairings, while comparing canonical
 * keys still rejects a manifest that belongs to a genuinely different bucket.
 */
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

/**
 * Resolve the active tracked dashboard that represents a domain.
 *
 * An exact label match wins so rows written with the canonical vocabulary keep
 * their existing behavior. The canonical key is only an upgrade fallback: rows
 * tracked before dashboard domains were canonicalized still carry a raw alias
 * such as "Procurement", and adopting them here is what makes a redeploy update
 * the pre-change asset in place instead of creating a duplicate dashboard.
 */
export function findTrackedDashboardForDomain<T extends { domain: string; status: string }>(
  tracked: T[],
  domain: string,
): T | undefined {
  // A blank label is not an identity, so it must never adopt a tracked row.
  if (!domain.trim()) return undefined;
  const active = tracked.filter((entry) => entry.status !== "trashed");
  const exact = active.find((entry) => entry.domain.toLowerCase() === domain.toLowerCase());
  if (exact) return exact;
  const canonicalKey = normalizeDashboardDomain(domain);
  if (!canonicalKey) return undefined;
  return active.find((entry) => normalizeDashboardDomain(entry.domain) === canonicalKey);
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
