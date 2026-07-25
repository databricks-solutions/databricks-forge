"use client";

import {
  TrendingUp,
  AlertTriangle,
  Sparkles,
  Shield,
} from "lucide-react";

interface CompactSwotProps {
  swot: {
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
  };
}

const QUADRANTS = [
  { key: "strengths" as const, label: "S", full: "Strengths", icon: TrendingUp, color: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
  { key: "weaknesses" as const, label: "W", full: "Weaknesses", icon: AlertTriangle, color: "text-red-600 dark:text-red-400", dot: "bg-red-500" },
  { key: "opportunities" as const, label: "O", full: "Opportunities", icon: Sparkles, color: "text-blue-600 dark:text-blue-400", dot: "bg-blue-500" },
  { key: "threats" as const, label: "T", full: "Threats", icon: Shield, color: "text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
] as const;

export function CompactSwot({ swot }: CompactSwotProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {QUADRANTS.map((q) => {
        const items = swot[q.key] ?? [];
        return (
          <div key={q.key} className="rounded-lg border p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <q.icon className={`h-3.5 w-3.5 ${q.color}`} />
              <span className={`text-xs font-semibold ${q.color}`}>{q.full}</span>
            </div>
            <ul className="space-y-1">
              {items.slice(0, 3).map((item, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground leading-snug">
                  <span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${q.dot}`} />
                  <span className="line-clamp-2">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
