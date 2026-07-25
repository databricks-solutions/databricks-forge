"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Target, Scale, Layers } from "lucide-react";
import { useTranslations } from "next-intl";
import { InfoTip } from "@/components/ui/info-tip";
import { SETTINGS } from "@/lib/help-text";
import {
  DEFAULT_DEPTH_CONFIGS,
  LINEAGE_DIRECTIONS,
  type DiscoveryDepth,
  type DiscoveryDepthConfig,
  type LineageDirection,
} from "@/lib/domain/types";

interface DiscoveryDepthSettingsProps {
  defaultDiscoveryDepth: DiscoveryDepth;
  onDefaultDiscoveryDepthChange: (value: DiscoveryDepth) => void;
  depthConfigs: Record<DiscoveryDepth, DiscoveryDepthConfig>;
  onDepthConfigsChange: (value: Record<DiscoveryDepth, DiscoveryDepthConfig>) => void;
  updateDepthParam: (depth: DiscoveryDepth, key: keyof DiscoveryDepthConfig, value: number) => void;
}

const DEPTH_ICONS: Record<DiscoveryDepth, typeof Target> = {
  focused: Target,
  balanced: Scale,
  comprehensive: Layers,
};

const DEPTH_VALUES: DiscoveryDepth[] = ["focused", "balanced", "comprehensive"];

export function DiscoveryDepthSettings({
  defaultDiscoveryDepth,
  onDefaultDiscoveryDepthChange,
  depthConfigs,
  onDepthConfigsChange,
  updateDepthParam,
}: DiscoveryDepthSettingsProps) {
  const t = useTranslations("settings.discovery_depth");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>{t("default_label")}</Label>
          <div className="flex gap-2">
            {DEPTH_VALUES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => onDefaultDiscoveryDepthChange(d)}
                className={`rounded-md border-2 px-4 py-2 text-sm font-medium transition-colors ${
                  defaultDiscoveryDepth === d
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-muted text-muted-foreground hover:border-muted-foreground/30"
                }`}
              >
                {t(`options.${d}.label`)}
              </button>
            ))}
          </div>
        </div>

        <Separator />

        <div className="grid gap-4 lg:grid-cols-3">
          {DEPTH_VALUES.map((value) => {
            const cfg = depthConfigs[value];
            const defaults = DEFAULT_DEPTH_CONFIGS[value];
            const Icon = DEPTH_ICONS[value];
            const isDefault = defaultDiscoveryDepth === value;
            return (
              <div
                key={value}
                className={`rounded-lg border-2 p-4 space-y-4 ${
                  isDefault ? "border-primary/50 bg-primary/5" : "border-muted"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon
                    className={`h-4 w-4 ${isDefault ? "text-primary" : "text-muted-foreground"}`}
                  />
                  <span className="text-sm font-semibold">{t(`options.${value}.label`)}</span>
                  {isDefault && (
                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      {t("default_badge")}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t(`options.${value}.description`)}
                </p>

                <div className="space-y-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <Label className="text-xs">{t("batch_target_label")}</Label>
                      <InfoTip tip={SETTINGS.batchTarget} />
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        max={50}
                        value={cfg.batchTargetMin}
                        onChange={(e) =>
                          updateDepthParam(
                            value,
                            "batchTargetMin",
                            parseInt(e.target.value) || defaults.batchTargetMin,
                          )
                        }
                        className="w-20 h-8 text-sm"
                      />
                      <span className="text-xs text-muted-foreground">{t("batch_target_to")}</span>
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        value={cfg.batchTargetMax}
                        onChange={(e) =>
                          updateDepthParam(
                            value,
                            "batchTargetMax",
                            parseInt(e.target.value) || defaults.batchTargetMax,
                          )
                        }
                        className="w-20 h-8 text-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <Label className="text-xs">{t("quality_floor_label")}</Label>
                      <InfoTip tip={SETTINGS.qualityFloor} />
                    </div>
                    <Input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={cfg.qualityFloor}
                      onChange={(e) =>
                        updateDepthParam(
                          value,
                          "qualityFloor",
                          parseFloat(e.target.value) || defaults.qualityFloor,
                        )
                      }
                      className="w-24 h-8 text-sm"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <Label className="text-xs">{t("adaptive_cap_label")}</Label>
                      <InfoTip tip={SETTINGS.adaptiveCap} />
                    </div>
                    <Input
                      type="number"
                      min={10}
                      max={1000}
                      step={5}
                      value={cfg.adaptiveCap}
                      onChange={(e) =>
                        updateDepthParam(
                          value,
                          "adaptiveCap",
                          parseInt(e.target.value) || defaults.adaptiveCap,
                        )
                      }
                      className="w-24 h-8 text-sm"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <Label className="text-xs">{t("lineage_depth_label")}</Label>
                      <InfoTip tip={SETTINGS.lineageDepth} />
                    </div>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      value={cfg.lineageDepth}
                      onChange={(e) =>
                        updateDepthParam(
                          value,
                          "lineageDepth",
                          parseInt(e.target.value) || defaults.lineageDepth,
                        )
                      }
                      className="w-24 h-8 text-sm"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <Checkbox
                        id={`lineage-enabled-${value}`}
                        checked={cfg.lineageEnabled ?? true}
                        onCheckedChange={(checked) =>
                          onDepthConfigsChange({
                            ...depthConfigs,
                            [value]: { ...cfg, lineageEnabled: checked === true },
                          })
                        }
                      />
                      <Label htmlFor={`lineage-enabled-${value}`} className="text-xs">
                        {t("lineage_enabled_label")}
                      </Label>
                      <InfoTip tip={SETTINGS.lineageEnabled} />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <Label className="text-xs">{t("lineage_direction_label")}</Label>
                      <InfoTip tip={SETTINGS.lineageDirection} />
                    </div>
                    <Select
                      value={cfg.lineageDirection ?? defaults.lineageDirection}
                      disabled={cfg.lineageEnabled === false}
                      onValueChange={(v) =>
                        onDepthConfigsChange({
                          ...depthConfigs,
                          [value]: { ...cfg, lineageDirection: v as LineageDirection },
                        })
                      }
                    >
                      <SelectTrigger size="sm" className="w-36 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LINEAGE_DIRECTIONS.map((dir) => (
                          <SelectItem key={dir} value={dir}>
                            {t(`lineage_direction_options.${dir}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onDepthConfigsChange({ ...depthConfigs, [value]: { ...defaults } })
                  }
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
                >
                  {t("reset_defaults")}
                </button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
