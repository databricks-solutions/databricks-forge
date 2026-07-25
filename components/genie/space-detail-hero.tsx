"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fadeInUp } from "@/lib/motion";
import { ArrowLeft, BrainCircuit, ExternalLink, Loader2 } from "lucide-react";
import type { Grade } from "@/lib/genie/health-checks/types";

interface SpaceDetailHeroProps {
  title: string;
  description?: string;
  grade?: Grade;
  overallScore?: number;
  source: string;
  genieUrl: string;
  canImprove: boolean;
  improving: boolean;
  fixing: boolean;
  onImprove: () => void;
}

function GradeBadge({ grade, score }: { grade: Grade; score: number }) {
  const cls =
    grade === "A" || grade === "B"
      ? "bg-green-100 text-green-700 border-green-300 dark:bg-green-900/40 dark:text-green-400 dark:border-green-700"
      : grade === "C"
        ? "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/40 dark:text-amber-400 dark:border-amber-700"
        : "bg-red-100 text-red-700 border-red-300 dark:bg-red-900/40 dark:text-red-400 dark:border-red-700";

  return (
    <div
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold ${cls}`}
      title={`Health: ${grade} (${score}/100)`}
    >
      <span className="text-sm">{grade}</span>
      <span className="font-medium opacity-70">{score}</span>
    </div>
  );
}

export function SpaceDetailHero({
  title,
  description,
  grade,
  overallScore,
  source,
  genieUrl,
  canImprove,
  improving,
  fixing,
  onImprove,
}: SpaceDetailHeroProps) {
  return (
    <motion.div variants={fadeInUp} initial="hidden" animate="visible" className="space-y-3">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link
          href="/genie"
          className="flex items-center gap-1 transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Genie Spaces
        </Link>
        <span>/</span>
        <span className="truncate font-medium text-foreground">{title}</span>
      </nav>

      {/* Hero card */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-card via-card to-accent/30 dark:from-card dark:via-card dark:to-primary/5">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.03] dark:opacity-[0.04]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M30 5L55 20V40L30 55L5 40V20L30 5Z' fill='none' stroke='%23FF3621' stroke-width='0.5'/%3E%3C/svg%3E")`,
            backgroundSize: "60px 60px",
          }}
        />

        <div className="relative flex flex-col gap-4 px-8 py-8 sm:px-10 sm:py-10 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
          <div className="flex min-w-0 items-center gap-5">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 shadow-sm ring-1 ring-primary/10">
              <BrainCircuit className="size-7 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <h1 className="truncate text-2xl font-extrabold tracking-tight sm:text-3xl">
                  {title}
                </h1>
                <div className="flex shrink-0 items-center gap-2">
                  {grade != null && overallScore != null && (
                    <GradeBadge grade={grade} score={overallScore} />
                  )}
                  <Badge
                    variant={source === "pipeline" ? "secondary" : "outline"}
                    className="text-xs"
                  >
                    {source === "pipeline" ? "Pipeline" : "Workspace"}
                  </Badge>
                </div>
              </div>
              {description && (
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {canImprove && (
              <Button onClick={onImprove} disabled={improving || fixing} className="gap-2">
                {improving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <BrainCircuit className="size-4" />
                )}
                Improve with Genie Engine
              </Button>
            )}
            {genieUrl && (
              <Button variant="outline" asChild>
                <a href={genieUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1.5 size-4" />
                  Open in Databricks
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
