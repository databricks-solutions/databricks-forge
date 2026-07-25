"use client";

import { Card, CardContent } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { cn } from "@/lib/utils";

type Sentiment = "positive" | "neutral" | "warning";

const SENTIMENT_BORDER: Record<Sentiment, string> = {
  positive: "border-l-green-500 dark:border-l-green-400",
  neutral: "border-l-border",
  warning: "border-l-amber-500 dark:border-l-amber-400",
};

export interface SummaryCardProps {
  title: string;
  value: string;
  icon?: React.ReactNode;
  tip?: string;
  detail?: string;
  sentiment?: Sentiment;
  onClick?: () => void;
}

export function SummaryCard({
  title,
  value,
  icon,
  tip,
  detail,
  sentiment = "neutral",
  onClick,
}: SummaryCardProps) {
  return (
    <Card
      className={cn(
        "border-l-[3px]",
        SENTIMENT_BORDER[sentiment],
        onClick &&
          "cursor-pointer transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md",
      )}
      onClick={onClick}
    >
      <CardContent className="pt-6">
        <div className="flex items-center gap-2">
          {icon}
          <div className="flex items-center gap-1">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {title}
            </p>
            {tip && <InfoTip tip={tip} />}
          </div>
        </div>
        <p className="mt-2 text-2xl font-bold tracking-tight">{value}</p>
        {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
      </CardContent>
    </Card>
  );
}
