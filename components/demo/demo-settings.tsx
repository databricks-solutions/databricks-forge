"use client";

import { useState, useEffect } from "react";
import { Wand2, ArrowRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useL10n } from "@/i18n/format";
import { DemoWizard } from "./demo-wizard";

export function DemoModeSettings() {
  const t = useTranslations("settings.demo");
  const { integer } = useL10n();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [sessionCount, setSessionCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/demo/sessions")
      .then((r) => r.json())
      .then((data) => setSessionCount(Array.isArray(data) ? data.length : 0))
      .catch(() => setSessionCount(0));
  }, []);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5" />
            {t("title")}
          </CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Button onClick={() => setWizardOpen(true)}>
              <Wand2 className="mr-2 h-4 w-4" />
              {t("launch_button")}
            </Button>
            <Button variant="outline" asChild>
              <Link href="/demo">
                {t("view_sessions")}
                {sessionCount !== null && sessionCount > 0 && (
                  <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium">
                    {integer(sessionCount)}
                  </span>
                )}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <DemoWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </>
  );
}
