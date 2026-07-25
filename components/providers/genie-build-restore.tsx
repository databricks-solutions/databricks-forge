"use client";

import { useEffect, useRef } from "react";
import { useGenieBuild } from "./genie-build-provider";
import { showBuildToast } from "@/components/assistant/genie-build-toast";

const LS_KEY = "forge-active-build-jobs";

/**
 * Restores build toasts on page load for any jobs that are still in-progress
 * or completed-but-not-deployed. Mounted once inside GenieBuildProvider.
 */
export function GenieBuildRestore() {
  const { jobs } = useGenieBuild();
  const restoredRef = useRef(false);

  useEffect(() => {
    if (restoredRef.current || jobs.length === 0) return;
    restoredRef.current = true;

    let storedIds: string[];
    try {
      const raw = localStorage.getItem(LS_KEY);
      storedIds = raw ? JSON.parse(raw) : [];
    } catch {
      return;
    }
    if (storedIds.length === 0) return;

    for (const jobId of storedIds) {
      const job = jobs.find((j) => j.jobId === jobId);
      if (!job) {
        // Job expired or not found -- clean up
        try {
          const ids = storedIds.filter((id) => id !== jobId);
          localStorage.setItem(LS_KEY, JSON.stringify(ids));
        } catch {
          /* ignore */
        }
        continue;
      }

      if (job.status === "generating" || (job.status === "completed" && !job.deployedSpaceId)) {
        showBuildToast(jobId, () => {
          /* deploy handler -- no-op here, user will interact via Genie Studio */
        });
      }
    }
  }, [jobs]);

  return null;
}
