"use client";

import packageJson from "@/package.json";

export function VersionBadge() {
  return <div className="px-6 py-3 text-xs text-muted-foreground/60">v{packageJson.version}</div>;
}
