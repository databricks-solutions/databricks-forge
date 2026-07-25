"use client";

/**
 * Company -> domain -> canonical entity -> table tree for the Estate Overview.
 * Pure presentational: takes a prebuilt EstateTree and renders collapsible
 * domains and entities with readiness + tier badges.
 */

import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, ChevronDown, Boxes, Table2 } from "lucide-react";
import type { EstateTree, EstateTreeEntity } from "@/lib/domain/estate-tree";

function readinessBadge(entity: EstateTreeEntity) {
  if (entity.readiness == null) return null;
  const variant =
    entity.readiness === "ready"
      ? "default"
      : entity.readiness === "needs_work"
        ? "secondary"
        : "destructive";
  const label =
    entity.readiness === "ready"
      ? "Ready"
      : entity.readiness === "needs_work"
        ? "Needs work"
        : "Missing";
  return (
    <Badge variant={variant}>
      {label}
      {typeof entity.readinessScore === "number" ? ` ${entity.readinessScore}` : ""}
    </Badge>
  );
}

function tierBadge(tier: string | null) {
  if (!tier) return <Badge variant="outline">untiered</Badge>;
  return <Badge variant="outline">{tier}</Badge>;
}

function EntityNode({ entity }: { entity: EstateTreeEntity }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ml-4 border-l pl-3">
      <button
        className="flex w-full items-center gap-1 py-1 text-left text-sm hover:underline"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Boxes className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium">{entity.name}</span>
        <span className="text-muted-foreground">({entity.tables.length})</span>
        <span className="ml-auto">{readinessBadge(entity)}</span>
      </button>
      {entity.description && (
        <p className="text-muted-foreground ml-5 pb-1 text-xs">{entity.description}</p>
      )}
      {open && (
        <ul className="ml-5 space-y-0.5 pb-2">
          {entity.tables.map((t) => (
            <li key={t.fqn} className="flex items-center gap-2 text-xs">
              <Table2 className="h-3 w-3 text-muted-foreground" />
              <span className="font-mono">{t.tableName}</span>
              {tierBadge(t.tier)}
              {!t.hasComment && (
                <span className="text-amber-600 dark:text-amber-400">no description</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DomainNode({
  domain,
  entities,
  tableCount,
}: {
  domain: string;
  entities: EstateTreeEntity[];
  tableCount: number;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-md border p-2">
      <button
        className="flex w-full items-center gap-2 text-left font-semibold"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {domain}
        <span className="text-muted-foreground text-sm font-normal">
          · {entities.filter((e) => e.name !== "Ungrouped tables").length} entities · {tableCount}{" "}
          tables
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          {entities.map((e) => (
            <EntityNode key={e.name} entity={e} />
          ))}
        </div>
      )}
    </div>
  );
}

export function EstateTreeView({ tree }: { tree: EstateTree }) {
  if (tree.domains.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        No tables found for this program yet. Run the scan sequence to populate the estate.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-sm">
        {tree.domains.length} domains · {tree.entityCount} canonical entities · {tree.tableCount}{" "}
        tables
        {tree.unassignedTableCount > 0 ? ` · ${tree.unassignedTableCount} ungrouped` : ""}
      </p>
      {tree.domains.map((d) => (
        <DomainNode key={d.domain} domain={d.domain} entities={d.entities} tableCount={d.tableCount} />
      ))}
    </div>
  );
}
