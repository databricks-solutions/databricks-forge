"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { staggerContainer, staggerItem, fadeInUp } from "@/lib/motion";
import { ArrowRight, ClipboardCheck, FlaskConical, ListChecks, Play } from "lucide-react";

interface SpaceBenchmarksTabProps {
  spaceId: string;
  benchmarkCount: number;
}

const STEPS = [
  {
    step: 1,
    icon: ListChecks,
    title: "Add Questions",
    description: "Define test questions with expected answers in your Space.",
  },
  {
    step: 2,
    icon: Play,
    title: "Run Benchmarks",
    description: "Execute questions against Genie and compare responses.",
  },
  {
    step: 3,
    icon: ClipboardCheck,
    title: "Review Accuracy",
    description: "Analyse pass rates, identify weak spots, and iterate.",
  },
] as const;

export function SpaceBenchmarksTab({ spaceId, benchmarkCount }: SpaceBenchmarksTabProps) {
  const hasBenchmarks = benchmarkCount > 0;

  return (
    <motion.div variants={fadeInUp} initial="hidden" animate="visible" className="space-y-6">
      <Card>
        <CardContent className="py-12">
          <div className="mx-auto max-w-2xl space-y-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <FlaskConical className="size-7 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Benchmark Test Runner</h2>
              <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
                {hasBenchmarks
                  ? `${benchmarkCount} benchmark question${benchmarkCount !== 1 ? "s" : ""} configured. Run them against Genie to measure accuracy, then iterate to improve results.`
                  : "Add benchmark questions to your Space, run them against Genie, and track accuracy over time."}
              </p>
            </div>

            {!hasBenchmarks && (
              <motion.div
                variants={staggerContainer}
                initial="hidden"
                animate="visible"
                className="relative flex items-start justify-center gap-0"
              >
                {STEPS.map(({ step, icon: Icon, title, description }, idx) => (
                  <motion.div key={step} variants={staggerItem} className="flex items-start">
                    {idx > 0 && (
                      <div className="mt-5 flex w-8 items-center justify-center text-muted-foreground/40 sm:w-12">
                        <ArrowRight className="size-4" />
                      </div>
                    )}
                    <div className="flex w-36 flex-col items-center text-center sm:w-44">
                      <div className="relative flex size-10 items-center justify-center rounded-xl border bg-card shadow-sm">
                        <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                          {step}
                        </span>
                        <Icon className="size-4 text-muted-foreground" />
                      </div>
                      <p className="mt-3 text-sm font-semibold leading-tight">{title}</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                        {description}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            )}

            <Button size="lg" asChild>
              <Link href={`/genie/${spaceId}/benchmarks`}>
                <FlaskConical className="mr-2 size-4" />
                Open Test Runner
                <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
