"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { GenieDeployModal } from "./genie-deploy-modal";
import { GenieIcon } from "./genie-spaces-icons";
import { GenieV1WarningBanner } from "./genie-v1-warning-banner";
import { GenieRecommendationTable } from "./genie-recommendation-table";
import { GenieSelectionBar } from "./genie-selection-bar";
import { GenieDetailSheet } from "./genie-detail-sheet";
import { GenieTrashDialog } from "./genie-trash-dialog";
import { useGenieSpacesTab } from "./use-genie-spaces-tab";

interface GenieSpacesTabProps {
  runId: string;
  generating?: boolean;
  completedDomainNames?: string[];
  refreshKey?: number;
  engineEnabled?: boolean;
}

export function GenieSpacesTab({
  runId,
  generating: engineGenerating = false,
  completedDomainNames = [],
  refreshKey = 0,
  engineEnabled = true,
}: GenieSpacesTabProps) {
  const state = useGenieSpacesTab({
    runId,
    engineGenerating,
    completedDomainNames,
    engineEnabled,
    refreshKey,
  });

  const {
    loading,
    error,
    recommendations,
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
  } = state;

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="pt-6">
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (recommendations.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <GenieIcon className="h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            No Genie Space recommendations available for this run. This may be because the metadata
            snapshot was not cached.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {hasV1Domains && <GenieV1WarningBanner enhancementCount={enhancementCount} />}

      <GenieRecommendationTable
        recommendations={recommendations}
        selected={selected}
        selectableDomains={selectableDomains}
        allSelected={allSelected}
        trashingDomain={trashingDomain}
        engineGenerating={engineGenerating}
        engineEnabled={engineEnabled}
        completedDomainNames={completedDomainNames}
        getTracking={getTracking}
        isDeployed={isDeployed}
        isV1Domain={isV1Domain}
        getDeployStatus={getDeployStatus}
        genieSpaceUrl={genieSpaceUrl}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        onOpenDetail={setDetailDomain}
        onOpenTrashDialog={openTrashDialog}
      />

      {selected.size > 0 && (
        <GenieSelectionBar
          selectedCount={selected.size}
          onDeselectAll={() => setSelected(new Set())}
          onDeploy={handleBulkDeploy}
        />
      )}

      {detailRec && detailParsed && (
        <GenieDetailSheet
          open={!!detailDomain}
          onOpenChange={(o) => {
            if (!o) setDetailDomain(null);
          }}
          rec={detailRec}
          parsed={detailParsed}
          mvProposals={detailMvProposals}
          tracking={detailTracking}
          useCases={detailUseCases}
          loadingUseCases={loadingUseCases}
          testResults={testResults}
          testingDomain={testingDomain}
          regeneratingDomain={regeneratingDomain}
          trashingDomain={trashingDomain}
          isV1Domain={isV1Domain}
          getDeployStatus={getDeployStatus}
          genieSpaceUrl={genieSpaceUrl}
          onClose={() => setDetailDomain(null)}
          onRegenerate={handleRegenerateDomain}
          onTest={handleTestSpace}
          onOpenTrashDialog={openTrashDialog}
          onDeploy={(rec) => {
            setDetailDomain(null);
            setDeployModalDomains([rec]);
            setDeployModalOpen(true);
          }}
        />
      )}

      <GenieTrashDialog
        open={trashDialogOpen}
        onOpenChange={setTrashDialogOpen}
        preview={trashPreview}
        previewLoading={trashPreviewLoading}
        dropChecked={dropAssetsChecked}
        onDropCheckedChange={setDropAssetsChecked}
        onConfirm={executeTrash}
        onClose={() => {
          setTrashDialogDomain(null);
          setTrashPreview(null);
        }}
      />

      <GenieDeployModal
        open={deployModalOpen}
        onOpenChange={setDeployModalOpen}
        domains={deployModalDomains}
        runId={runId}
        onComplete={handleDeployModalComplete}
      />
    </div>
  );
}
