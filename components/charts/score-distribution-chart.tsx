"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const BUCKET_COLORS = [
  "#ef4444", // 0-20%  red
  "#f97316", // 20-40% orange
  "#eab308", // 40-60% yellow
  "#22c55e", // 60-80% green
  "#16a34a", // 80-100% dark green
];

interface ScoreDistributionChartProps {
  scores: number[];
  title?: string;
}

export function ScoreDistributionChart({
  scores,
  title = "Score Distribution",
}: ScoreDistributionChartProps) {
  const buckets = [
    { range: "0-20%", min: 0, max: 0.2, count: 0 },
    { range: "20-40%", min: 0.2, max: 0.4, count: 0 },
    { range: "40-60%", min: 0.4, max: 0.6, count: 0 },
    { range: "60-80%", min: 0.6, max: 0.8, count: 0 },
    { range: "80-100%", min: 0.8, max: 1.01, count: 0 },
  ];

  for (const score of scores) {
    const bucket = buckets.find((b) => score >= b.min && score < b.max);
    if (bucket) bucket.count++;
  }

  const data = buckets.map((b) => ({ name: b.range, count: b.count }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11 }}
              className="fill-muted-foreground"
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-card)",
                borderColor: "var(--color-border)",
                borderRadius: "var(--radius)",
                fontSize: 12,
              }}
              itemStyle={{ color: "var(--color-card-foreground)" }}
              labelStyle={{ color: "var(--color-card-foreground)" }}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {data.map((_, idx) => (
                <Cell key={idx} fill={BUCKET_COLORS[idx]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
