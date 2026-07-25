"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface DegradedFinancialBannerProps {
  runId: string;
  /** Pretty name for the run (e.g. business name) -- shown in the banner copy. */
  runLabel?: string | null;
  /** Optional count of use cases missing estimates, when known. */
  missingCount?: number;
}

/**
 * Amber banner shown on the Business Value page when the latest run's
 * `financial-quantification` step degraded -- the LLM returned empty content
 * for one or more batches and could not be recovered via halve-batch +
 * fallback. Offers a one-click recompute.
 *
 * The recompute calls the existing owner-gated rerun route, which deletes
 * the (incomplete) value estimates and re-runs the BV pipeline. On success
 * `runBusinessValueAnalysis` clears the degraded flag.
 */
export function DegradedFinancialBanner({
  runId,
  runLabel,
  missingCount,
}: DegradedFinancialBannerProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const handleRecompute = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/runs/${runId}/business-value/rerun`, {
        method: "POST",
      });
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error || "Business value refresh is already running");
        setSubmitting(false);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Failed to start recompute");
      }
      toast.success(
        "Recomputing financial estimates -- the page will refresh once complete (~1-2 min).",
      );
      // Soft refresh after a short delay so the user sees the new state
      // when the background job lands. The server-rendered page picks up
      // the cleared degraded flag and updated estimates.
      setTimeout(() => router.refresh(), 90_000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Recompute failed");
      setSubmitting(false);
    }
  };

  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-amber-500"
            aria-hidden="true"
          />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
              Financial estimates were not generated
            </p>
            <p className="text-xs leading-relaxed text-amber-700/80 dark:text-amber-200/80">
              {runLabel ? <span className="font-medium">{runLabel}: </span> : null}
              The reasoning model returned empty content for{" "}
              {typeof missingCount === "number" && missingCount > 0
                ? `${missingCount} use case${missingCount === 1 ? "" : "s"}`
                : "one or more batches"}{" "}
              and could not be recovered automatically. Click <em>Recompute</em> to retry --
              the run will rotate to a fallback endpoint and split into smaller batches.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRecompute}
          disabled={submitting}
          className="self-start border-amber-500/50 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
        >
          {submitting ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              Recomputing...
            </>
          ) : (
            "Recompute"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
