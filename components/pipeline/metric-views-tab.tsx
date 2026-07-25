"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ChevronDown,
  ChevronRight,
  Rocket,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileCode,
  Table2,
  Copy,
  Check,
  Wrench,
} from "lucide-react";
import {
  MetricViewDeployModal,
  type DeployableProposal,
} from "@/components/pipeline/metric-view-deploy-modal";

interface MetricViewProposal {
  id: string;
  runId: string | null;
  schemaScope: string;
  domain: string | null;
  name: string;
  description: string | null;
  yaml: string;
  ddl: string;
  sourceTables: string[];
  hasJoins: boolean;
  validationStatus: string;
  validationIssues: string[];
  deploymentStatus: string;
  deployedFqn: string | null;
  deployedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "deployed":
      return (
        <Badge variant="default" className="bg-green-600 hover:bg-green-700">
          <CheckCircle2 className="mr-1 h-3 w-3" /> Deployed
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive">
          <XCircle className="mr-1 h-3 w-3" /> Failed
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary">
          <FileCode className="mr-1 h-3 w-3" /> Proposed
        </Badge>
      );
  }
}

function ValidationBadge({ status }: { status: string }) {
  switch (status) {
    case "valid":
      return (
        <Badge variant="outline" className="border-green-500 text-green-700">
          Valid
        </Badge>
      );
    case "warning":
      return (
        <Badge variant="outline" className="border-amber-500 text-amber-700">
          <AlertTriangle className="mr-1 h-3 w-3" /> Warning
        </Badge>
      );
    case "error":
      return (
        <Badge variant="outline" className="border-red-500 text-red-700">
          <XCircle className="mr-1 h-3 w-3" /> Error
        </Badge>
      );
    default:
      return <Badge variant="outline">Pending</Badge>;
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button
      variant="ghost"
      size="sm"
      className="absolute right-1 top-1 h-7 gap-1 text-[10px] opacity-0 transition-opacity group-hover/code:opacity-100"
      onClick={handleCopy}
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-green-500" /> Copied
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" /> {label}
        </>
      )}
    </Button>
  );
}

function MetricViewRow({
  proposal,
  onDeploy,
  onRepair,
  repairing,
}: {
  proposal: MetricViewProposal;
  onDeploy: (proposal: MetricViewProposal) => void;
  onRepair: (id: string) => void;
  repairing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const canDeploy =
    proposal.deploymentStatus !== "deployed" && proposal.validationStatus !== "error";
  const canRepair = proposal.validationStatus === "error" || proposal.deploymentStatus === "failed";

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <div className="min-w-0 overflow-hidden border rounded-lg p-3">
        <CollapsibleTrigger asChild>
          <div className="flex items-center justify-between cursor-pointer min-w-0 overflow-hidden">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="text-muted-foreground">
                {expanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm truncate">{proposal.name}</span>
                  {proposal.domain && (
                    <Badge variant="outline" className="text-xs shrink-0">
                      {proposal.domain}
                    </Badge>
                  )}
                </div>
                {proposal.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 break-words">
                    {proposal.description}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-2">
              {proposal.hasJoins && (
                <Badge variant="outline" className="text-xs">
                  <Table2 className="mr-1 h-3 w-3" /> Joins
                </Badge>
              )}
              <ValidationBadge status={proposal.validationStatus} />
              <StatusBadge status={proposal.deploymentStatus} />
              {canRepair && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRepair(proposal.id);
                  }}
                  disabled={repairing}
                >
                  <Wrench className="mr-1 h-3 w-3" />
                  {repairing ? "Repairing..." : "Repair"}
                </Button>
              )}
              {canDeploy && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeploy(proposal);
                  }}
                >
                  <Rocket className="mr-1 h-3 w-3" />
                  Deploy
                </Button>
              )}
            </div>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-3 min-w-0 space-y-3 border-t pt-3">
            {proposal.sourceTables.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Source Tables</p>
                <div className="flex flex-wrap gap-1">
                  {proposal.sourceTables.map((t) => (
                    <Badge key={t} variant="secondary" className="text-xs font-mono break-all">
                      {t}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {proposal.validationIssues.length > 0 && (
              <div>
                <p className="text-xs font-medium text-amber-600 mb-1">Validation Issues</p>
                <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside break-words">
                  {proposal.validationIssues.map((issue, idx) => (
                    <li key={idx}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
            {proposal.deployedFqn && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Deployed FQN</p>
                <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded break-all">
                  {proposal.deployedFqn}
                </code>
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground mb-1">YAML Preview</p>
              <div className="group/code relative">
                <CopyButton text={proposal.yaml} label="Copy YAML" />
                <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-64 whitespace-pre-wrap break-words font-mono">
                  {proposal.yaml}
                </pre>
              </div>
            </div>
            {proposal.ddl && (
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground mb-1">DDL</p>
                <div className="group/code relative">
                  <CopyButton text={proposal.ddl} label="Copy DDL" />
                  <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-64 whitespace-pre-wrap break-words font-mono">
                    {proposal.ddl}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function MetricViewsTab({ runId }: { runId: string }) {
  const [proposals, setProposals] = useState<MetricViewProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterDomain, setFilterDomain] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [repairingIds, setRepairingIds] = useState<Set<string>>(new Set());

  // Deploy modal state
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [deployModalProposals, setDeployModalProposals] = useState<DeployableProposal[]>([]);

  const fetchProposals = useCallback(async () => {
    try {
      const res = await fetch(`/api/metric-views?runId=${runId}`);
      if (res.ok) {
        const data = await res.json();
        setProposals(data.proposals ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  const openDeployModal = useCallback((items: MetricViewProposal[]) => {
    setDeployModalProposals(
      items.map((p) => ({ id: p.id, name: p.name, schemaScope: p.schemaScope })),
    );
    setDeployModalOpen(true);
  }, []);

  const handleRepair = useCallback(
    async (id: string) => {
      setRepairingIds((prev) => new Set([...prev, id]));
      try {
        await fetch(`/api/metric-views/${id}/repair`, { method: "POST" });
        await fetchProposals();
      } catch {
        // ignore
      } finally {
        setRepairingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [fetchProposals],
  );

  const domains = Array.from(new Set(proposals.map((p) => p.domain).filter(Boolean)));

  const filtered = proposals.filter((p) => {
    if (filterDomain !== "all" && p.domain !== filterDomain) return false;
    if (filterStatus === "deployed" && p.deploymentStatus !== "deployed") return false;
    if (filterStatus === "proposed" && p.deploymentStatus !== "proposed") return false;
    if (filterStatus === "failed" && p.deploymentStatus !== "failed") return false;
    if (filterStatus === "error" && p.validationStatus !== "error") return false;
    return true;
  });

  const deployedCount = proposals.filter((p) => p.deploymentStatus === "deployed").length;
  const deployableCount = proposals.filter(
    (p) => p.deploymentStatus !== "deployed" && p.validationStatus !== "error",
  ).length;

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (proposals.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Metric Views</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No metric view proposals have been generated for this run. Enable metric view generation
            in the Genie Engine configuration to create reusable, governed metric definitions.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-base">Metric Views ({proposals.length})</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {deployedCount} deployed, {deployableCount} ready to deploy
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={filterDomain} onValueChange={setFilterDomain}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue placeholder="All domains" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All domains</SelectItem>
                {domains.map((d) => (
                  <SelectItem key={d} value={d!}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[130px] h-8 text-xs">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="deployed">Deployed</SelectItem>
                <SelectItem value="proposed">Proposed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="error">Validation Error</SelectItem>
              </SelectContent>
            </Select>
            {deployableCount > 0 && (
              <Button
                size="sm"
                onClick={() => {
                  const deployable = proposals.filter(
                    (p) => p.deploymentStatus !== "deployed" && p.validationStatus !== "error",
                  );
                  openDeployModal(deployable);
                }}
              >
                <Rocket className="mr-1 h-3 w-3" />
                Deploy All Valid ({deployableCount})
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {filtered.map((p) => (
          <MetricViewRow
            key={p.id}
            proposal={p}
            onDeploy={(proposal) => openDeployModal([proposal])}
            onRepair={handleRepair}
            repairing={repairingIds.has(p.id)}
          />
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No metric views match the current filters.
          </p>
        )}
      </CardContent>

      <MetricViewDeployModal
        open={deployModalOpen}
        onOpenChange={setDeployModalOpen}
        proposals={deployModalProposals}
        onComplete={fetchProposals}
      />
    </Card>
  );
}
