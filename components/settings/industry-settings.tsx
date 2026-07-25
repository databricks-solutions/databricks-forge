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
import { Building2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useIndustryOutcomes } from "@/lib/hooks/use-industry-outcomes";

interface IndustrySettingsProps {
  industry: string;
  onIndustryChange: (value: string) => void;
}

export function IndustrySettings({ industry, onIndustryChange }: IndustrySettingsProps) {
  const t = useTranslations("settings.industry");
  const { getOptions, loading } = useIndustryOutcomes();
  const options = getOptions();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="globalIndustry">{t("label")}</Label>
          <Select
            value={industry || "__none__"}
            onValueChange={(v) => onIndustryChange(v === "__none__" ? "" : v)}
            disabled={loading}
          >
            <SelectTrigger id="globalIndustry" className="w-80">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <SelectValue placeholder={t("placeholder")} />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("not_set")}</SelectItem>
              {options.map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>
                  {opt.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {industry ? t("when_set") : t("when_unset")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
