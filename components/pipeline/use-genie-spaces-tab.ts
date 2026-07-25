"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import type {
  GenieEngineRecommendation,
  MetricViewProposal,
  SerializedSpace,
  TrackedGenieSpace,
} from "@/lib/genie/types";
import type { UseCase } from "@/lib/domain/types";
import type { TrashPreview } from "./genie-trash-preview";
import type { DeployStatus } from "./genie-recommendation-row";

interface UseGenieSpacesTabParams {
  runId: string;
  engineGenerating: boolean;
  completedDomainNames: string[];
  engineEnabled: boolean;
  refreshKey: number;
}

export function useGenieSpacesTab({
  runId,
  engineGenerating,
  completedDomainNames,
  engineEnabled,
  refreshKey,
}: UseGenieSpacesTabParams) {
  const [recommendations, setRecommendations] = useState<GenieEngineRecommendation[]>([]);
  const [tracked, setTracked] = useState<TrackedGenieSpace[]>([]);
  const [databricksHost, setDatabricksHost] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailDomain, setDetailDomain] = useState<string | null>(null);
  const [trashingDomain, setTrashingDomain] = useState<string | null>(null);
  const [trashDialogOpen, setTrashDialogOpen] = useState(false);
  const [trashDialogDomain, setTrashDialogDomain] = useState<string | null>(null);
  const [trashPreview, setTrashPreview] = useState<TrashPreview | null>(null);
  const [trashPreviewLoading, setTrashPreviewLoading] = useState(false);
  const [dropAssetsChecked, setDropAssetsChecked] = useState(true);
  const [testingDomain, setTestingDomain] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    { question: string; status: string; sql?: string; error?: string }[] | null
  >(null);
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [deployModalDomains, setDeployModalDomains] = useState<GenieEngineRecommendation[]>([]);
  const [regeneratingDomain, setRegeneratingDomain] = useState<string | null>(null);
  const [detailUseCases, setDetailUseCases] = useState<UseCase[]>([]);
  const [useCaseCache, setUseCaseCache] = useState<Map<string, UseCase[]>>(new Map());
  const [loadingUseCases, setLoadingUseCases] = useState(false);
  const regenPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRecommendations = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/genie-recommendations`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load Genie recommendations");
        return;
      }
      setRecommendations(data.recommendations ?? []);
      setTracked(data.tracked ?? []);
      if (data.databricksHost) setDatabricksHost(data.databricksHost);
    } catch {
      setError("Failed to load Genie recommendations");
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    fetchRecommendations();
    return () => {
      if (regenPollRef.current) {
        clearInterval(regenPollRef.current);
        regenPollRef.current = null;
      }
    };
  }, [fetchRecommendations]);

  useEffect(() => {
    if (refreshKey > 0) fetchRecommendations();
  }, [refreshKey, fetchRecommendations]);

  useEffect(() => {
    setTestResults(null);
    if (!detailDomain) {
      setDetailUseCases([]);
      return;
    }
    const cached = useCaseCache.get(detailDomain);
    if (cached) {
      setDetailUseCases(cached);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingUseCases(true);
      try {
        const res = await fetch(`/api/runs/${runId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const all: UseCase[] = data.useCases ?? [];
        const filtered = all.filter((uc) => uc.domain === detailDomain);
        setUseCaseCache((prev) => new Map(prev).set(detailDomain, filtered));
        setDetailUseCases(filtered);
      } catch {
        toast.error("Failed to load use cases for this domain");
      } finally {
        if (!cancelled) setLoadingUseCases(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detailDomain, runId, useCaseCache]);

  function getTracking(domain: string): TrackedGenieSpace | undefined {
    return tracked.find((t) => t.domain === domain && t.status !== "trashed");
  }

  function isDeployed(domain: string): boolean {
    return !!getTracking(domain);
  }

  function genieSpaceUrl(spaceId: string): string | null {
    if (!databricksHost) return null;
    const host = databricksHost.replace(/\/$/, "");
    return `${host}/genie/rooms/${spaceId}`;
  }

  function isV1Domain(rec: GenieEngineRecommendation): boolean {
    return rec.engineConfigVersion === 0;
  }

  function getDeployStatus(rec: GenieEngineRecommendation): DeployStatus {
    if (!engineEnabled) return { allowed: true, warn: false };
    if (engineGenerating) {
      if (completedDomainNames.includes(rec.domain)) return { allowed: true, warn: false };
      return {
        allowed: false,
        warn: false,
        reason: "Waiting for AI Engine to process this domain…",
      };
    }
    if (isV1Domain(rec)) {
      return {
        allowed: true,
        warn: true,
        reason: "This space has not been AI-enriched. Run the Genie Engine for better results.",
      };
    }
    return { allowed: true, warn: false };
  }

  const hasV1Domains =
    engineEnabled &&
    !engineGenerating &&
    recommendations.some((r) => isV1Domain(r) && !isDeployed(r.domain) && r.tableCount > 0);

  const enhancementCount = recommendations.filter(
    (r) => r.recommendationType === "enhancement",
  ).length;

  const selectableDomains = recommendations
    .filter((r) => !isDeployed(r.domain) && r.tableCount > 0 && getDeployStatus(r).allowed)
    .map((r) => r.domain);

  const allSelected =
    selectableDomains.length > 0 && selectableDomains.every((d) => selected.has(d));

  function toggleSelect(domain: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(selectableDomains));
  }

  function handleBulkDeploy() {
    const toDeploy = recommendations.filter(
      (r) => selected.has(r.domain) && !isDeployed(r.domain) && getDeployStatus(r).allowed,
    );
    if (toDeploy.length === 0) return;
    const v1Count = toDeploy.filter((r) => engineEnabled && isV1Domain(r)).length;
    if (v1Count > 0) {
      toast.warning(
        `${v1Count} space${v1Count !== 1 ? "s have" : " has"} not been AI-enriched. Consider running the Genie Engine first for better results.`,
        { duration: 6000 },
      );
    }
    setDeployModalDomains(toDeploy);
    setDeployModalOpen(true);
  }

  function handleDeployModalComplete() {
    setSelected(new Set());
    setDeployModalOpen(false);
    fetchRecommendations();
  }

  async function openTrashDialog(domain: string) {
    const tracking = getTracking(domain);
    if (!tracking) return;
    setTrashDialogDomain(domain);
    setTrashPreview(null);
    setDropAssetsChecked(true);
    setTrashDialogOpen(true);
    setTrashPreviewLoading(true);
    try {
      const res = await fetch(`/api/genie-spaces/${tracking.spaceId}/trash-preview`);
      if (res.ok) {
        const data = (await res.json()) as TrashPreview;
        setTrashPreview(data);
      }
    } catch {
      toast.error("Failed to load asset preview — you can still trash the space");
    } finally {
      setTrashPreviewLoading(false);
    }
  }

  async function executeTrash() {
    if (!trashDialogDomain) return;
    const tracking = getTracking(trashDialogDomain);
    if (!tracking) return;
    setTrashingDomain(trashDialogDomain);
    setTrashDialogOpen(false);
    try {
      const body: Record<string, unknown> = {};
      if (dropAssetsChecked && trashPreview) {
        body.dropAssets = true;
        body.assetsToDelete = trashPreview.safeToDelete;
      }
      const res = await fetch(`/api/genie-spaces/${tracking.spaceId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to trash space");
      }
      toast.success(`Trashed "${tracking.title}"`);
      await fetchRecommendations();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Trash failed");
    } finally {
      setTrashingDomain(null);
      setTrashDialogDomain(null);
      setTrashPreview(null);
    }
  }

  async function handleTestSpace(domain: string) {
    const tracking = getTracking(domain);
    if (!tracking) return;
    const rec = recommendations.find((r) => r.domain === domain);
    if (!rec) return;
    let sampleQuestions: string[] = [];
    try {
      const parsed = JSON.parse(rec.serializedSpace) as SerializedSpace;
      sampleQuestions = parsed.config.sample_questions.slice(0, 5).map((q) => q.question.join(" "));
    } catch {
      /* use empty */
    }
    if (sampleQuestions.length === 0) {
      toast.error("No sample questions available to test");
      return;
    }
    setTestingDomain(domain);
    setTestResults(null);
    try {
      const res = await fetch(
        `/api/runs/${runId}/genie-engine/${encodeURIComponent(domain)}/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spaceId: tracking.spaceId, questions: sampleQuestions }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Test failed");
        return;
      }
      setTestResults(data.results);
      toast.success(`Test complete: ${data.summary.passed}/${data.summary.total} passed`);
    } catch {
      toast.error("Failed to test Genie Space");
    } finally {
      setTestingDomain(null);
    }
  }

  async function handleRegenerateDomain(domain: string) {
    setRegeneratingDomain(domain);
    try {
      const res = await fetch(`/api/runs/${runId}/genie-engine/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domains: [domain] }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to start regeneration");
        setRegeneratingDomain(null);
        return;
      }
      toast.info(`Regenerating "${domain}"...`);
      if (regenPollRef.current) clearInterval(regenPollRef.current);
      regenPollRef.current = setInterval(async () => {
        try {
          const sr = await fetch(`/api/runs/${runId}/genie-engine/generate/status`);
          if (!sr.ok) return;
          const sd = await sr.json();
          if (sd.status === "completed") {
            if (regenPollRef.current) clearInterval(regenPollRef.current);
            regenPollRef.current = null;
            setRegeneratingDomain(null);
            toast.success(`"${domain}" regenerated`);
            await fetchRecommendations();
          } else if (sd.status === "failed") {
            if (regenPollRef.current) clearInterval(regenPollRef.current);
            regenPollRef.current = null;
            setRegeneratingDomain(null);
            toast.error(sd.error || `"${domain}" regeneration failed`);
          }
        } catch {
          /* retry */
        }
      }, 2000);
    } catch {
      toast.error("Failed to start regeneration");
      setRegeneratingDomain(null);
    }
  }

  const detailRec = detailDomain
    ? (recommendations.find((r) => r.domain === detailDomain) ?? null)
    : null;

  const detailParsed: SerializedSpace | null = detailRec
    ? (() => {
        try {
          return JSON.parse(detailRec.serializedSpace) as SerializedSpace;
        } catch {
          return null;
        }
      })()
    : null;

  const detailMvProposals: MetricViewProposal[] = detailRec?.metricViewProposals
    ? (() => {
        try {
          const parsed = JSON.parse(detailRec.metricViewProposals);
          return Array.isArray(parsed) ? (parsed as MetricViewProposal[]) : [];
        } catch {
          return [];
        }
      })()
    : [];

  const detailTracking = detailDomain ? getTracking(detailDomain) : undefined;

  return {
    loading,
    error,
    recommendations,
    tracked,
    selected,
    detailDomain,
    detailRec,
    detailParsed,
    detailMvProposals,
    detailTracking,
    detailUseCases,
    loadingUseCases,
    testResults,
    testingDomain,
    regeneratingDomain,
    trashingDomain,
    trashDialogOpen,
    trashPreview,
    trashPreviewLoading,
    dropAssetsChecked,
    deployModalOpen,
    deployModalDomains,
    hasV1Domains,
    enhancementCount,
    selectableDomains,
    allSelected,
    getTracking,
    isDeployed,
    isV1Domain,
    getDeployStatus,
    genieSpaceUrl,
    toggleSelect,
    toggleSelectAll,
    setSelected,
    setDetailDomain,
    setDeployModalDomains,
    setDeployModalOpen,
    setTrashDialogOpen,
    setTrashDialogDomain,
    setTrashPreview,
    setDropAssetsChecked,
    handleBulkDeploy,
    handleDeployModalComplete,
    openTrashDialog,
    executeTrash,
    handleTestSpace,
    handleRegenerateDomain,
    fetchRecommendations,
    runId,
  };
}
