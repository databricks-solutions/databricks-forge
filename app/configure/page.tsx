"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ConfigForm } from "@/components/pipeline/config-form";
import { SuggestionPanel } from "@/components/pipeline/suggestion-panel";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lightbulb, Database, AlertTriangle, Loader2 } from "lucide-react";
import {
  interpretScanSummary,
  type SourceScanState,
} from "@/lib/pipeline/source-scan-state";

function ConfigureContent() {
  const t = useTranslations("configure");
  const searchParams = useSearchParams();
  const fromScan = searchParams.get("fromScan");

  const [businessName, setBusinessName] = useState("");
  const [sourceState, setSourceState] = useState<SourceScanState>({ status: "none" });
  // Local override lets the user dismiss the source scan without losing the
  // query param on a refresh.
  const [sourceDismissed, setSourceDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!fromScan || sourceDismissed) {
        if (!cancelled) setSourceState({ status: "none" });
        return;
      }
      setSourceState({ status: "loading" });
      try {
        const res = await fetch(`/api/environment/${fromScan}/summary`, {
          headers: { Accept: "application/json" },
        });
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        if (cancelled) return;
        setSourceState(interpretScanSummary(res.status, body));
      } catch {
        if (!cancelled) {
          setSourceState({
            status: "error",
            message: t("source.errors.error"),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fromScan, sourceDismissed, t]);

  const removeSource = useCallback(() => {
    setSourceDismissed(true);
    setSourceState({ status: "none" });
  }, []);

  const sourceReady = sourceState.status === "ready" ? sourceState : null;

  return (
    <div className="mx-auto max-w-[1400px] space-y-8">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
      />

      {/* Source-scan banner (ready) */}
      {sourceReady && (
        <Card className="border-primary/30 bg-primary/[0.04]">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <Database aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {t("source.readyTitle")}
                  <Badge variant="secondary" className="text-[10px]">
                    {t("source.tables", { count: sourceReady.tableCount })}
                  </Badge>
                </p>
                <p className="break-all font-mono text-xs text-muted-foreground">
                  {sourceReady.ucPath}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("source.readyDescription")}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Source-scan loading */}
      {sourceState.status === "loading" && (
        <Card className="border-muted">
          <CardContent role="status" aria-live="polite" className="flex items-center gap-2 pt-4 text-sm text-muted-foreground">
            <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            {t("source.loading")}
          </CardContent>
        </Card>
      )}

      {/* Source-scan error (unauthorized / missing / incomplete / error) — never silently falls back */}
      {(sourceState.status === "unauthorized" ||
        sourceState.status === "missing" ||
        sourceState.status === "incomplete" ||
        sourceState.status === "error") && (
        <Card className="border-destructive/40 bg-destructive/[0.04]">
          <CardContent role="alert" aria-live="assertive" className="pt-4">
            <div className="flex items-start gap-3">
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">
                  {t("source.errorTitle")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t(`source.errors.${sourceState.status}` as "source.errors.missing")}
                </p>
                <button
                  type="button"
                  onClick={removeSource}
                  className="min-h-11 pt-1 text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("source.continueLive")}
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-chart-2/20 bg-chart-2/[0.03] dark:border-chart-2/15 dark:bg-chart-2/[0.04]">
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <Lightbulb aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-chart-2" />
            <div className="space-y-1">
              <p className="text-sm font-medium">{t("tips.title")}</p>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                <li>{t("tips.companyName")}</li>
                <li>{t("tips.scope")}</li>
                <li>{t("tips.priorities")}</li>
                <li>{t("tips.model")}</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <SuggestionPanel businessName={businessName} />

      <ConfigForm
        onBusinessNameChange={setBusinessName}
        sourceScanId={sourceReady?.scanId ?? null}
        sourceUcPath={sourceReady?.ucPath ?? null}
        onRemoveSource={sourceReady ? removeSource : undefined}
      />
    </div>
  );
}

export default function ConfigurePage() {
  return (
    <Suspense fallback={null}>
      <ConfigureContent />
    </Suspense>
  );
}
