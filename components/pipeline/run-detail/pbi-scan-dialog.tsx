"use client";

import { Zap, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function PbiScanDialog({
  open,
  onOpenChange,
  scans,
  selectedScanId,
  onSelectScan,
  enriching,
  onEnrich,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scans: Array<{ id: string; label: string }>;
  selectedScanId: string | null;
  onSelectScan: (id: string | null) => void;
  enriching: boolean;
  onEnrich: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-violet-500" />
            Enrich with Power BI Scan
          </DialogTitle>
          <DialogDescription>
            Select a completed Fabric scan to analyse PBI overlap with this run&apos;s use cases.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {scans.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No completed Fabric scans found. Run a scan from the Fabric Hub first.
            </p>
          ) : (
            <Select
              value={selectedScanId ?? "__none__"}
              onValueChange={(v) => onSelectScan(v === "__none__" ? null : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a scan..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" disabled>
                  Select a scan...
                </SelectItem>
                {scans.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={!selectedScanId || enriching} onClick={onEnrich}>
              {enriching ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Enriching...
                </>
              ) : (
                "Enrich"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
