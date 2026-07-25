"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import packageJson from "@/package.json";

interface AboutSettingsProps {
  profile: {
    email: string | null;
    host: string | null;
  } | null;
}

export function AboutSettings({ profile }: AboutSettingsProps) {
  const t = useTranslations("settings.about");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Info className="h-5 w-5" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <Label className="text-xs text-muted-foreground">{t("version_label")}</Label>
            <p className="mt-0.5 text-sm font-medium font-mono">v{packageJson.version}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t("app_label")}</Label>
            <p className="mt-0.5 text-sm font-medium">{t("app_value")}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t("runtime_label")}</Label>
            <p className="mt-0.5 text-sm font-medium font-mono">
              {profile ? t("runtime_apps") : t("runtime_local")}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
