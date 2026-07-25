"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { InfoTip } from "@/components/ui/info-tip";
import { SETTINGS } from "@/lib/help-text";
import type {
  GenieEngineDefaults,
  GenieAuthMode,
  QualityPreset,
  QuestionComplexity,
  QuestionComplexitySettings,
} from "@/lib/settings";

const QUALITY_PRESETS: QualityPreset[] = ["speed", "balanced", "premium"];
const ENTITY_MODES = ["auto", "manual", "off"] as const;
const COMPLEXITY_LEVELS: QuestionComplexity[] = ["simple", "medium", "complex"];
const COMPLEXITY_SURFACES: { key: keyof QuestionComplexitySettings; tKey: string }[] = [
  { key: "genieEngine", tKey: "genie_engine" },
  { key: "adhocGenie", tKey: "adhoc_genie" },
  { key: "metadataGenie", tKey: "metadata_genie" },
];
const DEPLOY_AUTH_MODES: GenieAuthMode[] = ["obo", "sp"];

function GenieToggle({
  label,
  description,
  checked,
  onToggle,
}: {
  label: string;
  description: string;
  checked: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!checked)}
      className={`rounded-lg border-2 p-4 text-left transition-colors ${
        checked ? "border-violet-500/50 bg-violet-500/5" : "border-muted text-muted-foreground"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <div className={`h-4 w-4 rounded-full ${checked ? "bg-violet-500" : "bg-muted"}`} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </button>
  );
}

interface GenieDefaultsSettingsProps {
  genieDefaults: GenieEngineDefaults;
  onGenieDefaultsChange: (
    value: GenieEngineDefaults | ((prev: GenieEngineDefaults) => GenieEngineDefaults),
  ) => void;
  genieDeployAuthMode: GenieAuthMode;
  onGenieDeployAuthModeChange: (value: GenieAuthMode) => void;
  questionComplexity: QuestionComplexitySettings;
  onQuestionComplexityChange: (
    value:
      | QuestionComplexitySettings
      | ((prev: QuestionComplexitySettings) => QuestionComplexitySettings),
  ) => void;
  metricViewsServerEnabled: boolean;
}

export function GenieDefaultsSettings({
  genieDefaults,
  onGenieDefaultsChange,
  genieDeployAuthMode,
  onGenieDeployAuthModeChange,
  questionComplexity,
  onQuestionComplexityChange,
  metricViewsServerEnabled,
}: GenieDefaultsSettingsProps) {
  const t = useTranslations("settings.genie");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          {t("title")}
          <InfoTip tip={SETTINGS.genieEngine} />
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div
          className={`flex items-center justify-between rounded-lg border-2 p-4 transition-colors ${
            genieDefaults.engineEnabled ? "border-violet-500/50 bg-violet-500/5" : "border-muted"
          }`}
        >
          <div>
            <p className="text-sm font-medium">{t("engine.label")}</p>
            <p className="text-xs text-muted-foreground">
              {genieDefaults.engineEnabled ? t("engine.enabled") : t("engine.disabled")}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              onGenieDefaultsChange((prev) => ({
                ...prev,
                engineEnabled: !prev.engineEnabled,
              }))
            }
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              genieDefaults.engineEnabled ? "bg-violet-500" : "bg-muted"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${
                genieDefaults.engineEnabled ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>

        <div className={genieDefaults.engineEnabled ? "" : "pointer-events-none opacity-50"}>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label>{t("quality_preset.label")}</Label>
              <InfoTip tip={SETTINGS.qualityPreset} />
            </div>
            <div className="flex gap-2">
              {QUALITY_PRESETS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() =>
                    onGenieDefaultsChange((prev) => ({
                      ...prev,
                      qualityPreset: value,
                    }))
                  }
                  className={`flex-1 rounded-lg border-2 p-3 text-left transition-colors ${
                    genieDefaults.qualityPreset === value
                      ? "border-violet-500/50 bg-violet-500/5"
                      : "border-muted text-muted-foreground hover:border-muted-foreground/30"
                  }`}
                >
                  <span className="text-sm font-medium">
                    {t(`quality_preset.options.${value}.label`)}
                  </span>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {t(`quality_preset.options.${value}.desc`)}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <Separator className="my-4" />

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="maxTables">{t("max_tables.label")}</Label>
                <InfoTip tip={SETTINGS.maxTables} />
              </div>
              <div className="flex items-center gap-3">
                <Input
                  id="maxTables"
                  type="number"
                  min={1}
                  max={30}
                  value={genieDefaults.maxTablesPerSpace}
                  onChange={(e) =>
                    onGenieDefaultsChange((prev) => ({
                      ...prev,
                      maxTablesPerSpace: Math.min(30, Math.max(1, parseInt(e.target.value) || 25)),
                    }))
                  }
                  className="w-24"
                />
                <span className="text-xs text-muted-foreground">{t("max_tables.suffix")}</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="fiscalMonth">{t("fiscal_month.label")}</Label>
                <InfoTip tip={SETTINGS.fiscalYear} />
              </div>
              <Select
                value={String(genieDefaults.fiscalYearStartMonth)}
                onValueChange={(v) =>
                  onGenieDefaultsChange((prev) => ({
                    ...prev,
                    fiscalYearStartMonth: parseInt(v),
                  }))
                }
              >
                <SelectTrigger id="fiscalMonth" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 12 }, (_, idx) => idx + 1).map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {t(`months.${m}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <Label htmlFor="maxAutoSpaces">{t("max_auto_spaces.label")}</Label>
            <div className="flex items-center gap-3">
              <Input
                id="maxAutoSpaces"
                type="number"
                min={0}
                max={50}
                value={genieDefaults.maxAutoSpaces}
                onChange={(e) =>
                  onGenieDefaultsChange((prev) => ({
                    ...prev,
                    maxAutoSpaces: Math.min(50, Math.max(0, parseInt(e.target.value) || 0)),
                  }))
                }
                className="w-24"
              />
              <span className="text-xs text-muted-foreground">{t("max_auto_spaces.suffix")}</span>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-1.5">
              <Label>{t("entity_matching.label")}</Label>
              <InfoTip tip={SETTINGS.entityMatching} />
            </div>
            <div className="flex gap-2">
              {ENTITY_MODES.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() =>
                    onGenieDefaultsChange((prev) => ({
                      ...prev,
                      entityMatchingMode: value,
                    }))
                  }
                  className={`rounded-md border-2 px-3 py-1.5 text-xs font-medium transition-colors ${
                    genieDefaults.entityMatchingMode === value
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-muted text-muted-foreground hover:border-muted-foreground/30"
                  }`}
                >
                  {t(`entity_matching.options.${value}`)}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">{t("entity_matching.hint")}</p>
          </div>

          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-1.5">
              <Label>{t("question_complexity.label")}</Label>
              <InfoTip tip={t("question_complexity.tip")} />
            </div>
            {COMPLEXITY_SURFACES.map((surface) => (
              <div key={surface.key} className="flex items-center gap-3">
                <span className="w-32 text-xs text-muted-foreground">
                  {t(`question_complexity.surfaces.${surface.tKey}`)}
                </span>
                <div className="flex gap-1.5">
                  {COMPLEXITY_LEVELS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() =>
                        onQuestionComplexityChange((prev) => ({
                          ...prev,
                          [surface.key]: value,
                        }))
                      }
                      className={`rounded-md border-2 px-3 py-1.5 text-xs font-medium transition-colors ${
                        questionComplexity[surface.key] === value
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-muted text-muted-foreground hover:border-muted-foreground/30"
                      }`}
                    >
                      {t(`question_complexity.options.${value}`)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">{t("question_complexity.hint")}</p>
          </div>

          <Separator className="my-4" />

          <div className="grid gap-3 md:grid-cols-2">
            <GenieToggle
              label={t("toggles.llm_refinement.label")}
              description={t("toggles.llm_refinement.description")}
              checked={genieDefaults.llmRefinement}
              onToggle={(v) => onGenieDefaultsChange((prev) => ({ ...prev, llmRefinement: v }))}
            />
            <GenieToggle
              label={t("toggles.trusted_assets.label")}
              description={t("toggles.trusted_assets.description")}
              checked={genieDefaults.generateTrustedAssets}
              onToggle={(v) =>
                onGenieDefaultsChange((prev) => ({ ...prev, generateTrustedAssets: v }))
              }
            />
            <GenieToggle
              label={t("toggles.auto_benchmarks.label")}
              description={t("toggles.auto_benchmarks.description")}
              checked={genieDefaults.generateBenchmarks}
              onToggle={(v) =>
                onGenieDefaultsChange((prev) => ({ ...prev, generateBenchmarks: v }))
              }
            />
            {metricViewsServerEnabled && (
              <GenieToggle
                label={t("toggles.metric_views.label")}
                description={t("toggles.metric_views.description")}
                checked={genieDefaults.generateMetricViews}
                onToggle={(v) =>
                  onGenieDefaultsChange((prev) => ({ ...prev, generateMetricViews: v }))
                }
              />
            )}
            <GenieToggle
              label={t("toggles.auto_time_periods.label")}
              description={t("toggles.auto_time_periods.description")}
              checked={genieDefaults.autoTimePeriods}
              onToggle={(v) => onGenieDefaultsChange((prev) => ({ ...prev, autoTimePeriods: v }))}
            />
          </div>

          <Separator className="my-4" />

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label>{t("deploy_auth.label")}</Label>
              <InfoTip tip={t("deploy_auth.tip")} />
            </div>
            <div className="flex gap-2">
              {DEPLOY_AUTH_MODES.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onGenieDeployAuthModeChange(value)}
                  className={`rounded-md border-2 px-3 py-1.5 text-xs font-medium transition-colors ${
                    genieDeployAuthMode === value
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-muted text-muted-foreground hover:border-muted-foreground/30"
                  }`}
                >
                  {t(`deploy_auth.options.${value}`)}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              {genieDeployAuthMode === "obo" ? t("deploy_auth.hint_obo") : t("deploy_auth.hint_sp")}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
