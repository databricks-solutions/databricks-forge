"use client";

import { Badge } from "@/components/ui/badge";
import { Table2, Clock, ExternalLink } from "lucide-react";
import Link from "next/link";

interface TableCardProps {
  fqn: string;
  domain?: string;
  tier?: string;
  freshness?: string;
  rowCount?: string;
  size?: string;
}

export function TableCard({ fqn, domain, tier, freshness, rowCount, size }: TableCardProps) {
  const encodedFqn = encodeURIComponent(fqn);

  return (
    <Link
      href={`/environment/table/${encodedFqn}`}
      className="flex items-center gap-3 rounded-md border bg-muted/30 p-3 text-sm transition-colors hover:bg-muted/60"
    >
      <Table2 className="size-4 shrink-0 text-blue-500" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-xs font-medium">{fqn}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {domain && (
            <Badge variant="secondary" className="text-[9px]">
              {domain}
            </Badge>
          )}
          {tier && (
            <Badge variant="outline" className="text-[9px]">
              {tier}
            </Badge>
          )}
          {freshness && (
            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <Clock className="size-2.5" />
              {freshness}
            </span>
          )}
          {rowCount && <span className="text-[10px] text-muted-foreground">{rowCount} rows</span>}
          {size && <span className="text-[10px] text-muted-foreground">{size}</span>}
        </div>
      </div>
      <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
    </Link>
  );
}
