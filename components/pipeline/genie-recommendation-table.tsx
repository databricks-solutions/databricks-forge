"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import type { GenieEngineRecommendation, TrackedGenieSpace } from "@/lib/genie/types";
import { GenieIcon } from "./genie-spaces-icons";
import { GenieRecommendationRow, type DeployStatus } from "./genie-recommendation-row";

interface GenieRecommendationTableProps {
  recommendations: GenieEngineRecommendation[];
  selected: Set<string>;
  selectableDomains: string[];
  allSelected: boolean;
  trashingDomain: string | null;
  engineGenerating: boolean;
  engineEnabled: boolean;
  completedDomainNames: string[];
  getTracking: (domain: string) => TrackedGenieSpace | undefined;
  isDeployed: (domain: string) => boolean;
  isV1Domain: (rec: GenieEngineRecommendation) => boolean;
  getDeployStatus: (rec: GenieEngineRecommendation) => DeployStatus;
  genieSpaceUrl: (spaceId: string) => string | null;
  onToggleSelect: (domain: string) => void;
  onToggleSelectAll: () => void;
  onOpenDetail: (domain: string) => void;
  onOpenTrashDialog: (domain: string) => void;
}

export function GenieRecommendationTable({
  recommendations,
  selected,
  selectableDomains,
  allSelected,
  trashingDomain,
  engineGenerating,
  engineEnabled,
  completedDomainNames,
  getTracking,
  isDeployed,
  isV1Domain,
  getDeployStatus,
  genieSpaceUrl,
  onToggleSelect,
  onToggleSelectAll,
  onOpenDetail,
  onOpenTrashDialog,
}: GenieRecommendationTableProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <GenieIcon className="h-4 w-4 text-violet-500" />
          Recommended Genie Spaces ({recommendations.length})
        </CardTitle>
        <CardDescription>
          One space per business domain. Select spaces and deploy them to your Databricks workspace.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="w-10 px-4 py-2.5">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={onToggleSelectAll}
                    disabled={selectableDomains.length === 0}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-3 py-2.5 text-left font-medium">Domain</th>
                <th className="px-3 py-2.5 text-left font-medium">Subdomains</th>
                <th className="px-3 py-2.5 text-center font-medium">Knowledge Store</th>
                <th className="px-3 py-2.5 text-center font-medium">Status</th>
                <th className="w-10 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {recommendations.map((rec) => {
                const deployed = isDeployed(rec.domain);
                const tracking = getTracking(rec.domain);
                const noTables = rec.tableCount === 0;
                const deployStatus = getDeployStatus(rec);

                return (
                  <GenieRecommendationRow
                    key={rec.domain}
                    rec={rec}
                    tracking={tracking}
                    deployed={deployed}
                    noTables={noTables}
                    deployStatus={deployStatus}
                    selected={selected.has(rec.domain)}
                    trashingDomain={trashingDomain}
                    engineGenerating={engineGenerating}
                    engineEnabled={engineEnabled}
                    completedDomainNames={completedDomainNames}
                    isV1Domain={isV1Domain}
                    genieSpaceUrl={genieSpaceUrl}
                    onToggleSelect={onToggleSelect}
                    onOpenDetail={onOpenDetail}
                    onOpenTrashDialog={onOpenTrashDialog}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
