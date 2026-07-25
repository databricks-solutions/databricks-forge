"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Database, Shield } from "lucide-react";
import { useTranslations } from "next-intl";
import { InfoTip } from "@/components/ui/info-tip";
import { SETTINGS } from "@/lib/help-text";

interface DataSamplingSettingsProps {
  sampleRowsPerTable: number;
  onSampleRowsPerTableChange: (value: number) => void;
}

export function DataSamplingSettings({
  sampleRowsPerTable,
  onSampleRowsPerTableChange,
}: DataSamplingSettingsProps) {
  const t = useTranslations("settings.data_sampling");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="sampleRows">{t("rows_label")}</Label>
            <InfoTip tip={SETTINGS.sampleRows} />
          </div>
          <Select
            value={String(sampleRowsPerTable)}
            onValueChange={(v) => onSampleRowsPerTableChange(parseInt(v, 10))}
          >
            <SelectTrigger id="sampleRows" className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">{t("options.disabled")}</SelectItem>
              <SelectItem value="5">{t("options.n5")}</SelectItem>
              <SelectItem value="10">{t("options.n10")}</SelectItem>
              <SelectItem value="25">{t("options.n25")}</SelectItem>
              <SelectItem value="50">{t("options.n50")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="flex items-start gap-2">
            <Shield className="mt-0.5 h-4 w-4 text-amber-500" />
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{t("privacy_heading")}</p>
              <p className="mt-1">
                {t("privacy_body_pre")} <strong>{t("privacy_body_emphasis")}</strong>{" "}
                {t("privacy_body_post")}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
