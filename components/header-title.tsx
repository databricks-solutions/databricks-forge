"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const PAGE_TITLE_KEYS: Record<string, string> = {
  "/": "dashboard",
  "/configure": "new_discovery",
  "/runs": "runs",
  "/runs/compare": "compare_runs",
  "/environment": "estate_overview",
  "/assessment": "waf_assessment",
  "/assessment/compare": "compare_assessments",
  "/benchmarks": "benchmark_catalog",
  "/outcomes": "outcome_maps",
  "/outcomes/ingest": "ingest_outcome_map",
  "/genie": "genie_spaces",
  "/metadata-genie": "metadata_genie",
  "/settings": "settings",
  "/help": "help",
};

export function HeaderPageTitle() {
  const pathname = usePathname();
  const t = useTranslations("header.page_titles");

  const key =
    PAGE_TITLE_KEYS[pathname ?? ""] ?? (pathname?.startsWith("/runs/") ? "run_detail" : null);

  if (!key) return null;

  return (
    <span className="hidden text-sm font-semibold text-foreground/80 md:block">{t(key)}</span>
  );
}
