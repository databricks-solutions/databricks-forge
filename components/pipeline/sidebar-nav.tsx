"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { loadSettings } from "@/lib/settings";
import { sidebarVariants, sidebarTransition } from "@/lib/motion";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Menu, PanelLeftClose, PanelLeft } from "lucide-react";
import { VersionBadge } from "@/components/version-badge";
import { useGenieBuild } from "@/components/providers/genie-build-provider";

interface NavItem {
  href: string;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  requiresEmbedding?: boolean;
  requiresBenchmarks?: boolean;
  requiresFabric?: boolean;
  requiresDemoMode?: boolean;
  requiresGenie?: boolean;
  /** Allow Settings to control this item even when another feature gate also applies. */
  menuToggleable?: boolean;
  /** When true, this item is always shown and cannot be toggled off (Settings, Help). */
  alwaysVisible?: boolean;
}

interface NavSection {
  labelKey: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    labelKey: "explore",
    items: [
      { href: "/", labelKey: "dashboard", icon: HomeIcon },
      {
        href: "/ask-forge",
        labelKey: "ask_forge",
        icon: AskForgeIcon,
        requiresEmbedding: true,
        menuToggleable: true,
      },
      { href: "/runs", labelKey: "runs", icon: ListIcon },
    ],
  },
  {
    labelKey: "genie",
    items: [
      { href: "/genie", labelKey: "genie_studio", icon: GenieSpacesIcon, requiresGenie: true },
      {
        href: "/metadata-genie",
        labelKey: "metadata_genie",
        icon: MetadataGenieIcon,
        requiresGenie: true,
      },
    ],
  },
  {
    labelKey: "estate_discovery",
    items: [{ href: "/environment", labelKey: "overview", icon: EnvironmentIcon }],
  },
  {
    labelKey: "estate_health",
    items: [
      { href: "/environment/comments", labelKey: "ai_comments", icon: AICommentsIcon },
      { href: "/assessment", labelKey: "waf_assessment", icon: AssessmentIcon },
    ],
  },
  {
    labelKey: "value",
    items: [
      { href: "/business-value", labelKey: "business_value", icon: PortfolioIcon },
      { href: "/business-value/data-gap", labelKey: "data_gap", icon: DataGapIcon },
      { href: "/business-value/tracking", labelKey: "value_tracking", icon: TrackingIcon },
    ],
  },
  {
    labelKey: "planning",
    items: [
      { href: "/business-value/roadmap", labelKey: "roadmap", icon: RoadmapIcon },
      { href: "/business-value/stakeholders", labelKey: "stakeholders", icon: StakeholdersIcon },
      { href: "/business-value/strategy", labelKey: "strategy", icon: StrategyIcon },
    ],
  },
  {
    labelKey: "library",
    items: [
      { href: "/outcomes", labelKey: "outcome_maps", icon: OutcomeMapIcon },
      {
        href: "/benchmarks",
        labelKey: "benchmarks",
        icon: BenchmarkIcon,
        requiresBenchmarks: true,
      },
    ],
  },
  {
    labelKey: "demo",
    items: [{ href: "/demo", labelKey: "demo_studio", icon: DemoIcon, requiresDemoMode: true }],
  },
  {
    labelKey: "migrate",
    items: [{ href: "/fabric", labelKey: "fabric_pbi", icon: FabricIcon, requiresFabric: true }],
  },
  {
    labelKey: "admin",
    items: [
      {
        href: "/connections",
        labelKey: "connections",
        icon: ConnectionsIcon,
        requiresFabric: true,
      },
      { href: "/settings", labelKey: "settings", icon: SettingsIcon, alwaysVisible: true },
      { href: "/help", labelKey: "help", icon: HelpIcon, alwaysVisible: true },
    ],
  },
];

/**
 * Nav items a user can show/hide from Settings → Menu visibility. Excludes
 * deployment-gated items unless they explicitly opt in (Ask Forge), plus the
 * always-visible Settings/Help. Exported so Settings renders the same list.
 */
export const TOGGLEABLE_NAV_ITEMS: Array<{ href: string; labelKey: string; sectionKey: string }> =
  navSections.flatMap((section) =>
    section.items
      .filter(
        (i) =>
          !i.alwaysVisible &&
          (i.menuToggleable ||
            (!i.requiresGenie &&
              !i.requiresDemoMode &&
              !i.requiresFabric &&
              !i.requiresBenchmarks &&
              !i.requiresEmbedding)),
      )
      .map((i) => ({ href: i.href, labelKey: i.labelKey, sectionKey: section.labelKey })),
  );

function useEmbeddingEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const settings = loadSettings();
    if (!settings.semanticSearchEnabled) return;
    fetch("/api/embeddings/status")
      .then((r) => r.json())
      .then((data) => setEnabled(data.enabled ?? false))
      .catch(() => setEnabled(false));
  }, []);
  return enabled;
}

function useBenchmarksEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const settings = loadSettings();
    if (!settings.benchmarksEnabled) return;
    fetch("/api/benchmarks/status")
      .then((r) => r.json())
      .then((data) => setEnabled(data.enabled ?? false))
      .catch(() => setEnabled(false));
  }, []);
  return enabled;
}

function useDemoModeEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((data) => setEnabled(data.demoModeEnabled ?? false))
      .catch(() => setEnabled(false));
  }, []);
  return enabled;
}

function useFabricEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    fetch("/api/fabric/status")
      .then((r) => r.json())
      .then((data) => setEnabled(data.enabled ?? false))
      .catch(() => setEnabled(false));
  }, []);
  return enabled;
}

function useGenieStudioEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((data) => setEnabled(data.genieStudioEnabled ?? false))
      .catch(() => setEnabled(false));
  }, []);
  return enabled;
}

function readMenuVisibility(): Record<string, boolean> {
  try {
    return loadSettings().menuVisibility ?? {};
  } catch {
    return {};
  }
}

/** Per-item visibility map from local settings (href -> visible). */
function useMenuVisibility(): Record<string, boolean> {
  // Lazy initial read (client-side localStorage) avoids a setState-in-effect.
  const [vis, setVis] = useState<Record<string, boolean>>(readMenuVisibility);
  const refresh = useCallback(() => setVis(readMenuVisibility()), []);
  useEffect(() => {
    // Re-read when another tab/component saves settings.
    window.addEventListener("storage", refresh);
    window.addEventListener("forge-settings-changed", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("forge-settings-changed", refresh);
    };
  }, [refresh]);
  return vis;
}

function NavLinks({ onNavigate, collapsed }: { onNavigate?: () => void; collapsed?: boolean }) {
  const pathname = usePathname();
  const tSections = useTranslations("sidebar.sections");
  const tItems = useTranslations("sidebar.items");
  const embeddingEnabled = useEmbeddingEnabled();
  const benchmarksEnabled = useBenchmarksEnabled();
  const fabricEnabled = useFabricEnabled();
  const demoModeEnabled = useDemoModeEnabled();
  const genieStudioEnabled = useGenieStudioEnabled();
  const menuVisibility = useMenuVisibility();
  const { isAnyActive: hasActiveBuild } = useGenieBuild();

  const visibleSections = useMemo(
    () =>
      navSections
        .map((section) => ({
          ...section,
          items: section.items.filter((item) => {
            if (item.requiresEmbedding && !embeddingEnabled) return false;
            if (item.requiresBenchmarks && !benchmarksEnabled) return false;
            if (item.requiresFabric && !fabricEnabled) return false;
            if (item.requiresDemoMode && !demoModeEnabled) return false;
            if (item.requiresGenie && !genieStudioEnabled) return false;
            // User-hidden via Settings (always-visible items are exempt).
            if (!item.alwaysVisible && menuVisibility[item.href] === false) return false;
            return true;
          }),
        }))
        .filter((section) => section.items.length > 0),
    [
      embeddingEnabled,
      benchmarksEnabled,
      fabricEnabled,
      demoModeEnabled,
      genieStudioEnabled,
      menuVisibility,
    ],
  );

  return (
    <nav className={cn(collapsed ? "px-2 py-3" : "px-3 py-3")}>
      {visibleSections.map((section, sectionIdx) => (
        <div key={section.labelKey}>
          {sectionIdx > 0 && (
            <div className={cn("my-3", collapsed ? "px-1" : "px-2")}>
              <div className="border-t border-sidebar-border/50" />
            </div>
          )}
          {!collapsed && (
            <p className="mb-1.5 mt-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">
              {tSections(section.labelKey)}
            </p>
          )}
          <div className="space-y-0.5">
            {section.items.map((item) => {
              const isParent = section.items.some(
                (s) => s !== item && s.href.startsWith(item.href),
              );
              const isActive =
                item.href === "/" || isParent
                  ? pathname === item.href
                  : (pathname?.startsWith(item.href) ?? false);
              const itemLabel = tItems(item.labelKey);

              const link = (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "group relative flex items-center rounded-lg text-sm font-medium transition-all duration-150",
                    collapsed ? "justify-center p-2" : "gap-3 px-3 py-2",
                    isActive
                      ? "bg-primary/[0.08] text-primary shadow-sm ring-1 ring-primary/10 dark:bg-primary/10 dark:ring-primary/15"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  {isActive && !collapsed && (
                    <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
                  )}
                  <span className="relative">
                    <item.icon className={cn("h-4 w-4 shrink-0", isActive && "text-primary")} />
                    {hasActiveBuild && item.href === "/genie" && (
                      <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-violet-500 animate-pulse" />
                    )}
                  </span>
                  {!collapsed && <span>{itemLabel}</span>}
                </Link>
              );

              if (collapsed) {
                return (
                  <Tooltip key={item.href} delayDuration={0}>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      {itemLabel}
                    </TooltipContent>
                  </Tooltip>
                );
              }

              return link;
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

const SIDEBAR_COLLAPSED_KEY = "forge-sidebar-collapsed";

export function SidebarNav() {
  const tSidebar = useTranslations("sidebar");
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
    }
    return false;
  });

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(!prev));
      return !prev;
    });
  }, []);

  return (
    <motion.aside
      variants={sidebarVariants}
      animate={collapsed ? "collapsed" : "expanded"}
      transition={sidebarTransition}
      className="hidden overflow-hidden border-r bg-gradient-to-b from-sidebar via-sidebar to-sidebar/80 md:flex md:flex-col"
    >
      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-b border-sidebar-border/60",
          collapsed ? "justify-center px-2" : "px-5",
        )}
      >
        <Link href="/" className="flex items-center gap-2.5 font-bold tracking-tight">
          <Image
            src="/databricks-icon.svg"
            alt="Databricks"
            width={22}
            height={23}
            className="shrink-0"
          />
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: "auto" }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.15 }}
                className="overflow-hidden whitespace-nowrap"
              >
                Forge
              </motion.span>
            )}
          </AnimatePresence>
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <NavLinks collapsed={collapsed} />
      </div>
      <div className="shrink-0 border-t border-sidebar-border/60">
        {!collapsed && <VersionBadge />}
        <div className={cn("flex", collapsed ? "justify-center p-2" : "justify-end px-4 py-2")}>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground/60 hover:text-foreground"
            onClick={toggle}
            title={collapsed ? tSidebar("expand") : tSidebar("collapse")}
          >
            {collapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>
        </div>
      </div>
    </motion.aside>
  );
}

export function MobileNav() {
  const tA11y = useTranslations("accessibility");
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu className="h-5 w-5" />
          <span className="sr-only">{tA11y("toggle_nav")}</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-64 p-0">
        <SheetTitle className="sr-only">{tA11y("navigation")}</SheetTitle>
        <div className="flex h-16 items-center border-b px-6">
          <Link
            href="/"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 font-semibold"
          >
            <Image
              src="/databricks-icon.svg"
              alt="Databricks"
              width={22}
              height={23}
              className="shrink-0"
            />
            <span>Forge</span>
          </Link>
        </div>
        <NavLinks onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

// Inline SVG icons (avoids extra dependency)
function AskForgeIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  );
}

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function ListIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </svg>
  );
}

function OutcomeMapIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2 2 7l10 5 10-5-10-5Z" />
      <path d="m2 17 10 5 10-5" />
      <path d="m2 12 10 5 10-5" />
    </svg>
  );
}

function BenchmarkIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v4" />
      <path d="M7 6l2 3" />
      <path d="M17 6l-2 3" />
      <circle cx="12" cy="14" r="7" />
      <path d="m9 14 2 2 4-4" />
    </svg>
  );
}

function AssessmentIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function EnvironmentIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" x2="4" y1="22" y2="15" />
    </svg>
  );
}

function HelpIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function GenieSpacesIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </svg>
  );
}

function DemoIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6" />
      <path d="M10 22h4" />
    </svg>
  );
}

function FabricIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

function ConnectionsIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
      <line x1="8" x2="16" y1="12" y2="12" />
    </svg>
  );
}

function PortfolioIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function RoadmapIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6 7 17l-5-5" />
      <path d="m22 10-7.5 7.5L13 16" />
    </svg>
  );
}

function StrategyIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

function StakeholdersIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function DataGapIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
      <path d="M3 11v6c0 1.66 4.03 3 9 3" />
      <path d="m16 19 2 2 4-4" />
    </svg>
  );
}

function TrackingIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function AICommentsIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 10h.01" />
      <path d="M12 10h.01" />
      <path d="M16 10h.01" />
    </svg>
  );
}

function MetadataGenieIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </svg>
  );
}
