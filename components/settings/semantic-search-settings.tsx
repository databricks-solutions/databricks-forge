"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BrainCircuit, Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useL10n } from "@/i18n/format";

interface SemanticSearchSettingsProps {
  semanticSearchEnabled: boolean;
  onSemanticSearchEnabledChange: (value: boolean) => void;
  embeddingCount: number | null;
  rebuildingEmbeddings: boolean;
  onRebuildEmbeddings: () => void;
}

function ToggleButton({ enabled, onClick }: { enabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
        enabled ? "bg-violet-500" : "bg-muted"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${
          enabled ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export function SemanticSearchSettings({
  semanticSearchEnabled,
  onSemanticSearchEnabledChange,
  embeddingCount,
  rebuildingEmbeddings,
  onRebuildEmbeddings,
}: SemanticSearchSettingsProps) {
  const t = useTranslations("settings.semantic_search");
  const { integer } = useL10n();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BrainCircuit className="h-5 w-5" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={`flex items-center justify-between rounded-lg border-2 p-4 transition-colors ${
            semanticSearchEnabled ? "border-violet-500/50 bg-violet-500/5" : "border-muted"
          }`}
        >
          <div>
            <p className="text-sm font-medium">{t("toggle.label")}</p>
            <p className="text-xs text-muted-foreground">
              {semanticSearchEnabled ? t("toggle.enabled") : t("toggle.disabled")}
            </p>
          </div>
          <ToggleButton
            enabled={semanticSearchEnabled}
            onClick={() => onSemanticSearchEnabledChange(!semanticSearchEnabled)}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="text-sm font-medium">{t("rebuild.label")}</p>
            <p className="text-xs text-muted-foreground">
              {t("rebuild.description")}
              {embeddingCount !== null && (
                <span className="ml-1 font-medium">
                  {t("rebuild.vectors_stored", { count: integer(embeddingCount) })}
                </span>
              )}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={onRebuildEmbeddings}
            disabled={rebuildingEmbeddings}
          >
            {rebuildingEmbeddings ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {rebuildingEmbeddings ? t("rebuild.running") : t("rebuild.idle")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
