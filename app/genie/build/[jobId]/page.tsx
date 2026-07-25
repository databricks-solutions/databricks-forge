"use client";

import { use, useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  ArrowLeft,
  Square,
  Sparkles,
  Rocket,
  ExternalLink,
  Table2,
  BarChart3,
  Link2,
  MessageSquare,
  FileText,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { GenieBuildProgress } from "@/components/genie/build-progress";
import type { GenieSpaceRecommendation, SerializedSpace } from "@/lib/genie/types";
import type { GenieBuilderStep } from "@/lib/genie/builder-steps";
import { loadSettings } from "@/lib/settings";
import { parseErrorResponse, safeJsonParse } from "@/lib/error-utils";

type PagePhase = "building" | "completed" | "failed" | "cancelled" | "deploying" | "deployed" | "not-found";

interface JobData {
  jobId: string;
  status: "generating" | "completed" | "failed" | "cancelled";
  currentStep: GenieBuilderStep | null;
  message: string;
  percent: number;
  error: string | null;
  title?: string;
  domain?: string;
  tableCount?: number;
  result?: {
    recommendation: GenieSpaceRecommendation;
    mode: "fast" | "full";
  } | null;
}

export default function GenieBuildDetailPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params);
  const _router = useRouter();

  const [phase, setPhase] = useState<PagePhase>("building");
  const [job, setJob] = useState<JobData | null>(null);
  const [recommendation, setRecommendation] = useState<GenieSpaceRecommendation | null>(null);
  const [parsedSpace, setParsedSpace] = useState<SerializedSpace | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [deployedSpaceId, setDeployedSpaceId] = useState<string | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [databricksHost, setDatabricksHost] = useState("");
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delayRef = useRef(2000);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => {
        if (d.host) setDatabricksHost(d.host.replace(/\/$/, ""));
      })
      .catch(() => {});
  }, []);

  const pollJob = useCallback(async () => {
    try {
      const res = await fetch(`/api/genie-spaces/generate?jobId=${jobId}`);
      if (res.status === 404) {
        setPhase("not-found");
        return;
      }
      if (!res.ok) return;

      const data: JobData = await res.json();
      setJob(data);

      if (data.status === "completed" && data.result?.recommendation) {
        setRecommendation(data.result.recommendation);
        try {
          setParsedSpace(JSON.parse(data.result.recommendation.serializedSpace) as SerializedSpace);
        } catch { /* ignore parse error */ }
        setPhase("completed");
        return;
      }
      if (data.status === "failed") {
        setPhase("failed");
        return;
      }
      if (data.status === "cancelled") {
        setPhase("cancelled");
        return;
      }

      setPhase("building");
      delayRef.current = Math.min(delayRef.current * 1.3, 8000);
      pollRef.current = setTimeout(pollJob, delayRef.current);
    } catch {
      pollRef.current = setTimeout(pollJob, delayRef.current);
    }
  }, [jobId]);

  useEffect(() => {
    delayRef.current = 2000;
    pollJob();
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [pollJob]);

  const handleCancel = async () => {
    try {
      await fetch(`/api/genie-spaces/generate?jobId=${jobId}`, { method: "DELETE" });
      setPhase("cancelled");
      if (pollRef.current) clearTimeout(pollRef.current);
    } catch {
      toast.error("Failed to cancel generation");
    }
  };

  const deployPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleDeploy = async () => {
    if (!recommendation) return;
    if (
      recommendation.quality?.gateDecision === "warn" &&
      !window.confirm("This space has quality warnings. Deploy anyway?")
    )
      return;
    setPhase("deploying");
    setDeployError(null);

    try {
      const settings = loadSettings();
      const res = await fetch("/api/genie-spaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: recommendation.title,
          description: recommendation.description,
          serializedSpace: recommendation.serializedSpace,
          domain: recommendation.domain,
          quality: recommendation.quality,
          authMode: settings.genieDeployAuthMode,
          resourcePrefix: settings.catalogResourcePrefix,
        }),
      });

      if (!res.ok) {
        throw new Error(await parseErrorResponse(res, "Deployment failed"));
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await safeJsonParse(res);
      if (!data) throw new Error("Invalid response from server");

      if (data.jobId) {
        // Fire-and-forget: poll for completion
        deployPollRef.current = setInterval(async () => {
          try {
            const pollRes = await fetch(`/api/genie-spaces?deployJobId=${data.jobId}`);
            if (!pollRes.ok) return;
            const pollData = await pollRes.json();
            if (pollData.status === "completed" && pollData.result) {
              if (deployPollRef.current) clearInterval(deployPollRef.current);
              setDeployedSpaceId(pollData.result.spaceId);
              setPhase("deployed");
              toast.success("Genie Space deployed successfully!");
              fetch("/api/embeddings/backfill", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ scope: "genie" }),
              }).catch(() => {});
              fetch("/api/genie-spaces/generate", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jobId, deployedSpaceId: pollData.result.spaceId }),
              }).catch(() => {});
            } else if (pollData.status === "failed") {
              if (deployPollRef.current) clearInterval(deployPollRef.current);
              setDeployError(pollData.error || "Deployment failed");
              setPhase("completed");
              toast.error(pollData.error || "Deployment failed");
            }
          } catch { /* retry on next interval */ }
        }, 2000);
      } else if (data.spaceId) {
        // Synchronous response (backward compat)
        setDeployedSpaceId(data.spaceId);
        setPhase("deployed");
        toast.success("Genie Space deployed successfully!");
        fetch("/api/genie-spaces/generate", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, deployedSpaceId: data.spaceId }),
        }).catch(() => {});
      }
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : "Deployment failed");
      setPhase("completed");
      toast.error(err instanceof Error ? err.message : "Deployment failed");
    }
  };

  useEffect(() => {
    return () => {
      if (deployPollRef.current) clearInterval(deployPollRef.current);
    };
  }, []);

  const genieUrl =
    databricksHost && deployedSpaceId
      ? `${databricksHost}/genie/rooms/${deployedSpaceId}`
      : "";

  return (
    <div className="mx-auto max-w-[900px] space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/genie">
            <ArrowLeft className="mr-1 size-4" />
            Genie Studio
          </Link>
        </Button>
      </div>

      <PageHeader
        title={job?.title || "Building Genie Space"}
        subtitle={
          phase === "deployed"
            ? "Your Genie Space is live and ready for queries."
            : phase === "completed"
              ? "Generation complete. Review and deploy your space."
              : phase === "failed"
                ? "Generation failed."
                : phase === "cancelled"
                  ? "Generation was cancelled."
                  : phase === "not-found"
                    ? "This build job was not found or has expired."
                    : job?.domain
                      ? `Building space for ${job.domain}...`
                      : "Running the Genie Engine..."
        }
      />

      {/* Not found */}
      {phase === "not-found" && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              This build job was not found. It may have expired or the server restarted.
            </p>
            <Button className="mt-4" variant="outline" asChild>
              <Link href="/genie">Back to Genie Studio</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Building phase */}
      {phase === "building" && job && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Build Progress</CardTitle>
                <CardDescription>
                  {job.message}
                  {job.tableCount && (
                    <span className="ml-2">
                      ({job.tableCount} table{job.tableCount !== 1 ? "s" : ""})
                    </span>
                  )}
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-amber-600 border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                onClick={handleCancel}
              >
                <Square className="mr-1 h-3.5 w-3.5" />
                Stop
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <Progress value={job.percent} className="h-3" />
              <p className="mt-1 text-right text-sm text-muted-foreground">{job.percent}%</p>
            </div>
            <GenieBuildProgress
              currentStep={job.currentStep}
              progressPct={job.percent}
              status="generating"
              statusMessage={job.message}
            />
          </CardContent>
        </Card>
      )}

      {/* Failed phase */}
      {phase === "failed" && job && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-lg text-destructive">Build Failed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertTriangle className="size-4" />
                {job.error || "An unknown error occurred"}
              </div>
            </div>
            <GenieBuildProgress
              currentStep={job.currentStep}
              progressPct={job.percent}
              status="failed"
            />
            <Button variant="outline" asChild>
              <Link href="/genie">
                <RotateCcw className="mr-2 size-4" />
                Back to Genie Studio
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Cancelled phase */}
      {phase === "cancelled" && (
        <Card className="border-amber-500/50">
          <CardHeader>
            <CardTitle className="text-lg text-amber-600">Build Cancelled</CardTitle>
          </CardHeader>
          <CardContent>
            {job && (
              <GenieBuildProgress
                currentStep={job.currentStep}
                progressPct={job.percent}
                status="cancelled"
              />
            )}
            <Button variant="outline" className="mt-4" asChild>
              <Link href="/genie">Back to Genie Studio</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Completed / Review phase */}
      {(phase === "completed" || phase === "deploying") && recommendation && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Sparkles className="size-5 text-primary" />
                  {recommendation.title}
                </CardTitle>
                <CardDescription className="mt-1">
                  {recommendation.description}
                </CardDescription>
              </div>
              <Badge variant="outline" className="gap-1 text-green-600 dark:text-green-400">
                <Sparkles className="size-3" />
                Full Engine
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Quality + stats */}
            {recommendation.quality && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  Quality: {recommendation.quality.score}
                </Badge>
                {recommendation.quality.gateDecision === "block" && (
                  <Badge variant="destructive" className="text-xs">Blocked</Badge>
                )}
                {recommendation.quality.gateDecision === "warn" && (
                  <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 text-xs">
                    Warnings
                  </Badge>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
              <StatItem icon={Table2} label="Tables" value={recommendation.tableCount} />
              <StatItem icon={BarChart3} label="Measures" value={recommendation.measureCount} />
              <StatItem icon={Link2} label="Filters" value={recommendation.filterCount} />
              <StatItem icon={MessageSquare} label="Dimensions" value={recommendation.dimensionCount} />
              <StatItem icon={FileText} label="Instructions" value={recommendation.instructionCount} />
              <StatItem icon={Link2} label="Joins" value={recommendation.joinCount} />
              <StatItem icon={MessageSquare} label="Questions" value={recommendation.sampleQuestionCount} />
            </div>

            {/* Quality warnings */}
            {recommendation.quality && recommendation.quality.degradedReasons.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 dark:border-amber-900/60 dark:bg-amber-950/30">
                <div className="flex items-center gap-2 text-xs font-medium">
                  <AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-400" />
                  Quality warnings
                </div>
                <ul className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                  {recommendation.quality.degradedReasons.map((reason) => (
                    <li key={reason}>- {reason.replace(/_/g, " ")}</li>
                  ))}
                </ul>
              </div>
            )}

            {deployError && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                  <AlertTriangle className="size-4" />
                  {deployError}
                </div>
              </div>
            )}

            {/* Collapsible detail */}
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {showDetails ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              Details
            </button>
            {showDetails && parsedSpace && (
              <div className="space-y-3 rounded-md border bg-muted/30 p-3 text-xs">
                {parsedSpace.data_sources?.tables?.length > 0 && (
                  <div>
                    <p className="font-medium">Tables</p>
                    <ul className="mt-1 space-y-0.5 text-muted-foreground">
                      {parsedSpace.data_sources.tables.map((t) => (
                        <li key={t.identifier} className="font-mono text-[11px]">{t.identifier}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {(parsedSpace.instructions?.join_specs?.length ?? 0) > 0 && (
                  <div>
                    <p className="font-medium">
                      Joins ({parsedSpace.instructions.join_specs!.length})
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Deploy actions */}
            <div className="flex items-center gap-3 pt-2">
              {recommendation.quality?.gateDecision !== "block" && (
                <Button
                  onClick={handleDeploy}
                  disabled={phase === "deploying"}
                  variant={recommendation.quality?.gateDecision === "warn" ? "outline" : "default"}
                  className={
                    recommendation.quality?.gateDecision === "warn"
                      ? "border-amber-500 text-amber-600 hover:bg-amber-50 dark:border-amber-600 dark:text-amber-400 dark:hover:bg-amber-950/30"
                      : ""
                  }
                >
                  {phase === "deploying" ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Deploying...
                    </>
                  ) : (
                    <>
                      <Rocket className="mr-2 size-4" />
                      Deploy to Databricks
                    </>
                  )}
                </Button>
              )}
              <Button variant="outline" asChild>
                <Link href="/genie">Back to Genie Studio</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Deployed phase */}
      {phase === "deployed" && deployedSpaceId && (
        <Card className="border-green-500/30">
          <CardContent className="py-8">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400">
                <Sparkles className="size-6" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Genie Space Deployed</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {recommendation?.title ?? "Your space"} is live and ready for queries.
                </p>
              </div>
              <div className="flex items-center gap-3">
                {genieUrl && (
                  <Button asChild>
                    <a href={genieUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-2 size-4" />
                      Open in Databricks
                    </a>
                  </Button>
                )}
                <Button variant="outline" asChild>
                  <Link href={`/genie/${deployedSpaceId}`}>View in Genie Studio</Link>
                </Button>
                <Button variant="ghost" asChild>
                  <Link href="/genie">All Spaces</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatItem({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: number;
}) {
  if (!value || value === 0) return null;
  return (
    <span className="flex items-center gap-1">
      <Icon className="size-3" />
      {value} {label}
    </span>
  );
}
