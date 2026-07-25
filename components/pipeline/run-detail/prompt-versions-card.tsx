"use client";

import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FileCode2, AlertTriangle, ChevronDown, ChevronUp, Copy, Check } from "lucide-react";
import { PROMPT_VERSIONS } from "@/lib/ai/templates";
import { toast } from "sonner";

export function PromptVersionsCard({
  runVersions,
}: {
  runVersions: Record<string, string>;
  runId: string;
}) {
  const entries = Object.entries(runVersions);
  const currentVersions = PROMPT_VERSIONS as Record<string, string>;

  const staleEntries = entries.filter(([key, hash]) => {
    const cur = currentVersions[key];
    return cur === undefined || cur !== hash;
  });
  const changedCount = staleEntries.length;

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [templateCache, setTemplateCache] = useState<
    Record<string, { run: string | null; current: string | null }>
  >({});
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const fetchTemplate = useCallback(
    async (promptKey: string, runHash: string, currentHash: string | undefined) => {
      if (templateCache[promptKey]) return;
      setLoadingKey(promptKey);
      try {
        const hashes = [runHash, currentHash].filter(Boolean).join(",");
        const res = await fetch(`/api/prompt-templates?hashes=${hashes}`);
        if (res.ok) {
          const data = await res.json();
          const templates = data.templates as Record<
            string,
            { promptKey: string; templateText: string }
          >;
          setTemplateCache((prev) => ({
            ...prev,
            [promptKey]: {
              run: templates[runHash]?.templateText ?? null,
              current: currentHash ? (templates[currentHash]?.templateText ?? null) : null,
            },
          }));
        } else {
          setTemplateCache((prev) => ({
            ...prev,
            [promptKey]: { run: null, current: null },
          }));
        }
      } catch {
        setTemplateCache((prev) => ({
          ...prev,
          [promptKey]: { run: null, current: null },
        }));
      } finally {
        setLoadingKey(null);
      }
    },
    [templateCache],
  );

  const handleToggle = (key: string, hash: string, currentHash: string | undefined) => {
    if (expandedKey === key) {
      setExpandedKey(null);
    } else {
      setExpandedKey(key);
      if (!templateCache[key]) {
        fetchTemplate(key, hash, currentHash);
      }
    }
  };

  const handleCopy = async (text: string, fieldId: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedField(fieldId);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <FileCode2 className="h-4 w-4 text-violet-500" />
            Prompt Versions
            {changedCount > 0 && (
              <Badge variant="outline" className="ml-1 border-amber-300 text-amber-700">
                {changedCount} changed since this run
              </Badge>
            )}
          </CardTitle>
        </div>
        <CardDescription>
          Prompt template versions used for this run
          {changedCount > 0
            ? " \u2014 prompts marked with a warning have been updated since. Expand to view differences."
            : ". Click any row to view the full prompt template."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {entries.map(([key, hash]) => {
            const currentHash = currentVersions[key];
            const isStale = currentHash !== undefined && currentHash !== hash;
            const isRemoved = currentHash === undefined;
            const hasDiff = isStale || isRemoved;
            const isExpanded = expandedKey === key;
            const cached = templateCache[key];

            return (
              <div key={key} className="rounded-md border">
                <button
                  className={`flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-muted/50 ${
                    hasDiff
                      ? "border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-900/10"
                      : ""
                  } ${isExpanded ? "rounded-t-md" : "rounded-md"}`}
                  onClick={() => handleToggle(key, hash, currentHash)}
                >
                  <div className="flex items-center gap-2">
                    {hasDiff && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
                    <span className="text-xs font-medium">{key}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{hash}</code>
                    {isStale && (
                      <span className="text-[10px] text-amber-600">
                        now: <code className="rounded bg-muted px-1">{currentHash}</code>
                      </span>
                    )}
                    {isRemoved && <span className="text-[10px] text-amber-600">removed</span>}
                    {isExpanded ? (
                      <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                </button>
                {isExpanded && (
                  <div
                    className={`border-t px-3 py-3 ${hasDiff ? "bg-amber-50/30 dark:bg-amber-900/5" : ""}`}
                  >
                    {loadingKey === key && <Skeleton className="h-24" />}
                    {cached ? (
                      hasDiff ? (
                        <div className="grid grid-cols-2 gap-4">
                          <TemplatePanel
                            label={`This Run (${hash})`}
                            text={cached.run}
                            fallback="Template not in archive (run predates prompt versioning)"
                            colorClass="text-blue-600"
                            bgClass="bg-blue-50 dark:bg-blue-950/30"
                            copyId={`${key}-run`}
                            copiedField={copiedField}
                            onCopy={handleCopy}
                          />
                          <TemplatePanel
                            label={`Current (${currentHash ?? "removed"})`}
                            text={cached.current}
                            fallback={
                              isRemoved
                                ? "This prompt has been removed from the codebase"
                                : "Current template not yet archived (will be archived on next run)"
                            }
                            colorClass="text-violet-600"
                            bgClass="bg-violet-50 dark:bg-violet-950/30"
                            copyId={`${key}-current`}
                            copiedField={copiedField}
                            onCopy={handleCopy}
                          />
                        </div>
                      ) : (
                        <TemplatePanel
                          label={`Prompt Template (${hash})`}
                          text={cached.run}
                          fallback="Template not in archive (run predates prompt versioning)"
                          colorClass="text-muted-foreground"
                          bgClass="bg-muted/50"
                          copyId={`${key}-run`}
                          copiedField={copiedField}
                          onCopy={handleCopy}
                        />
                      )
                    ) : (
                      !loadingKey && (
                        <p className="text-xs italic text-muted-foreground">
                          Loading template data&hellip;
                        </p>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function TemplatePanel({
  label,
  text,
  fallback,
  colorClass,
  bgClass,
  copyId,
  copiedField,
  onCopy,
}: {
  label: string;
  text: string | null;
  fallback: string;
  colorClass: string;
  bgClass: string;
  copyId: string;
  copiedField: string | null;
  onCopy: (text: string, id: string) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className={`text-xs font-semibold ${colorClass}`}>{label}</p>
        {text && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-[10px]"
            onClick={(e) => {
              e.stopPropagation();
              onCopy(text, copyId);
            }}
          >
            {copiedField === copyId ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            {copiedField === copyId ? "Copied" : "Copy"}
          </Button>
        )}
      </div>
      {text ? (
        <pre
          className={`max-h-64 overflow-auto rounded-md ${bgClass} p-2 font-mono text-[11px] leading-relaxed`}
        >
          {text}
        </pre>
      ) : (
        <p className="text-xs italic text-muted-foreground">{fallback}</p>
      )}
    </div>
  );
}
