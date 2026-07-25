"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useGenieBuildJobs, type GenieBuildJob } from "@/lib/hooks/use-genie-build-jobs";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface GenieBuildContextValue {
  jobs: GenieBuildJob[];
  activeJobs: GenieBuildJob[];
  isAnyActive: boolean;
  getJob: (jobId: string) => GenieBuildJob | null;
  startBuild: (
    tables: string[],
    config: Record<string, unknown>,
    source?: string,
  ) => Promise<string | null>;
  cancelBuild: (jobId: string) => Promise<boolean>;
  refetch: () => Promise<void>;
}

const GenieBuildContext = createContext<GenieBuildContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function GenieBuildProvider({ children }: { children: ReactNode }) {
  const value = useGenieBuildJobs();

  return <GenieBuildContext.Provider value={value}>{children}</GenieBuildContext.Provider>;
}

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

export function useGenieBuild(): GenieBuildContextValue {
  const ctx = useContext(GenieBuildContext);
  if (!ctx) {
    throw new Error("useGenieBuild must be used within <GenieBuildProvider>");
  }
  return ctx;
}
