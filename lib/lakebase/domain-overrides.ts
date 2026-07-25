/**
 * Lakebase CRUD for ForgeDomainOverride — manual domain/subdomain corrections
 * applied on read by lib/environment/domain-overrides.ts.
 *
 * Overrides are scan-scoped. Authorization is enforced at the API layer via the
 * scan guard; these helpers assume the caller already owns / can edit the scan.
 */

import { withPrisma } from "@/lib/prisma";
import type {
  DomainOverride,
  OverrideScope,
  OverrideAction,
  ScopedDomainOverride,
} from "@/lib/environment/domain-overrides";

const VALID_SCOPES: OverrideScope[] = ["table", "schema", "catalog"];
const VALID_ACTIONS: OverrideAction[] = ["remap", "evict"];

export function isValidScope(s: string): s is OverrideScope {
  return (VALID_SCOPES as string[]).includes(s);
}
export function isValidAction(a: string): a is OverrideAction {
  return (VALID_ACTIONS as string[]).includes(a);
}

export async function listDomainOverrides(scanId: string): Promise<DomainOverride[]> {
  return withPrisma(async (prisma) => {
    const rows = await prisma.forgeDomainOverride.findMany({
      where: { scanId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      scope: r.scope as OverrideScope,
      target: r.target,
      action: r.action as OverrideAction,
      newDomain: r.newDomain,
      newSubdomain: r.newSubdomain,
      createdByEmail: r.createdByEmail,
      createdAt: r.createdAt.toISOString(),
    }));
  });
}

/**
 * List domain overrides across ALL completed member scans of a program,
 * annotated with a scan-recency rank (later scan → higher rank) so program
 * roll-ups can apply "latest scan wins" precedence. Scan routes remain the sole
 * mutation surface; this is read-only aggregation.
 */
export async function listProgramDomainOverrides(
  programId: string,
): Promise<ScopedDomainOverride[]> {
  return withPrisma(async (prisma) => {
    const scans = await prisma.forgeEnvironmentScan.findMany({
      where: { programId, scanStatus: "complete" },
      select: { scanId: true, createdAt: true },
    });
    if (scans.length === 0) return [];
    const rankByScan = new Map<string, number>(
      scans.map((s) => [s.scanId, s.createdAt.getTime()]),
    );
    const rows = await prisma.forgeDomainOverride.findMany({
      where: { scanId: { in: scans.map((s) => s.scanId) } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => ({
      id: r.id,
      scope: r.scope as OverrideScope,
      target: r.target,
      action: r.action as OverrideAction,
      newDomain: r.newDomain,
      newSubdomain: r.newSubdomain,
      createdByEmail: r.createdByEmail,
      createdAt: r.createdAt.toISOString(),
      scanId: r.scanId,
      scanRank: rankByScan.get(r.scanId) ?? 0,
    }));
  });
}

export interface UpsertOverrideInput {
  scanId: string;
  scope: OverrideScope;
  target: string;
  action: OverrideAction;
  newDomain?: string | null;
  newSubdomain?: string | null;
  createdByEmail: string;
}

/**
 * Create or replace an override for (scanId, scope, target). Re-targeting the
 * same scope+target updates in place so a user can flip remap → evict (or move
 * a table to a different domain) without piling up duplicates.
 */
export async function upsertDomainOverride(input: UpsertOverrideInput): Promise<DomainOverride> {
  const { scanId, scope, target, action } = input;
  const newDomain = action === "remap" ? (input.newDomain?.trim() || null) : null;
  const newSubdomain = action === "remap" ? (input.newSubdomain?.trim() || null) : null;
  return withPrisma(async (prisma) => {
    const row = await prisma.forgeDomainOverride.upsert({
      where: { scan_override: { scanId, scope, target } },
      create: {
        scanId,
        scope,
        target,
        action,
        newDomain,
        newSubdomain,
        createdByEmail: input.createdByEmail,
      },
      update: {
        action,
        newDomain,
        newSubdomain,
        createdByEmail: input.createdByEmail,
      },
    });
    return {
      id: row.id,
      scope: row.scope as OverrideScope,
      target: row.target,
      action: row.action as OverrideAction,
      newDomain: row.newDomain,
      newSubdomain: row.newSubdomain,
      createdByEmail: row.createdByEmail,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

/** Delete one override by id, scoped to its scan. Returns true if a row was removed. */
export async function deleteDomainOverride(scanId: string, id: string): Promise<boolean> {
  return withPrisma(async (prisma) => {
    const res = await prisma.forgeDomainOverride.deleteMany({ where: { id, scanId } });
    return res.count > 0;
  });
}
