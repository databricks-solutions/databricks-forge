"use client";

/**
 * UI controls for manual domain overrides (remap / evict).
 *
 * `DomainOverrideMenu` lives in the table detail sheet: pick a domain to move a
 * table into, or remove it (or its schema/catalog) from the estate map.
 * `AdjustmentsButton` opens a dialog listing every active override for the scan
 * with an undo for each. All writes go through `/api/environment/[scanId]/overrides`.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SlidersHorizontal, Trash2, ArrowRightLeft } from "lucide-react";
import { catalogOf, schemaOf, shortName, UNCLASSIFIED } from "@/lib/environment/domain-explorer";
import type { DomainOverride, OverrideScope } from "@/lib/environment/domain-overrides";

const NEW_DOMAIN = "__new__";

async function postOverride(
  scanId: string,
  body: Omit<DomainOverride, "id" | "createdAt" | "createdByEmail">,
): Promise<boolean> {
  const resp = await fetch(`/api/environment/${scanId}/overrides`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return resp.ok;
}

export function DomainOverrideMenu({
  scanId,
  fqn,
  domains,
  currentDomain,
  onApplied,
}: {
  scanId: string;
  fqn: string;
  domains: string[];
  currentDomain: string | null;
  onApplied: () => void;
}) {
  const [target, setTarget] = useState<string>("");
  const [custom, setCustom] = useState("");
  const [evictScope, setEvictScope] = useState<OverrideScope>("table");
  const [busy, setBusy] = useState(false);

  const options = [...new Set(domains.filter((d) => d && d !== UNCLASSIFIED))].sort((a, b) =>
    a.localeCompare(b),
  );

  const remap = async () => {
    const newDomain = target === NEW_DOMAIN ? custom.trim() : target;
    if (!newDomain) {
      toast.error("Pick or name a domain to move this table into.");
      return;
    }
    if (newDomain === currentDomain) {
      toast.info("Table is already in that domain.");
      return;
    }
    setBusy(true);
    const ok = await postOverride(scanId, {
      scope: "table",
      target: fqn,
      action: "remap",
      newDomain,
    });
    setBusy(false);
    if (ok) {
      toast.success(`Moved ${shortName(fqn)} to ${newDomain}`);
      onApplied();
    } else {
      toast.error("Failed to remap table");
    }
  };

  const evict = async () => {
    const evictTarget =
      evictScope === "table" ? fqn : evictScope === "schema" ? schemaOf(fqn) : catalogOf(fqn);
    setBusy(true);
    const ok = await postOverride(scanId, {
      scope: evictScope,
      target: evictTarget,
      action: "evict",
    });
    setBusy(false);
    if (ok) {
      toast.success(`Removed ${evictTarget} from the estate map`);
      onApplied();
    } else {
      toast.error("Failed to remove from estate");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger className="h-8 flex-1 text-xs" aria-label="Move to domain">
            <SelectValue placeholder="Move to domain…" />
          </SelectTrigger>
          <SelectContent>
            {options.map((d) => (
              <SelectItem key={d} value={d} className="text-xs">
                {d}
              </SelectItem>
            ))}
            <SelectItem value={NEW_DOMAIN} className="text-xs">
              New domain…
            </SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" className="h-8" disabled={busy} onClick={remap}>
          <ArrowRightLeft className="mr-1 h-3.5 w-3.5" />
          Move
        </Button>
      </div>
      {target === NEW_DOMAIN && (
        <Input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="New domain name"
          className="h-8 text-xs"
        />
      )}

      <div className="flex items-center gap-2">
        <Select value={evictScope} onValueChange={(v) => setEvictScope(v as OverrideScope)}>
          <SelectTrigger className="h-8 flex-1 text-xs" aria-label="Remove scope">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="table" className="text-xs">
              This table
            </SelectItem>
            <SelectItem value="schema" className="text-xs">
              This schema ({schemaOf(fqn)})
            </SelectItem>
            <SelectItem value="catalog" className="text-xs">
              This catalog ({catalogOf(fqn)})
            </SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={evict}>
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          Remove
        </Button>
      </div>
    </div>
  );
}

export function AdjustmentsButton({
  count,
  overrides,
  scanId,
  onChanged,
}: {
  count: number;
  overrides: DomainOverride[];
  scanId: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const undo = async (id?: string) => {
    if (!id) return;
    setBusyId(id);
    try {
      const resp = await fetch(
        `/api/environment/${scanId}/overrides?id=${encodeURIComponent(id)}`,
        {
          method: "DELETE",
        },
      );
      if (!resp.ok) throw new Error();
      toast.success("Adjustment removed");
      onChanged();
    } catch {
      toast.error("Failed to remove adjustment");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 px-3 text-xs">
          <SlidersHorizontal className="mr-1 h-3.5 w-3.5" />
          Adjustments
          {count > 0 && (
            <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
              {count}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manual adjustments</DialogTitle>
          <DialogDescription>
            Corrections layered on top of the AI grouping. They persist with the scan and never
            change the underlying data — remove one to revert it.
          </DialogDescription>
        </DialogHeader>
        {overrides.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No adjustments yet. Open a table and use “Move to domain” or “Remove” to correct the
            map.
          </p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-auto">
            {overrides.map((o) => (
              <li
                key={o.id ?? `${o.scope}:${o.target}`}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {o.action}
                    </Badge>
                    <span className="truncate font-medium">{o.target}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {o.action === "remap"
                      ? `→ ${o.newDomain ?? ""}${o.newSubdomain ? ` / ${o.newSubdomain}` : ""}`
                      : `${o.scope} removed from estate map`}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 text-xs"
                  disabled={busyId === o.id}
                  onClick={() => undo(o.id)}
                >
                  Undo
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
