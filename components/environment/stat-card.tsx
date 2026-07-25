"use client";

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";

export interface StatCardProps {
  title: string;
  value: string | number;
  icon?: React.ReactNode;
  alert?: boolean;
  tooltip?: string;
}

export function StatCard({ title, value, icon, alert, tooltip }: StatCardProps) {
  return (
    <Card className={alert ? "border-orange-300 bg-orange-50/50 dark:bg-orange-950/10" : ""}>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
          {icon}
          {title}
          {tooltip && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 text-muted-foreground/50 cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[260px]">
                {tooltip}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
