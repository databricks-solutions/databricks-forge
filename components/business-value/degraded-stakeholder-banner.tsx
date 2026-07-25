"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface DegradedStakeholderBannerProps {
  runId: string;
  runLabel?: string | null;
}

/**
 * Amber banner shown on the Stakeholder Intelligence page when the
 * `stakeholder-analysis` BV pass degraded -- the LLM returned no
 * profiles after primary + fallback endpoints. Offers a one-click
 * Business Value rerun so users never see a silent empty state.
 */
export function DegradedStakeholderBanner({ runId, runLabel }: DegradedStakeholderBannerProps) {
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
        "Rerunning business value analysis -- the page will refresh once complete (~1-2 min).",
      );
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
              Stakeholder profiles were not generated
            </p>
            <p className="text-xs leading-relaxed text-amber-700/80 dark:text-amber-200/80">
              {runLabel ? <span className="font-medium">{runLabel}: </span> : null}
              The stakeholder-analysis pass returned no profiles after primary and
              fallback endpoint attempts. Click <em>Rerun Business Value</em> to
              regenerate them. The retry uses the premium reasoning endpoint
              (Opus 4-7) with automatic fallback to GPT-5.
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
              Rerunning...
            </>
          ) : (
            "Rerun Business Value"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
