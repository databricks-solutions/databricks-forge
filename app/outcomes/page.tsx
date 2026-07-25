"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Building2,
  Target,
  Users,
  BarChart3,
  Search,
  ChevronRight,
  Lightbulb,
  TrendingUp,
  ArrowRight,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  type IndustryOutcome,
  type IndustryObjective,
  type StrategicPriority,
  type ReferenceUseCase,
} from "@/lib/domain/industry-outcomes";
import { useIndustryOutcomes } from "@/lib/hooks/use-industry-outcomes";
import { PageHeader } from "@/components/page-header";
import { MasterRepoSection } from "@/components/outcomes/master-repo-section";
import { staggerContainer, staggerItem } from "@/lib/motion";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLOR_PALETTE = [
  {
    gradient: "from-blue-500/20 to-blue-600/5 border-blue-200 dark:border-blue-800",
    icon: "text-blue-600 dark:text-blue-400",
  },
  {
    gradient: "from-emerald-500/20 to-emerald-600/5 border-emerald-200 dark:border-emerald-800",
    icon: "text-emerald-600 dark:text-emerald-400",
  },
  {
    gradient: "from-orange-500/20 to-orange-600/5 border-orange-200 dark:border-orange-800",
    icon: "text-orange-600 dark:text-orange-400",
  },
  {
    gradient: "from-violet-500/20 to-violet-600/5 border-violet-200 dark:border-violet-800",
    icon: "text-violet-600 dark:text-violet-400",
  },
  {
    gradient: "from-cyan-500/20 to-cyan-600/5 border-cyan-200 dark:border-cyan-800",
    icon: "text-cyan-600 dark:text-cyan-400",
  },
  {
    gradient: "from-pink-500/20 to-pink-600/5 border-pink-200 dark:border-pink-800",
    icon: "text-pink-600 dark:text-pink-400",
  },
  {
    gradient: "from-amber-500/20 to-amber-600/5 border-amber-200 dark:border-amber-800",
    icon: "text-amber-600 dark:text-amber-400",
  },
  {
    gradient: "from-indigo-500/20 to-indigo-600/5 border-indigo-200 dark:border-indigo-800",
    icon: "text-indigo-600 dark:text-indigo-400",
  },
  {
    gradient: "from-red-500/20 to-red-600/5 border-red-200 dark:border-red-800",
    icon: "text-red-600 dark:text-red-400",
  },
  {
    gradient: "from-teal-500/20 to-teal-600/5 border-teal-200 dark:border-teal-800",
    icon: "text-teal-600 dark:text-teal-400",
  },
  {
    gradient: "from-rose-500/20 to-rose-600/5 border-rose-200 dark:border-rose-800",
    icon: "text-rose-600 dark:text-rose-400",
  },
  {
    gradient: "from-sky-500/20 to-sky-600/5 border-sky-200 dark:border-sky-800",
    icon: "text-sky-600 dark:text-sky-400",
  },
] as const;

const GRID_COLS = 3;

function buildColorAssignments(count: number) {
  const assigned: number[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % GRID_COLS;
    const row = Math.floor(i / GRID_COLS);
    const neighbors = new Set<number>();
    if (col > 0) neighbors.add(assigned[i - 1]);
    if (row > 0) neighbors.add(assigned[i - GRID_COLS]);

    let pick = i % COLOR_PALETTE.length;
    let attempts = 0;
    while (neighbors.has(pick) && attempts < COLOR_PALETTE.length) {
      pick = (pick + 1) % COLOR_PALETTE.length;
      attempts++;
    }
    assigned.push(pick);
  }
  return assigned;
}

function getCardColor(index: number, assignments: number[]) {
  const colorIdx = assignments[index] ?? index % COLOR_PALETTE.length;
  return COLOR_PALETTE[colorIdx];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countUseCases(industry: IndustryOutcome): number {
  return industry.objectives.reduce(
    (acc, obj) => acc + obj.priorities.reduce((a, p) => a + p.useCases.length, 0),
    0,
  );
}

function countPriorities(industry: IndustryOutcome): number {
  return industry.objectives.reduce((acc, obj) => acc + obj.priorities.length, 0);
}

function matchesSearch(industry: IndustryOutcome, query: string): boolean {
  const q = query.toLowerCase();
  if (industry.name.toLowerCase().includes(q)) return true;
  if (industry.subVerticals?.some((sv) => sv.toLowerCase().includes(q))) return true;
  for (const obj of industry.objectives) {
    if (obj.name.toLowerCase().includes(q)) return true;
    for (const pri of obj.priorities) {
      if (pri.name.toLowerCase().includes(q)) return true;
      for (const uc of pri.useCases) {
        if (uc.name.toLowerCase().includes(q)) return true;
        if (uc.description.toLowerCase().includes(q)) return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function OutcomesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { outcomes, loading } = useIndustryOutcomes();
  const searchQuery = searchParams?.get("q") ?? "";
  const selectedId = searchParams?.get("industry");

  const selectedIndustry = useMemo(
    () => (selectedId ? (outcomes.find((i) => i.id === selectedId) ?? null) : null),
    [selectedId, outcomes],
  );

  const filteredIndustries = useMemo(() => {
    if (!searchQuery.trim()) return outcomes;
    return outcomes.filter((i) => matchesSearch(i, searchQuery));
  }, [searchQuery, outcomes]);

  const colorAssignments = useMemo(
    () => buildColorAssignments(filteredIndustries.length),
    [filteredIndustries.length],
  );

  const selectedColor = useMemo(() => {
    if (!selectedId) return getCardColor(0, colorAssignments);
    const idx = filteredIndustries.findIndex((i) => i.id === selectedId);
    return getCardColor(idx >= 0 ? idx : 0, colorAssignments);
  }, [selectedId, filteredIndustries, colorAssignments]);

  const totalUseCases = useMemo(
    () => outcomes.reduce((acc, i) => acc + countUseCases(i), 0),
    [outcomes],
  );

  function setSearchQuery(q: string) {
    const params = new URLSearchParams(searchParams?.toString());
    if (q) {
      params.set("q", q);
    } else {
      params.delete("q");
    }
    params.delete("industry");
    router.replace(`/outcomes?${params.toString()}`);
  }

  function selectIndustry(id: string) {
    router.push(`/outcomes?industry=${encodeURIComponent(id)}`);
  }

  function clearSelection() {
    router.push("/outcomes");
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-8">
      <PageHeader
        title="Industry Outcome Maps"
        subtitle={
          loading
            ? "Loading..."
            : `${outcomes.length} industries \u00b7 ${totalUseCases} reference use cases`
        }
        actions={
          <Button asChild>
            <Link href="/outcomes/ingest">
              <Upload className="mr-2 h-4 w-4" />
              Ingest New Map
            </Link>
          </Button>
        }
      />

      {selectedIndustry ? (
        <IndustryDetailView
          industry={selectedIndustry}
          color={selectedColor}
          onBack={clearSelection}
        />
      ) : (
        <>
          {/* Search */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search industries, priorities, or use cases..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {filteredIndustries.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Search className="mb-3 h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  No industries match &ldquo;{searchQuery}&rdquo;
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => setSearchQuery("")}
                >
                  Clear search
                </Button>
              </CardContent>
            </Card>
          ) : (
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              {filteredIndustries.map((industry, idx) => (
                <motion.div key={industry.id} variants={staggerItem}>
                  <IndustryCard
                    industry={industry}
                    color={getCardColor(idx, colorAssignments)}
                    onClick={() => selectIndustry(industry.id)}
                  />
                </motion.div>
              ))}
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Industry Card (Grid View)
// ---------------------------------------------------------------------------

function IndustryCard({
  industry,
  color,
  onClick,
}: {
  industry: IndustryOutcome;
  color: { gradient: string; icon: string };
  onClick: () => void;
}) {
  const ucCount = countUseCases(industry);
  const priCount = countPriorities(industry);
  const gradientClass = color.gradient;
  const iconColor = color.icon;

  return (
    <Card
      className={`group flex h-full cursor-pointer flex-col border bg-gradient-to-br hover:-translate-y-0.5 hover:shadow-md ${gradientClass}`}
      onClick={onClick}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <Building2 className={`h-5 w-5 shrink-0 ${iconColor}`} />
            <CardTitle className="truncate text-base" title={industry.name}>
              {industry.name}
            </CardTitle>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
        {industry.subVerticals && (
          <CardDescription className="line-clamp-2 text-xs">
            {industry.subVerticals.join(" \u00b7 ")}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between space-y-3">
        <div className="flex flex-wrap gap-1">
          {industry.objectives.map((obj) => (
            <Badge
              key={obj.name}
              variant="secondary"
              className="max-w-full text-xs"
              title={obj.name}
            >
              {obj.name}
            </Badge>
          ))}
        </div>

        <div>
          <Separator />
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Target className="h-3.5 w-3.5" />
              <span>{priCount} priorities</span>
            </div>
            <div className="flex items-center gap-1">
              <Lightbulb className="h-3.5 w-3.5" />
              <span>{ucCount} use cases</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Industry Detail View
// ---------------------------------------------------------------------------

function IndustryDetailView({
  industry,
  color,
  onBack,
}: {
  industry: IndustryOutcome;
  color: { gradient: string; icon: string };
  onBack: () => void;
}) {
  const ucCount = countUseCases(industry);
  const priCount = countPriorities(industry);
  const personaCount = new Set(
    industry.objectives.flatMap((obj) => obj.priorities.flatMap((p) => p.personas)),
  ).size;

  const iconColor = color.icon;

  return (
    <motion.div
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="space-y-8"
    >
      {/* Breadcrumb */}
      <motion.div variants={staggerItem} className="flex items-center gap-2 text-sm">
        <button
          onClick={onBack}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          All Industries
        </button>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium">{industry.name}</span>
      </motion.div>

      {/* Header Card */}
      <motion.div variants={staggerItem}>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br ${color.gradient}`}
              >
                <Building2 className={`h-6 w-6 ${iconColor}`} />
              </div>
              <div>
                <CardTitle className="text-xl">{industry.name}</CardTitle>
                {industry.subVerticals && (
                  <CardDescription>{industry.subVerticals.join(" \u00b7 ")}</CardDescription>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatPill
                icon={<Target className="h-4 w-4 text-violet-500" />}
                label="Objectives"
                value={industry.objectives.length}
              />
              <StatPill
                icon={<TrendingUp className="h-4 w-4 text-blue-500" />}
                label="Strategic Priorities"
                value={priCount}
              />
              <StatPill
                icon={<Lightbulb className="h-4 w-4 text-amber-500" />}
                label="Reference Use Cases"
                value={ucCount}
              />
              <StatPill
                icon={<Users className="h-4 w-4 text-emerald-500" />}
                label="Key Personas"
                value={personaCount}
              />
            </div>

            <Separator className="my-4" />

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Suggested Business Domains
                </p>
                <div className="flex flex-wrap gap-1">
                  {industry.suggestedDomains.map((d) => (
                    <Badge key={d} variant="outline" className="max-w-full text-xs" title={d}>
                      {d}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Suggested Priorities
                </p>
                <div className="flex flex-wrap gap-1">
                  {industry.suggestedPriorities.map((p) => (
                    <Badge key={p} variant="outline" className="max-w-full text-xs" title={p}>
                      {p}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            <Separator className="my-4" />

            <Button asChild size="sm">
              <Link href="/configure">
                <Sparkles className="mr-2 h-4 w-4" />
                Start Discovery with {industry.name}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </motion.div>

      {/* Objectives */}
      {industry.objectives.map((objective) => (
        <motion.div key={objective.name} variants={staggerItem}>
          <ObjectiveSection objective={objective} iconColor={color.icon} />
        </motion.div>
      ))}

      {/* Master Repository v2 -- reference data assets and mapped use cases */}
      <motion.div variants={staggerItem}>
        <MasterRepoSection industryId={industry.id} />
      </motion.div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Objective Section
// ---------------------------------------------------------------------------

function ObjectiveSection({
  objective,
  iconColor,
}: {
  objective: IndustryObjective;
  iconColor: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Target className={`h-5 w-5 ${iconColor}`} />
          <CardTitle className="text-lg">{objective.name}</CardTitle>
        </div>
        <CardDescription className="max-w-3xl leading-relaxed">
          {objective.whyChange}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple" className="space-y-2">
          {objective.priorities.map((priority) => (
            <PriorityAccordion key={priority.name} priority={priority} />
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Priority Accordion
// ---------------------------------------------------------------------------

function PriorityAccordion({ priority }: { priority: StrategicPriority }) {
  return (
    <AccordionItem value={priority.name} className="rounded-lg border bg-muted/20 px-4">
      <AccordionTrigger className="py-3 hover:no-underline">
        <div className="flex items-center gap-3">
          <TrendingUp className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="text-left">
            <span className="text-sm font-medium">{priority.name}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {priority.useCases.length} use case
              {priority.useCases.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pb-4 pt-1">
        <div className="space-y-4">
          <div className="space-y-2">
            {priority.useCases.map((uc) => (
              <UseCaseRow key={uc.name} useCase={uc} />
            ))}
          </div>

          {(priority.kpis.length > 0 || priority.personas.length > 0) && (
            <>
              <Separator />
              <div className="grid gap-4 sm:grid-cols-2">
                {priority.kpis.length > 0 && (
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <BarChart3 className="h-3.5 w-3.5" />
                      Key KPIs
                    </p>
                    <ul className="space-y-0.5">
                      {priority.kpis.map((kpi) => (
                        <li key={kpi} className="text-xs text-foreground/80">
                          {kpi}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {priority.personas.length > 0 && (
                  <div>
                    <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Users className="h-3.5 w-3.5" />
                      Key Personas
                    </p>
                    <ul className="space-y-0.5">
                      {priority.personas.map((persona) => (
                        <li key={persona} className="text-xs text-foreground/80">
                          {persona}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

// ---------------------------------------------------------------------------
// Use Case Row
// ---------------------------------------------------------------------------

function UseCaseRow({ useCase }: { useCase: ReferenceUseCase }) {
  return (
    <div className="rounded-md border bg-background p-3 transition-colors">
      <div className="flex items-start gap-2">
        <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug">{useCase.name}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {useCase.description}
          </p>
          {useCase.businessValue && (
            <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="h-3 w-3" />
              {useCase.businessValue}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat Pill
// ---------------------------------------------------------------------------

function StatPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center gap-1.5">
        {icon}
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </div>
  );
}
