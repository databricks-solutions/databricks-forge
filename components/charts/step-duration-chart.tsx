"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface StepDurationChartProps {
  steps: { step: string; durationMs?: number }[];
  title?: string;
}

const STEP_LABELS: Record<string, string> = {
  "business-context": "Business Context",
  "metadata-extraction": "Metadata",
  "table-filtering": "Table Filtering",
  "usecase-generation": "Use Cases",
  "domain-clustering": "Domains",
  scoring: "Scoring",
  "sql-generation": "SQL Gen",
  "genie-recommendations": "Recommendations",
};

export function StepDurationChart({
  steps,
  title = "Pipeline Step Durations",
}: StepDurationChartProps) {
  const data = steps
    .filter((s) => s.durationMs != null)
    .map((s) => ({
      name: STEP_LABELS[s.step] ?? s.step,
      seconds: Math.round((s.durationMs ?? 0) / 1000),
    }));

  if (data.length === 0) return null;

  // Scale height to the number of bars so labels never overlap
  const chartHeight = Math.max(200, data.length * 40);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 5, right: 20, bottom: 5, left: 10 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              type="number"
              tick={{ fontSize: 11 }}
              className="fill-muted-foreground"
              unit="s"
            />
            <YAxis
              dataKey="name"
              type="category"
              tick={{ fontSize: 11 }}
              className="fill-muted-foreground"
              width={110}
            />
            <Tooltip
              formatter={(value) => [`${value}s`, "Duration"]}
              contentStyle={{
                backgroundColor: "var(--color-card)",
                borderColor: "var(--color-border)",
                borderRadius: "var(--radius)",
                fontSize: 12,
              }}
              itemStyle={{ color: "var(--color-card-foreground)" }}
              labelStyle={{ color: "var(--color-card-foreground)" }}
            />
            <Bar
              dataKey="seconds"
              fill="var(--color-chart-2)"
              radius={[0, 4, 4, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
