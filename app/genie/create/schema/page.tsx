"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowLeft, Database, Loader2, Sparkles, Check, Search, Table2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { CatalogBrowser } from "@/components/pipeline/catalog-browser";
import { parseErrorResponse, safeJsonParse } from "@/lib/error-utils";
import { BuildModeSelector, type BuildMode } from "@/components/genie/build-mode-selector";
import { ReadinessPanel, type ReadinessReport } from "@/components/genie/readiness-panel";

interface ScannedTable {
  fqn: string;
  tableName: string;
  tableType: string;
  comment: string | null;
  columnCount: number;
}

interface ScannedColumn {
  tableFqn: string;
  columnName: string;
  dataType: string;
  comment: string | null;
}

interface ScanResult {
  scan: {
    catalog: string;
    schema: string;
    tables: ScannedTable[];
    columns?: ScannedColumn[];
    totalTableCount: number;
    totalColumnCount: number;
  };
  selection: {
    selectedTables: string[];
    reasoning: string;
    suggestedTitle: string;
    suggestedDomain: string;
    businessContext: string;
  };
}

type Step = "input" | "scanning" | "review" | "generating" | "complete";

export default function CreateFromSchemaPage() {
  const router = useRouter();
  const [catalog, setCatalog] = useState("");
  const [schema, setSchema] = useState("");
  const [userHint, setUserHint] = useState("");
  const [step, setStep] = useState<Step>("input");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [generating, setGenerating] = useState(false);
  const [exampleQuestions, setExampleQuestions] = useState<string>("");
  const [readinessReport, setReadinessReport] = useState<ReadinessReport | null>(null);

  const handleSchemaSelection = useCallback((sources: string[]) => {
    if (sources.length > 0) {
      const parts = sources[0].split(".");
      setCatalog(parts[0] ?? "");
      setSchema(parts[1] ?? "");
    } else {
      setCatalog("");
      setSchema("");
    }
  }, []);

  const stepLabels = ["Select Schema", "Review Tables", "Generate"];
  const currentStepIndex = step === "input" || step === "scanning" ? 0 : step === "review" ? 1 : 2;

  const handleScan = async () => {
    if (!catalog.trim() || !schema.trim()) {
      toast.error("Both catalog and schema are required");
      return;
    }

    setStep("scanning");

    try {
      const res = await fetch("/api/genie-spaces/scan-schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          catalog: catalog.trim(),
          schema: schema.trim(),
          userHint: userHint.trim() || undefined,
        }),
      });

      if (!res.ok) {
        throw new Error(await parseErrorResponse(res, "Scan failed"));
      }

      const result = (await safeJsonParse<ScanResult>(res))!;
      if (!result) throw new Error("Invalid response from server");
      setScanResult(result);
      setSelectedTables(new Set(result.selection.selectedTables));
      setTitle(result.selection.suggestedTitle);
      setStep("review");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Schema scan failed");
      setStep("input");
    }
  };

  const handleGenerate = async (mode: BuildMode = "full") => {
    if (selectedTables.size === 0) {
      toast.error("Select at least one table");
      return;
    }

    setStep("generating");
    setGenerating(true);

    try {
      const res = await fetch("/api/genie-spaces/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tables: [...selectedTables],
          config: {
            title: title || scanResult?.selection.suggestedTitle,
            domain: scanResult?.selection.suggestedDomain,
            mode,
          },
        }),
      });

      if (!res.ok) {
        throw new Error(await parseErrorResponse(res, "Generation failed"));
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await safeJsonParse(res);
      if (!data) throw new Error("Invalid response from server");

      if (data.jobId) {
        toast.success("Genie Space generation started");
        router.push(`/genie/build/${data.jobId}`);
      } else if (data.recommendation) {
        toast.success("Genie Space generated!");
        router.push("/genie");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
      setStep("review");
    } finally {
      setGenerating(false);
    }
  };

  const toggleTable = (fqn: string) => {
    setSelectedTables((prev) => {
      const next = new Set(prev);
      if (next.has(fqn)) next.delete(fqn);
      else next.add(fqn);
      return next;
    });
  };

  const selectAll = () => {
    if (!scanResult) return;
    setSelectedTables(new Set(scanResult.scan.tables.map((t) => t.fqn)));
  };

  const selectNone = () => setSelectedTables(new Set());

  return (
    <div className="mx-auto max-w-[1000px] space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/genie">
            <ArrowLeft className="mr-1 size-4" />
            Genie Studio
          </Link>
        </Button>
      </div>

      <PageHeader
        title="Create from Schema"
        subtitle="Point at a Unity Catalog schema. Forge scans all tables, profiles key columns, and uses AI to select the most analytically valuable tables for your Genie Space."
      />

      <StepIndicator steps={stepLabels} currentStep={currentStepIndex} />

      {/* Step 1: Input */}
      {(step === "input" || step === "scanning") && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="size-4" />
              Select Schema
            </CardTitle>
            <CardDescription>
              Enter the catalog and schema to scan. Optionally describe what you want the space to
              focus on.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className={step === "scanning" ? "pointer-events-none opacity-60" : ""}>
              <CatalogBrowser
                selectedSources={catalog && schema ? [`${catalog}.${schema}`] : []}
                onSelectionChange={(sources) => handleSchemaSelection(sources)}
                selectionMode="schema"
              />
            </div>
            {catalog && schema && (
              <div className="flex items-center gap-2 text-sm">
                <Database className="size-4 text-muted-foreground" />
                <span className="font-medium">
                  {catalog}.{schema}
                </span>
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Focus hint <span className="text-muted-foreground">(optional)</span>
              </label>
              <Textarea
                placeholder="e.g. I want a space focused on customer revenue analysis and churn metrics"
                value={userHint}
                onChange={(e) => setUserHint(e.target.value)}
                disabled={step === "scanning"}
                rows={2}
              />
            </div>
            <Button onClick={handleScan} disabled={step === "scanning" || !catalog || !schema}>
              {step === "scanning" ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Scanning schema...
                </>
              ) : (
                <>
                  <Search className="mr-2 size-4" />
                  Scan Schema
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Review table selection */}
      {step === "review" && scanResult && (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base">AI Table Selection</CardTitle>
                  <CardDescription className="mt-1">
                    {scanResult.scan.totalTableCount} tables scanned, {selectedTables.size}{" "}
                    selected.
                    {scanResult.selection.reasoning && (
                      <span className="block mt-1 italic">{scanResult.selection.reasoning}</span>
                    )}
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={selectAll}>
                    Select All
                  </Button>
                  <Button variant="outline" size="sm" onClick={selectNone}>
                    Clear
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="max-h-[400px] space-y-1 overflow-y-auto pr-2">
                {scanResult.scan.tables.map((table) => {
                  const isSelected = selectedTables.has(table.fqn);
                  return (
                    <button
                      key={table.fqn}
                      onClick={() => toggleTable(table.fqn)}
                      className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                        isSelected
                          ? "border-primary/30 bg-primary/5"
                          : "border-transparent hover:bg-muted/50"
                      }`}
                    >
                      <div
                        className={`flex size-5 shrink-0 items-center justify-center rounded border ${
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground/30"
                        }`}
                      >
                        {isSelected && <Check className="size-3" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Table2 className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate font-medium">{table.tableName}</span>
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            {table.columnCount} cols
                          </Badge>
                        </div>
                        {table.comment && (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground pl-6">
                            {table.comment}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Space Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Space Title</label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enter a title for your Genie Space"
                />
              </div>
              {scanResult.selection.businessContext && (
                <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                  <span className="font-medium">AI-detected context:</span>{" "}
                  {scanResult.selection.businessContext}
                </div>
              )}
              <BuildModeSelector
                onSelect={handleGenerate}
                disabled={selectedTables.size === 0 || generating}
                tableCount={selectedTables.size}
              />
              <Button variant="outline" onClick={() => setStep("input")}>
                Back
              </Button>
            </CardContent>
          </Card>

          {/* Optional readiness check (pre-flight) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sanity-check before you generate</CardTitle>
              <CardDescription>
                Paste 1-5 example questions you expect the space to answer. Forge will check whether
                the selected tables can actually answer them before you spend minutes on a full
                generation run.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                rows={4}
                placeholder={`What is total revenue by region last quarter?\nWhich customers have the highest churn risk?`}
                value={exampleQuestions}
                onChange={(e) => setExampleQuestions(e.target.value)}
              />
            </CardContent>
          </Card>

          <ReadinessPanel
            catalog={scanResult.scan.catalog}
            schema={scanResult.scan.schema}
            tables={[...selectedTables].map((fqn) => {
              const t = scanResult.scan.tables.find((x) => x.fqn === fqn);
              const cols = (scanResult.scan.columns ?? []).filter((c) => c.tableFqn === fqn);
              return {
                fqn,
                description: t?.comment ?? null,
                columnNames: cols.map((c) => c.columnName),
                columnDescriptions: Object.fromEntries(
                  cols.filter((c) => !!c.comment).map((c) => [c.columnName, c.comment as string]),
                ),
              };
            })}
            questions={exampleQuestions
              .split("\n")
              .map((q) => q.trim())
              .filter((q) => q.length > 0)}
            onReport={setReadinessReport}
          />
          {readinessReport && !readinessReport.ready && (
            <p className="text-xs text-amber-600">
              Some questions are flagged as not answerable. You can still generate, but consider
              adding more tables (or refining the question) for higher-quality output.
            </p>
          )}
        </>
      )}

      {/* Step 3: Generating */}
      {step === "generating" && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Sparkles className="mb-4 size-12 animate-pulse text-primary" />
            <h2 className="text-lg font-semibold">Generating Genie Space</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Running 7 LLM passes: column intelligence, semantic expressions, join inference,
              trusted assets, instructions, benchmarks, and metric views...
            </p>
            <Loader2 className="mt-4 size-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StepIndicator({ steps, currentStep }: { steps: string[]; currentStep: number }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <div
              className={`flex size-7 items-center justify-center rounded-full border text-xs font-semibold transition-colors ${
                i < currentStep
                  ? "border-primary bg-primary text-primary-foreground"
                  : i === currentStep
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-muted-foreground/30 text-muted-foreground/50"
              }`}
            >
              {i < currentStep ? <Check className="size-3.5" /> : i + 1}
            </div>
            <span
              className={`text-xs font-medium ${
                i <= currentStep ? "text-foreground" : "text-muted-foreground/50"
              }`}
            >
              {label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={`h-px w-8 transition-colors ${
                i < currentStep ? "bg-primary" : "bg-muted-foreground/20"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
