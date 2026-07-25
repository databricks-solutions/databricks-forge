/** Small label/value stat components for Genie Spaces UI. */

export function StatBadge({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted/50 px-1.5 py-1">
      <div className="font-semibold">{value}</div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}

const ACCENT_COLORS: Record<string, string> = {
  blue: "text-blue-500",
  amber: "text-amber-500",
  emerald: "text-emerald-500",
  violet: "text-violet-500",
};

export function KSChip({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "blue" | "amber" | "emerald" | "violet";
}) {
  if (value === 0) return null;
  const valueColor = accent ? ACCENT_COLORS[accent] : "text-foreground";
  return (
    <span className="inline-flex items-center gap-0.5 whitespace-nowrap text-[10px]">
      <span className={`font-semibold ${valueColor}`}>{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}
