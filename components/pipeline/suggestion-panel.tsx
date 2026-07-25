"use client";

/**
 * Similar use cases and runs suggestion panel for the configure page.
 *
 * Fetches suggestions from /api/search/suggestions based on the
 * business name / context entered by the user.
 */

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lightbulb, Sparkles, Loader2 } from "lucide-react";
import Link from "next/link";
import { loadSettings } from "@/lib/settings";

interface SuggestionResult {
  sourceId: string;
  content: string;
  score: number;
  runId?: string;
  metadata?: Record<string, unknown>;
}

interface SuggestionPanelProps {
  businessName: string;
}

export function SuggestionPanel({ businessName }: SuggestionPanelProps) {
  const [suggestions, setSuggestions] = React.useState<SuggestionResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [enabled, setEnabled] = React.useState(false);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout>>(null);

  React.useEffect(() => {
    const settings = loadSettings();
    if (!settings.semanticSearchEnabled) {
      setEnabled(false);
      return;
    }
    fetch("/api/embeddings/status")
      .then((r) => r.json())
      .then((d) => setEnabled(d.enabled ?? false))
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    if (!enabled || !businessName || businessName.trim().length < 3) {
      setSuggestions([]);
      return;
    }

    setLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q: businessName.trim(),
          topK: "5",
        });
        const resp = await fetch(`/api/search/suggestions?${params}`);
        if (resp.ok) {
          const data = await resp.json();
          setSuggestions(data.suggestions ?? []);
        }
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 800);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [businessName, enabled]);

  if (!enabled || (suggestions.length === 0 && !loading)) return null;

  return (
    <Card className="border-purple-200/50 bg-purple-50/30 dark:border-purple-900/50 dark:bg-purple-950/10">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="size-4 text-purple-500" />
          Similar Previous Runs
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Finding similar use cases…
          </div>
        )}
        {!loading && suggestions.length > 0 && (
          <div className="space-y-2">
            {suggestions.map((s, i) => (
              <Link
                key={i}
                href={s.runId ? `/runs/${s.runId}` : "#"}
                className="flex items-start gap-2 rounded-md border bg-background/50 p-2 text-xs transition-colors hover:bg-muted/50"
              >
                <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate" title={s.content.split("\n")[0]}>
                    {s.content.split("\n")[0]}
                  </p>
                  {s.metadata?.domain ? (
                    <p className="text-muted-foreground">{String(s.metadata.domain)}</p>
                  ) : null}
                </div>
                <Badge variant="outline" className="shrink-0 text-[9px]">
                  {(s.score * 100).toFixed(0)}%
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
