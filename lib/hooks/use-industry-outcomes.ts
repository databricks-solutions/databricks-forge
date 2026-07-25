/**
 * React hook for fetching the merged industry outcomes registry.
 *
 * Fetches from /api/outcome-maps/registry (built-in + custom maps).
 * Falls back to the built-in INDUSTRY_OUTCOMES on fetch failure.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import type { IndustryOutcome } from "@/lib/domain/industry-outcomes";

interface UseIndustryOutcomesReturn {
  /** All industry outcomes (built-in + custom). */
  outcomes: IndustryOutcome[];
  /** Whether the registry is currently loading. */
  loading: boolean;
  /** Error message if fetch failed. */
  error: string | null;
  /** Re-fetch the registry (e.g., after creating a new custom map). */
  refresh: () => void;
  /** Look up a single industry by id. */
  getOutcome: (id: string) => IndustryOutcome | undefined;
  /** Get options for dropdowns (id + name). */
  getOptions: () => { id: string; name: string }[];
}

export function useIndustryOutcomes(): UseIndustryOutcomesReturn {
  const [outcomes, setOutcomes] = useState<IndustryOutcome[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRegistry = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/outcome-maps/registry");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: IndustryOutcome[] = await res.json();
      setOutcomes(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load registry");
      // Lazy-load built-in outcomes as fallback to avoid a permanently empty dropdown
      try {
        const { INDUSTRY_OUTCOMES } = await import("@/lib/domain/industry-outcomes");
        setOutcomes(INDUSTRY_OUTCOMES);
      } catch {
        // Last resort: leave outcomes empty
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRegistry();
  }, [fetchRegistry]);

  const getOutcome = useCallback((id: string) => outcomes.find((o) => o.id === id), [outcomes]);

  const getOptions = useCallback(
    () => outcomes.map((o) => ({ id: o.id, name: o.name })),
    [outcomes],
  );

  return {
    outcomes,
    loading,
    error,
    refresh: fetchRegistry,
    getOutcome,
    getOptions,
  };
}
