"use client";

import { useEffect, useState } from "react";

interface CachedMe {
  email: string;
  isolationEnabled: boolean;
}

let cached: CachedMe | null = null;
let cachedAt = 0;
const TTL_MS = 5 * 60_000;

/**
 * Returns the current user's email + isolation flag (or nulls while loading
 * / unavailable).
 *
 * Cached process-wide for 5 minutes so multiple components on a page do not
 * each issue their own /api/me request.
 */
export function useCurrentUser(): {
  email: string | null;
  isolationEnabled: boolean;
  loading: boolean;
} {
  const isFresh = cached != null && Date.now() - cachedAt < TTL_MS;
  const [snapshot, setSnapshot] = useState<CachedMe | null>(isFresh ? cached : null);
  const [loading, setLoading] = useState(snapshot == null);

  useEffect(() => {
    if (cached && Date.now() - cachedAt < TTL_MS) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/me", { cache: "no-store", credentials: "include" });
        if (!res.ok) return;
        const data = (await res.json()) as { email?: string; isolationEnabled?: boolean };
        if (cancelled) return;
        if (data.email) {
          cached = {
            email: data.email.toLowerCase(),
            isolationEnabled: data.isolationEnabled ?? true,
          };
          cachedAt = Date.now();
          setSnapshot(cached);
        }
      } catch {
        /* best-effort */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    email: snapshot?.email ?? null,
    isolationEnabled: snapshot?.isolationEnabled ?? true,
    loading,
  };
}
