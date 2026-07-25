"use client";

/**
 * Reusable semantic search input with mode toggle (Semantic / Exact).
 *
 * In "Semantic" mode, queries hit /api/search with the specified scope.
 * In "Exact" mode, delegates to the parent's substring filter.
 *
 * Falls back to exact-only when embeddings are not enabled.
 */

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2, Sparkles, Type } from "lucide-react";

export type SearchMode = "semantic" | "exact";

export interface SemanticSearchResult {
  id: string;
  kind: string;
  sourceId: string;
  content: string;
  score: number;
  metadata: Record<string, unknown> | null;
}

interface SemanticSearchInputProps {
  placeholder?: string;
  scope?: string;
  runId?: string;
  scanId?: string;
  onExactChange: (query: string) => void;
  onSemanticResults?: (results: SemanticSearchResult[]) => void;
  embeddingEnabled?: boolean;
  className?: string;
}

export function SemanticSearchInput({
  placeholder = "Search…",
  scope,
  runId,
  scanId,
  onExactChange,
  onSemanticResults,
  embeddingEnabled = false,
  className = "",
}: SemanticSearchInputProps) {
  const [query, setQuery] = React.useState("");
  const [mode, setMode] = React.useState<SearchMode>(embeddingEnabled ? "semantic" : "exact");
  const [loading, setLoading] = React.useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (mode === "exact") {
      onExactChange(query);
      return;
    }

    if (!query.trim() || query.trim().length < 2) {
      onSemanticResults?.([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q: query.trim(),
          topK: "20",
          minScore: "0.3",
        });
        if (scope) params.set("scope", scope);
        if (runId) params.set("runId", runId);
        if (scanId) params.set("scanId", scanId);

        const resp = await fetch(`/api/search?${params}`);
        if (resp.ok) {
          const data = await resp.json();
          onSemanticResults?.(data.results ?? []);
        } else {
          onSemanticResults?.([]);
        }
      } catch {
        onSemanticResults?.([]);
      } finally {
        setLoading(false);
      }
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, mode, scope, runId, scanId, onExactChange, onSemanticResults]);

  const toggleMode = () => {
    const next = mode === "semantic" ? "exact" : "semantic";
    setMode(next);
    if (next === "exact") {
      onExactChange(query);
      onSemanticResults?.([]);
    }
  };

  return (
    <div className={`relative flex items-center gap-2 ${className}`}>
      <div className="relative flex-1">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="h-8 pl-8 text-xs"
        />
        {loading && (
          <Loader2 className="absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>
      {embeddingEnabled && (
        <button
          onClick={toggleMode}
          className="flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition-colors hover:bg-muted"
          title={mode === "semantic" ? "Switch to exact match" : "Switch to semantic search"}
        >
          {mode === "semantic" ? (
            <>
              <Sparkles className="size-3 text-purple-500" />
              <Badge variant="secondary" className="px-1 py-0 text-[9px]">
                Semantic
              </Badge>
            </>
          ) : (
            <>
              <Type className="size-3 text-muted-foreground" />
              <Badge variant="outline" className="px-1 py-0 text-[9px]">
                Exact
              </Badge>
            </>
          )}
        </button>
      )}
    </div>
  );
}
