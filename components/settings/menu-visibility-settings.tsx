"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BookOpen, Eye, ExternalLink } from "lucide-react";
import { loadSettings, saveSettings } from "@/lib/settings";
import { TOGGLEABLE_NAV_ITEMS } from "@/components/pipeline/sidebar-nav";
import { useTranslations } from "next-intl";

function Toggle({
  enabled,
  onClick,
}: {
  enabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
        enabled ? "cursor-pointer bg-emerald-500" : "cursor-pointer bg-muted"
      }`}
      aria-pressed={enabled}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${
          enabled ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

/**
 * Menu visibility: per-item toggles for the sidebar, persisted in local
 * settings. Also hosts the Knowledge Base entry (moved out of the sidebar).
 */
export function MenuVisibilitySettings() {
  const tItems = useTranslations("sidebar.items");
  const tSections = useTranslations("sidebar.sections");
  const [visibility, setVisibility] = useState<Record<string, boolean>>(
    () => loadSettings().menuVisibility ?? {},
  );

  const isVisible = (href: string) => visibility[href] !== false; // default-on

  const toggle = (href: string) => {
    const next = { ...visibility, [href]: !isVisible(href) };
    setVisibility(next);
    saveSettings({ menuVisibility: next });
    // Notify the sidebar (same tab) to re-read immediately.
    window.dispatchEvent(new Event("forge-settings-changed"));
  };

  // Group the toggleable items by their sidebar section for a tidy list.
  const grouped = TOGGLEABLE_NAV_ITEMS.reduce<Record<string, typeof TOGGLEABLE_NAV_ITEMS>>(
    (acc, item) => {
      (acc[item.sectionKey] ??= []).push(item);
      return acc;
    },
    {},
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eye className="h-5 w-5" />
          Menu visibility
        </CardTitle>
        <CardDescription>
          Show or hide individual sidebar items. Hidden items can be re-enabled here at any time.
          Settings and Help are always shown.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {Object.entries(grouped).map(([sectionKey, items]) => (
          <div key={sectionKey}>
            <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wide">
              {tSections(sectionKey)}
            </p>
            <div className="space-y-1.5">
              {items.map((item) => (
                <div
                  key={item.href}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <span className="text-sm">{tItems(item.labelKey)}</span>
                  <Toggle enabled={isVisible(item.href)} onClick={() => toggle(item.href)} />
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Knowledge Base lives here now (moved out of the sidebar). */}
        <div className="border-t pt-4">
          <p className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wide">
            Knowledge base
          </p>
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <BookOpen className="text-muted-foreground h-4 w-4" />
              Documents &amp; RAG sources used by Ask Forge
            </div>
            <Link href="/knowledge-base">
              <Button variant="outline" size="sm">
                Open
                <ExternalLink className="ml-1 h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
