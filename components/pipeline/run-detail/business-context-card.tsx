"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Target, TrendingUp, Network, DollarSign, Cpu } from "lucide-react";
import type { BusinessContext } from "@/lib/domain/types";

export function BusinessContextCard({ context }: { context: BusinessContext }) {
  const sections = [
    {
      icon: <Building2 className="h-4 w-4 text-blue-500" />,
      label: "Industries",
      value: context.industries,
    },
    {
      icon: <Target className="h-4 w-4 text-violet-500" />,
      label: "Strategic Goals",
      value: context.strategicGoals,
    },
    {
      icon: <TrendingUp className="h-4 w-4 text-green-500" />,
      label: "Business Priorities",
      value: context.businessPriorities,
    },
    {
      icon: <Cpu className="h-4 w-4 text-amber-500" />,
      label: "Strategic Initiative",
      value: context.strategicInitiative,
    },
    {
      icon: <Network className="h-4 w-4 text-teal-500" />,
      label: "Value Chain",
      value: context.valueChain,
    },
    {
      icon: <DollarSign className="h-4 w-4 text-emerald-500" />,
      label: "Revenue Model",
      value: context.revenueModel,
    },
  ].filter((s) => s.value && s.value.trim().length > 0);

  if (sections.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">AI-Generated Business Context</CardTitle>
        <CardDescription>
          Automatically derived from business name and configuration
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2">
          {sections.map((s) => (
            <div key={s.label} className="rounded-md border bg-muted/30 p-3">
              <div className="mb-1 flex items-center gap-2">
                {s.icon}
                <p className="text-xs font-semibold text-muted-foreground">{s.label}</p>
              </div>
              <p className="text-sm leading-relaxed">{s.value}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
