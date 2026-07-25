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
import { FileText, FolderOpen, Tag } from "lucide-react";
import { useTranslations } from "next-intl";
import { InfoTip } from "@/components/ui/info-tip";
import { SETTINGS } from "@/lib/help-text";

interface ExportSettingsProps {
  defaultExportFormat: string;
  onDefaultExportFormatChange: (value: string) => void;
  notebookPath: string;
  onNotebookPathChange: (value: string) => void;
  catalogResourcePrefix: string;
  onCatalogResourcePrefixChange: (value: string) => void;
}

export function ExportSettings({
  defaultExportFormat,
  onDefaultExportFormatChange,
  notebookPath,
  onNotebookPathChange,
  catalogResourcePrefix,
  onCatalogResourcePrefixChange,
}: ExportSettingsProps) {
  const t = useTranslations("settings.export");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="defaultExport">{t("format_label")}</Label>
              <InfoTip tip={SETTINGS.exportFormat} />
            </div>
            <Select value={defaultExportFormat} onValueChange={onDefaultExportFormatChange}>
              <SelectTrigger id="defaultExport" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="excel">{t("format_options.excel")}</SelectItem>
                <SelectItem value="pdf">{t("format_options.pdf")}</SelectItem>
                <SelectItem value="pptx">{t("format_options.pptx")}</SelectItem>
                <SelectItem value="notebooks">{t("format_options.notebooks")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="notebookPath">{t("notebook_path_label")}</Label>
              <InfoTip tip={SETTINGS.notebookPath} />
            </div>
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
              <Input
                id="notebookPath"
                value={notebookPath}
                onChange={(e) => onNotebookPathChange(e.target.value)}
                placeholder="./forge_gen/"
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="catalogResourcePrefix">{t("prefix_label")}</Label>
            <InfoTip tip={t("prefix_tip")} />
          </div>
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-muted-foreground" />
            <Input
              id="catalogResourcePrefix"
              value={catalogResourcePrefix}
              onChange={(e) => {
                const v = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
                onCatalogResourcePrefixChange(v);
              }}
              placeholder="forge_"
              className="w-48"
            />
          </div>
          <p className="text-[10px] text-muted-foreground">
            {t("prefix_example_pre")}{" "}
            <code className="font-mono">{catalogResourcePrefix || "forge_"}</code>,{" "}
            {t("prefix_example_view")} <code className="font-mono">order_revenue</code>{" "}
            {t("prefix_example_becomes")}{" "}
            <code className="font-mono">{catalogResourcePrefix || "forge_"}order_revenue</code>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
