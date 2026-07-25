"use client";

/**
 * Inclusion-pattern chips input for the estate scan form.
 *
 * Symmetric to the exclusion patterns the CatalogBrowser already manages: when
 * one or more inclusion patterns are set, the scan keeps *only* tables whose
 * catalog / schema / table name matches at least one pattern (exclusions still
 * win). Empty = keep everything. Patterns support `*` and `?` wildcards, e.g.
 * `*_fact`, `gold_*`.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, X, Filter } from "lucide-react";
import { validatePatternCode } from "@/lib/domain/scope-selection";

export function IncludePatternsInput({
  patterns,
  onChange,
}: {
  patterns: string[];
  onChange: (patterns: string[]) => void;
}) {
  const t = useTranslations("estate_explorer.includePatterns");
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    const code = validatePatternCode(trimmed);
    if (code) {
      setError(t(`validation.${code}` as "validation.empty"));
      return;
    }
    if (patterns.includes(trimmed)) {
      setError(t("duplicate"));
      return;
    }
    setError(null);
    setInput("");
    onChange([...patterns, trimmed]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Filter aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
        <label htmlFor="estate-include-pattern">{t("label")}</label>
      </div>
      <p className="text-xs text-muted-foreground">
        {t.rich("description", {
          code: (chunks) => <code>{chunks}</code>,
        })}
      </p>
      <div className="flex items-center gap-2">
        <Input
          id="estate-include-pattern"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={t("placeholder")}
          className="min-h-11 max-w-xs text-sm"
          aria-describedby={error ? "estate-include-pattern-error" : undefined}
          aria-invalid={!!error}
        />
        <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={add}>
          <Plus aria-hidden="true" className="mr-1 h-3.5 w-3.5" />
          {t("add")}
        </Button>
      </div>
      {error && (
        <p
          id="estate-include-pattern-error"
          role="alert"
          aria-live="polite"
          className="text-xs text-destructive"
        >
          {error}
        </p>
      )}
      {patterns.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {patterns.map((p) => (
            <Badge key={p} variant="secondary" className="gap-1 font-mono text-xs">
              {p}
              <button
                type="button"
                aria-label={t("remove", { pattern: p })}
                onClick={() => onChange(patterns.filter((x) => x !== p))}
                className="ml-0.5 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-muted-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X aria-hidden="true" className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
