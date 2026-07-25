"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, AlertTriangle, Loader2, Sparkles, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { ResearchEngineResult } from "@/lib/demo/research-engine/types";
import { ResearchHeader } from "@/components/demo/session/research-header";
import { MeetingSummaryStrip } from "@/components/demo/session/meeting-summary-strip";
import { StickyBriefRail } from "@/components/demo/session/sticky-brief-rail";
import { SummaryTab } from "@/components/demo/session/summary-tab";
import { OpportunitiesTab } from "@/components/demo/session/opportunity-card";
import { PersonaTalkTrack } from "@/components/demo/session/persona-talk-track";
import { EvidenceList } from "@/components/demo/session/evidence-list";
import { SourceList } from "@/components/demo/session/source-list";
import { DataReadinessList } from "@/components/demo/session/data-readiness-list";
import { DataWindowCard } from "@/components/demo/session/data-window-card";
import type { DemoDateWindow } from "@/lib/demo/data-engine/date-window";
import type { TableDesign, ValidationResult } from "@/lib/demo/types";
import { ShareButton, SharedByBadge } from "@/components/share/share-button";

interface SessionDetail {
  sessionId: string;
  customerName: string;
  industryId: string;
  researchPreset: string;
  catalogName: string;
  schemaName: string;
  status: string;
  tablesCreated: number;
  totalRows: number;
  durationMs: number;
  createdAt: string;
  research: ResearchEngineResult | null;
  dateWindow: DemoDateWindow | null;
  validationResults: ValidationResult[] | null;
  tableDesigns: TableDesign[] | null;
  genieMode?: boolean;
  genieSpaceId?: string | null;
  genieSpaceUrl?: string | null;
  genieDeployError?: string | null;
  ownerEmail?: string | null;
}

export default function DemoSessionPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params?.sessionId as string;
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [launching, setLaunching] = useState<"discovery" | "scan" | null>(null);
  const [activeTab, setActiveTab] = useState("summary");

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    let retryCount = 0;
    const MAX_RETRIES = 5;
    const RETRY_DELAY_MS = 2000;

    const fetchSession = async () => {
      try {
        const r = await fetch(`/api/demo/sessions/${sessionId}`);
        if (cancelled) return;
        if (!r.ok) throw new Error(r.status === 404 ? "Session not found" : "Failed to load");
        const data = await r.json();
        if (cancelled) return;

        if (
          !data.research &&
          retryCount < MAX_RETRIES &&
          ["draft", "generating", "completed"].includes(data.status)
        ) {
          retryCount++;
          setTimeout(() => {
            if (!cancelled) fetchSession();
          }, RETRY_DELAY_MS);
          return;
        }

        setSession(data);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    };

    fetchSession();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const handleExport = useCallback(
    (format: "pptx" | "pdf") => {
      window.open(`/api/demo/sessions/${sessionId}/export?format=${format}`, "_blank");
    },
    [sessionId],
  );

  const handleCopyFqn = useCallback(() => {
    if (!session) return;
    navigator.clipboard.writeText(`${session.catalogName}.${session.schemaName}`);
    toast.success("Schema copied to clipboard");
  }, [session]);

  const handleLaunchDiscovery = useCallback(async () => {
    if (!session) return;
    if (!session.catalogName || !session.schemaName) {
      toast.error("Session is missing catalog/schema. Re-run data generation first.");
      return;
    }
    setLaunching("discovery");
    try {
      const scope = `${session.catalogName}.${session.schemaName}`;
      const createRes = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: session.customerName,
          ucMetadata: scope,
          industry: session.industryId,
          businessPriorities: ["Increase Revenue"],
          discoveryDepth: "balanced",
          estateScanEnabled: false,
        }),
      });
      if (!createRes.ok) throw new Error("Failed to create pipeline run");
      const { runId } = await createRes.json();

      const execRes = await fetch(`/api/runs/${runId}/execute`, {
        method: "POST",
      });
      if (!execRes.ok) throw new Error("Failed to start pipeline");

      toast.success("Discovery pipeline started");
      router.push(`/runs/${runId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to launch discovery");
      setLaunching(null);
    }
  }, [session, router]);

  const handleLaunchEstateScan = useCallback(async () => {
    if (!session) return;
    if (!session.catalogName || !session.schemaName) {
      toast.error("Session is missing catalog/schema. Re-run data generation first.");
      return;
    }
    setLaunching("scan");
    try {
      const scope = `${session.catalogName}.${session.schemaName}`;
      const res = await fetch("/api/environment-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ucMetadata: scope,
        }),
      });
      if (!res.ok) throw new Error("Failed to start estate scan");

      toast.success("Estate scan started");
      router.push("/environment");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to launch estate scan");
      setLaunching(null);
    }
  }, [session, router]);

  const handleScrollToTab = useCallback((tab: string) => {
    setActiveTab(tab);
  }, []);

  // ── Loading ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
        <div className="relative">
          <div className="h-12 w-12 animate-spin rounded-full border-[3px] border-primary/20 border-t-primary" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium">Loading intelligence briefing…</p>
          <p className="text-xs text-muted-foreground">Assembling research data</p>
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────
  if (error || !session) {
    return (
      <div className="space-y-4">
        <Link
          href="/demo"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Demo Studio
        </Link>
        <Card className="border-destructive/30">
          <CardContent className="py-16 text-center">
            <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive/60" />
            <p className="font-medium text-destructive">{error ?? "Session not found"}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { research } = session;
  const isCompleted = session.status === "completed";

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      {/* Breadcrumb + Share */}
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/demo"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Demo Studio
        </Link>
        <div className="flex items-center gap-2">
          <SharedByBadge ownerEmail={session.ownerEmail} />
          <ShareButton
            resourceType="demo_session"
            resourceId={session.sessionId}
            ownerEmail={session.ownerEmail}
            resourceLabel={`"${session.customerName}"`}
          />
        </div>
      </div>

      {/* ── Header ────────────────────────────────────────────────── */}
      <ResearchHeader
        customerName={session.customerName}
        industryId={session.industryId}
        researchPreset={session.researchPreset}
        status={session.status}
        createdAt={session.createdAt}
        catalogName={session.catalogName}
        schemaName={session.schemaName}
        research={research}
        launching={launching}
        onLaunchDiscovery={handleLaunchDiscovery}
        onLaunchEstateScan={handleLaunchEstateScan}
        onExport={handleExport}
        onCopyFqn={handleCopyFqn}
        onScrollToTab={handleScrollToTab}
      />

      {/* ── Meeting Summary Strip ─────────────────────────────────── */}
      <MeetingSummaryStrip research={research} />

      {/* ── Genie Space card (Genie Mode only) ────────────────────── */}
      {(session.genieMode || session.genieSpaceId || session.genieDeployError) && (
        <Card className="border-violet-200 bg-violet-50/40 dark:border-violet-900 dark:bg-violet-950/20">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-violet-100 dark:bg-violet-900/40">
                <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-300" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Genie Space</p>
                  {session.genieSpaceId ? (
                    <span className="text-[10px] font-medium uppercase tracking-wider rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 px-2 py-0.5">
                      Deployed
                    </span>
                  ) : session.genieDeployError ? (
                    <span className="text-[10px] font-medium uppercase tracking-wider rounded-full bg-destructive/10 text-destructive px-2 py-0.5">
                      Failed
                    </span>
                  ) : (
                    <span className="text-[10px] font-medium uppercase tracking-wider rounded-full bg-muted text-muted-foreground px-2 py-0.5">
                      Pending
                    </span>
                  )}
                </div>
                {session.genieSpaceId ? (
                  <>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Bound to{" "}
                      <code className="font-mono text-[11px]">
                        {session.catalogName}.{session.schemaName}
                      </code>
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {session.genieSpaceUrl && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 border-violet-300 text-violet-700 hover:bg-violet-100 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-900/40"
                          onClick={() => window.open(session.genieSpaceUrl!, "_blank")}
                        >
                          Open in Databricks
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1.5"
                        onClick={() => router.push("/genie")}
                      >
                        View in Forge
                      </Button>
                    </div>
                  </>
                ) : session.genieDeployError ? (
                  <p className="mt-0.5 text-xs text-destructive">
                    Deploy failed: {session.genieDeployError}
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Finalising Genie Space...
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Data Window + per-fact-table coverage ─────────────────── */}
      <DataWindowCard
        dateWindow={session.dateWindow}
        validationResults={session.validationResults}
        tableDesigns={session.tableDesigns}
      />

      {/* ── Main content: tabs + sidebar rail ─────────────────────── */}
      <div className="flex gap-6">
        {/* Main column */}
        <div className="min-w-0 flex-1">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full justify-start">
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
              <TabsTrigger value="talk-track">Talk Track</TabsTrigger>
              <TabsTrigger value="evidence">Evidence</TabsTrigger>
              <TabsTrigger value="sources">Sources</TabsTrigger>
            </TabsList>

            {/* ── Summary Tab ───────────────────────────────── */}
            <TabsContent value="summary" className="mt-4">
              {research ? (
                <div className="space-y-4">
                  <SummaryTab research={research} />
                  {research.dataStrategy && (
                    <DataReadinessList dataStrategy={research.dataStrategy} />
                  )}
                </div>
              ) : (
                <EmptyTabMessage message="No research data available. Run a research preset to populate this tab." />
              )}
            </TabsContent>

            {/* ── Opportunities Tab ─────────────────────────── */}
            <TabsContent value="opportunities" className="mt-4">
              {research ? (
                <OpportunitiesTab
                  research={research}
                  onSwitchToTalkTrack={() => setActiveTab("talk-track")}
                />
              ) : (
                <EmptyTabMessage message="No opportunities generated yet." />
              )}
            </TabsContent>

            {/* ── Talk Track Tab ─────────────────────────────── */}
            <TabsContent value="talk-track" className="mt-4">
              {research ? (
                <PersonaTalkTrack research={research} />
              ) : (
                <EmptyTabMessage message="No talk track data available." />
              )}
            </TabsContent>

            {/* ── Evidence Tab ───────────────────────────────── */}
            <TabsContent value="evidence" className="mt-4">
              {research ? (
                <EvidenceList research={research} />
              ) : (
                <EmptyTabMessage message="No evidence collected." />
              )}
            </TabsContent>

            {/* ── Sources Tab ───────────────────────────────── */}
            <TabsContent value="sources" className="mt-4">
              {research?.sources?.length ? (
                <SourceList sources={research.sources} summaries={research.sourceSummaries} />
              ) : (
                <EmptyTabMessage message="No sources collected." />
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* Sticky sidebar rail — hidden on small screens */}
        <aside className="hidden w-72 shrink-0 lg:block">
          <StickyBriefRail
            research={research}
            isCompleted={isCompleted}
            launching={launching}
            onLaunchDiscovery={handleLaunchDiscovery}
            onLaunchEstateScan={handleLaunchEstateScan}
            onExport={handleExport}
          />
        </aside>
      </div>
    </div>
  );
}

function EmptyTabMessage({ message }: { message: string }) {
  return (
    <div className="py-16 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
