"use client";

import { useEffect, useState, useTransition } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleLeft, Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

function ToggleButton({
  enabled,
  onClick,
  disabled,
  activeColor = "bg-emerald-500",
}: {
  enabled: boolean;
  onClick: () => void;
  disabled?: boolean;
  activeColor?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
        disabled
          ? "cursor-not-allowed bg-muted opacity-50"
          : enabled
            ? `cursor-pointer ${activeColor}`
            : "cursor-pointer bg-muted"
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

export function FeatureFlagsSettings() {
  const t = useTranslations("settings.feature_flags");
  const tToasts = useTranslations("settings.toasts");
  const [demoModeEnabled, setDemoModeEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    fetch("/api/settings/feature-flags")
      .then((r) => r.json())
      .then((data) => setDemoModeEnabled(Boolean(data?.demoModeEnabled)))
      .catch(() => setDemoModeEnabled(false));
  }, []);

  const handleToggleDemoMode = async () => {
    if (demoModeEnabled === null || saving) return;
    const next = !demoModeEnabled;
    setSaving(true);
    try {
      const resp = await fetch("/api/settings/feature-flags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ demoModeEnabled: next }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${resp.status})`);
      }
      const data = await resp.json();
      setDemoModeEnabled(Boolean(data?.demoModeEnabled));
      toast.success(
        next
          ? t("demo_mode.toast_enabled")
          : t("demo_mode.toast_disabled"),
      );
      // Reload so the sidebar nav and the conditional <DemoModeSettings>
      // card pick up the new value (both read from /api/health on mount).
      startTransition(() => {
        window.location.reload();
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tToasts("settings_saved"));
    } finally {
      setSaving(false);
    }
  };

  const isOn = demoModeEnabled === true;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ToggleLeft className="h-5 w-5" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className={`flex items-center justify-between rounded-lg border-2 p-4 transition-colors ${
            isOn ? "border-violet-500/50 bg-violet-500/5" : "border-muted"
          }`}
        >
          <div className="flex items-start gap-3">
            <Wand2
              className={`mt-0.5 h-4 w-4 shrink-0 ${
                isOn ? "text-violet-500" : "text-muted-foreground"
              }`}
            />
            <div>
              <p className="text-sm font-medium">{t("demo_mode.label")}</p>
              <p className="text-xs text-muted-foreground">
                {demoModeEnabled === null
                  ? t("demo_mode.loading")
                  : isOn
                    ? t("demo_mode.enabled")
                    : t("demo_mode.disabled")}
              </p>
            </div>
          </div>
          <ToggleButton
            enabled={isOn}
            onClick={handleToggleDemoMode}
            disabled={demoModeEnabled === null || saving}
            activeColor="bg-violet-500"
          />
        </div>
      </CardContent>
    </Card>
  );
}
