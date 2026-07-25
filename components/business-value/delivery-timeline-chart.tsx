"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface PhaseData {
  name: string;
  count: number;
}

interface DeliveryTimelineChartProps {
  phases: PhaseData[];
}

export function DeliveryTimelineChart({ phases }: DeliveryTimelineChartProps) {
  if (phases.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Delivery Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={phases} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11 }}
              className="fill-muted-foreground"
            />
            <Tooltip
              formatter={(value) => [typeof value === "number" ? value : 0, "Use Cases"]}
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
              dataKey="count"
              fill="var(--color-chart-2)"
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
