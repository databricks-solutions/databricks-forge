"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { User } from "lucide-react";
import { useTranslations } from "next-intl";

interface ProfileSettingsProps {
  profile: {
    email: string | null;
    host: string | null;
  } | null;
}

export function ProfileSettings({ profile }: ProfileSettingsProps) {
  const t = useTranslations("settings.profile");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label className="text-xs text-muted-foreground">{t("email_label")}</Label>
            <p className="mt-0.5 text-sm font-medium">
              {profile?.email ?? t("email_unavailable")}
            </p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t("host_label")}</Label>
            <p className="mt-0.5 text-sm font-medium font-mono">
              {profile?.host ?? t("host_disconnected")}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
