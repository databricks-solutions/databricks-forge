"use client";

import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

interface ScoreRadarChartProps {
  priority: number;
  feasibility: number;
  impact: number;
  overall: number;
  /** Optional user-adjusted scores. When provided, a second layer is drawn. */
  userPriority?: number | null;
  userFeasibility?: number | null;
  userImpact?: number | null;
  userOverall?: number | null;
  size?: number;
}

export function ScoreRadarChart({
  priority,
  feasibility,
  impact,
  overall,
  userPriority,
  userFeasibility,
  userImpact,
  userOverall,
  size = 200,
}: ScoreRadarChartProps) {
  const hasUserScores =
    userPriority != null || userFeasibility != null || userImpact != null || userOverall != null;

  const data = [
    {
      metric: "Priority",
      system: Math.round(priority * 100),
      user: hasUserScores ? Math.round((userPriority ?? priority) * 100) : undefined,
    },
    {
      metric: "Feasibility",
      system: Math.round(feasibility * 100),
      user: hasUserScores ? Math.round((userFeasibility ?? feasibility) * 100) : undefined,
    },
    {
      metric: "Impact",
      system: Math.round(impact * 100),
      user: hasUserScores ? Math.round((userImpact ?? impact) * 100) : undefined,
    },
    {
      metric: "Overall",
      system: Math.round(overall * 100),
      user: hasUserScores ? Math.round((userOverall ?? overall) * 100) : undefined,
    },
  ];

  return (
    <ResponsiveContainer width="100%" height={size}>
      <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
        <PolarGrid stroke="var(--color-border)" strokeOpacity={0.5} />
        <PolarAngleAxis
          dataKey="metric"
          tick={{ fontSize: 12, fontWeight: 600, fill: "var(--color-foreground)" }}
        />
        <PolarRadiusAxis
          angle={90}
          domain={[0, 100]}
          tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }}
          tickCount={5}
          axisLine={false}
        />
        {/* System scores layer */}
        <Radar
          name="System"
          dataKey="system"
          stroke="oklch(0.65 0.20 160)"
          fill="oklch(0.65 0.20 160)"
          fillOpacity={hasUserScores ? 0.1 : 0.25}
          strokeWidth={hasUserScores ? 1.5 : 2.5}
          strokeDasharray={hasUserScores ? "4 3" : undefined}
          dot={!hasUserScores}
          isAnimationActive={false}
        />
        {hasUserScores && (
          <Radar
            name="Adjusted"
            dataKey="user"
            stroke="oklch(0.70 0.22 280)"
            fill="oklch(0.70 0.22 280)"
            fillOpacity={0.2}
            strokeWidth={2.5}
            dot
            isAnimationActive={false}
          />
        )}
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--color-card)",
            borderColor: "var(--color-border)",
            borderRadius: "var(--radius)",
            fontSize: 12,
          }}
          itemStyle={{ color: "var(--color-card-foreground)" }}
          labelStyle={{ color: "var(--color-card-foreground)" }}
          formatter={(value, name) => [
            `${value ?? 0}%`,
            name === "system" ? "System Score" : "Your Score",
          ]}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
