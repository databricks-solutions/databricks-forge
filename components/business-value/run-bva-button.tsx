"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import { Loader2, Play, AlertCircle } from "lucide-react";

interface RunSummary {
  runId: string;
  config: { businessName: string };
  status: string;
  createdAt: string;
}

export function RunBvaButton() {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/runs?limit=50");
      if (!res.ok) throw new Error("Failed to fetch runs");
      const { runs: allRuns } = (await res.json()) as { runs: RunSummary[] };
      const completed = allRuns.filter((r) => r.status === "completed");
      setRuns(completed);
      if (completed.length > 0) {
        setSelectedRunId((prev) => prev ?? completed[0].runId);
      }
    } catch {
      setRuns([]);
    } finally {
      setLoading(false);
      setInitialLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  useEffect(() => {
    if (open) fetchRuns();
  }, [open, fetchRuns]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleSubmit = async () => {
    if (!selectedRunId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/runs/${selectedRunId}/business-value/rerun`, {
        method: "POST",
      });
      if (res.status === 409) {
        const body = await res.json().catch(() => ({ error: "Already running" }));
        toast.error(body.error || "Business value analysis is already running for this run");
        setSubmitting(false);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to start" }));
        throw new Error(body.error || "Failed to start business value analysis");
      }

      toast.success("Business value analysis started");
      setOpen(false);

      pollRef.current = setInterval(async () => {
        try {
          const d = await fetch(`/api/runs/${selectedRunId}/business-value`);
          if (d.ok) {
            const data = await d.json();
            if (data.estimates?.length > 0) {
              if (pollRef.current) clearInterval(pollRef.current);
              pollRef.current = null;
              setSubmitting(false);
              toast.success("Business value analysis complete -- refresh the page to see results");
            }
          }
        } catch {
          /* polling error, continue */
        }
      }, 4000);

      setTimeout(() => {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setSubmitting(false);
        }
      }, 180_000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start analysis");
      setSubmitting(false);
    }
  };

  const noRuns = initialLoaded && runs.length === 0;

  if (noRuns && !open) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>
              <Button variant="outline" size="sm" disabled>
                <Play className="mr-1.5 size-4" />
                Run Business Value
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>No completed runs available. Run a discovery pipeline first.</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={submitting}>
          {submitting ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <Play className="mr-1.5 size-4" />
          )}
          {submitting ? "Running..." : "Run Business Value"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Run Business Value Analysis</DialogTitle>
          <DialogDescription>
            Generate financial estimates, roadmap phasing, executive synthesis, and stakeholder
            profiles for a completed pipeline run.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <AlertCircle className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No completed pipeline runs found. Run a discovery pipeline first.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="text-sm font-medium">Select a completed run</label>
            <Select value={selectedRunId ?? undefined} onValueChange={setSelectedRunId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a run..." />
              </SelectTrigger>
              <SelectContent>
                {runs.map((r) => (
                  <SelectItem key={r.runId} value={r.runId}>
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{r.config.businessName}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!selectedRunId || submitting || runs.length === 0}>
            {submitting ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Running...
              </>
            ) : (
              "Run Analysis"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
