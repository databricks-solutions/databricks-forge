"use client";

import { Fragment, useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import {
  AlertTriangle,
  Building2,
  Check,
  ChevronRight,
  Crown,
  ListChecks,
  ShieldAlert,
  Users,
} from "lucide-react";

type ProfileData = {
  id: string;
  role: string;
  department: string;
  useCaseCount: number;
  totalValue: number;
  domains: string[];
  useCaseTypes: Record<string, number>;
  useCaseIds?: string[];
  changeComplexity: "low" | "medium" | "high" | null;
  isChampion: boolean;
  isSponsor: boolean;
  championRationale?: string | null;
  complexityRationale?: string | null;
  keyRisks?: string[];
};

/**
 * Minimal use-case info needed to resolve a stakeholder's useCaseIds to
 * something human-readable. Provided by the page so the drill-down can
 * stay a pure presentational component.
 */
export type StakeholderUseCaseLookup = {
  id: string;
  name: string;
  domain: string;
  valueMid: number;
};

type GroupMode = "role" | "department";

const COMPLEXITY_CONFIG: Record<string, { label: string; className: string }> = {
  low: {
    label: "Low",
    className: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30",
  },
  medium: {
    label: "Medium",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  },
  high: {
    label: "High",
    className: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  },
};

export function StakeholderDrillDown({
  profiles,
  useCases = [],
}: {
  profiles: ProfileData[];
  useCases?: StakeholderUseCaseLookup[];
}) {
  const [mode, setMode] = useState<GroupMode>("role");
  const [expanded, setExpanded] = useState<string | null>(null);

  const sorted = useMemo(() => {
    return [...profiles].sort(
      (a, b) => b.totalValue - a.totalValue || b.useCaseCount - a.useCaseCount,
    );
  }, [profiles]);

  const useCaseById = useMemo(
    () => new Map(useCases.map((uc) => [uc.id, uc])),
    [useCases],
  );

  function hasDetail(p: ProfileData): boolean {
    return (
      Boolean(p.championRationale) ||
      Boolean(p.complexityRationale) ||
      (p.keyRisks?.length ?? 0) > 0 ||
      (p.useCaseIds?.length ?? 0) > 0
    );
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Users className="h-4 w-4 text-primary" />
          Full Stakeholder View
        </h2>
        <div className="flex gap-1 rounded-lg border p-0.5">
          <Button
            variant={mode === "role" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setMode("role")}
          >
            <Users className="mr-1 h-3 w-3" />
            By Role
          </Button>
          <Button
            variant={mode === "department" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setMode("department")}
          >
            <Building2 className="mr-1 h-3 w-3" />
            By Department
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-6" />
                <TableHead>{mode === "role" ? "Role" : "Department"}</TableHead>
                <TableHead>{mode === "role" ? "Department" : "Role"}</TableHead>
                <TableHead className="text-right">Use Cases</TableHead>
                <TableHead className="text-right">Est. Value</TableHead>
                <TableHead>Domains</TableHead>
                <TableHead>Complexity</TableHead>
                <TableHead className="w-20">Champion</TableHead>
                <TableHead className="w-20">Sponsor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((p) => {
                const expandable = hasDetail(p);
                const isOpen = expanded === p.id;
                const linked = (p.useCaseIds ?? [])
                  .map((id) => useCaseById.get(id))
                  .filter((u): u is StakeholderUseCaseLookup => Boolean(u))
                  .sort((a, b) => b.valueMid - a.valueMid);
                return (
                  <Fragment key={p.id}>
                    <TableRow
                      className={expandable ? "cursor-pointer hover:bg-muted/30" : ""}
                      onClick={() => {
                        if (!expandable) return;
                        setExpanded(isOpen ? null : p.id);
                      }}
                    >
                      <TableCell className="w-6">
                        {expandable ? (
                          <ChevronRight
                            className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                          />
                        ) : null}
                      </TableCell>
                      <TableCell className="font-medium">
                        {mode === "role" ? p.role : p.department}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {mode === "role" ? p.department : p.role}
                      </TableCell>
                      <TableCell className="text-right">{p.useCaseCount}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCurrency(p.totalValue)}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {p.domains.slice(0, 3).map((d) => (
                            <Badge key={d} variant="secondary" className="text-[10px]">
                              {d}
                            </Badge>
                          ))}
                          {p.domains.length > 3 && (
                            <Badge variant="secondary" className="text-[10px]">
                              +{p.domains.length - 3}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {p.changeComplexity ? (
                          <Badge
                            variant="outline"
                            className={COMPLEXITY_CONFIG[p.changeComplexity]?.className ?? ""}
                          >
                            {COMPLEXITY_CONFIG[p.changeComplexity]?.label ?? p.changeComplexity}
                          </Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {p.isChampion ? (
                          <Crown className="h-4 w-4 text-amber-500" />
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {p.isSponsor ? (
                          <Check className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                    {expandable && isOpen && (
                      <TableRow className="bg-muted/20 hover:bg-muted/20">
                        <TableCell />
                        <TableCell colSpan={8} className="py-3">
                          <StakeholderDetailPanel profile={p} linkedUseCases={linked} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  );
}

function StakeholderDetailPanel({
  profile,
  linkedUseCases,
}: {
  profile: ProfileData;
  linkedUseCases: StakeholderUseCaseLookup[];
}) {
  return (
    <div className="space-y-3 text-xs">
      {profile.championRationale && (
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Crown className="h-3 w-3 text-amber-500" /> Why this person is a champion
          </p>
          <p className="leading-relaxed text-foreground">{profile.championRationale}</p>
        </div>
      )}

      {profile.complexityRationale && (
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <ShieldAlert className="h-3 w-3 text-primary" /> Change complexity rationale
          </p>
          <p className="leading-relaxed text-foreground">{profile.complexityRationale}</p>
        </div>
      )}

      {(profile.keyRisks?.length ?? 0) > 0 && (
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <AlertTriangle className="h-3 w-3 text-red-500" /> Key organisational risks
          </p>
          <ul className="list-disc space-y-0.5 pl-4 leading-relaxed text-foreground">
            {profile.keyRisks!.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {linkedUseCases.length > 0 && (
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <ListChecks className="h-3 w-3 text-primary" /> Linked use cases (
            {linkedUseCases.length})
          </p>
          <div className="overflow-hidden rounded-md border bg-background/50">
            <table className="w-full">
              <tbody>
                {linkedUseCases.map((uc) => (
                  <tr key={uc.id} className="border-b last:border-b-0">
                    <td className="px-3 py-1.5 text-foreground">{uc.name}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{uc.domain}</td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                      {formatCurrency(uc.valueMid)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
