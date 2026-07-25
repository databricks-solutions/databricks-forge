"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, ArrowLeft, RotateCw } from "lucide-react";

/**
 * Route error boundary for the `/runs` list page.
 *
 * Last-ditch defence in case anything in the runs page (server fetch,
 * RSC payload serialization, or a child render) throws. The four
 * upstream fixes -- lean summary query, stable polling, capped step
 * log, and the `?fields=summary` API -- make hitting this boundary
 * unlikely, but it's cheap insurance against the symptom the user
 * actually reported ("Maximum call stack size exceeded").
 */
export default function RunsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[runs/error-boundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <Card className="w-full max-w-lg border-destructive/30 shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 ring-1 ring-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle className="text-xl">Failed to load runs</CardTitle>
          <CardDescription>
            We hit an unexpected error while loading your pipeline runs. Try again, or head back to
            the dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-muted/60 p-3 font-mono text-sm text-muted-foreground">
            {error.message || "Unknown error"}
            {error.digest && (
              <span className="mt-1 block text-xs opacity-60">Error ID: {error.digest}</span>
            )}
          </div>
          <div className="flex justify-center gap-3">
            <Button variant="outline" asChild>
              <Link href="/">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Dashboard
              </Link>
            </Button>
            <Button onClick={() => reset()}>
              <RotateCw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
