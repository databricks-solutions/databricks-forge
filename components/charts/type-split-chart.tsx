"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const TYPE_COLORS: Record<string, string> = {
  AI: "oklch(0.55 0.18 280)",
  Statistical: "oklch(0.60 0.15 175)",
  Geospatial: "oklch(0.60 0.16 145)",
};

interface TypeSplitChartProps {
  aiCount: number;
  statisticalCount: number;
  geospatialCount?: number;
  title?: string;
}

export function TypeSplitChart({
  aiCount,
  statisticalCount,
  geospatialCount = 0,
  title = "Use Case Types",
}: TypeSplitChartProps) {
  const data = [
    { name: "AI", value: aiCount },
    { name: "Statistical", value: statisticalCount },
    { name: "Geospatial", value: geospatialCount },
  ].filter((d) => d.value > 0);

  if (data.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-visible">
        <ResponsiveContainer width="100%" height={200} style={{ overflow: "visible" }}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={38}
              outerRadius={65}
              paddingAngle={4}
              isAnimationActive={false}
              label={({ name, value }) => `${name} (${value})`}
              labelLine={false}
              fontSize={11}
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={TYPE_COLORS[entry.name] ?? "oklch(0.50 0.10 240)"} />
              ))}
            </Pie>
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
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
