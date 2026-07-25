"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ArrowLeft,
  Upload,
  FileText,
  Loader2,
  Sparkles,
  Check,
  Table2,
  MessageSquare,
  BookOpen,
  Code,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { parseErrorResponse, safeJsonParse } from "@/lib/error-utils";
import { BuildModeSelector, type BuildMode } from "@/components/genie/build-mode-selector";
import { ReadinessPanel, type ReadinessReport } from "@/components/genie/readiness-panel";

interface ExtractedRequirements {
  tables: string[];
  businessQuestions: string[];
  sqlExamples: Array<{ question: string; sql: string }>;
  instructions: string[];
  joinHints: Array<{ leftTable: string; rightTable: string; hint: string }>;
  domainContext: string;
  suggestedTitle: string;
  glossaryTerms: Array<{ term: string; definition: string }>;
  confidence: number;
}

interface ParseResult {
  document: { title: string; format: string; wordCount: number };
  requirements: ExtractedRequirements;
}

type Step = "upload" | "parsing" | "review" | "generating";

export default function CreateFromRequirementsPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [textInput, setTextInput] = useState("");
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [title, setTitle] = useState("");
  const [additionalTables, setAdditionalTables] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [readinessReport, setReadinessReport] = useState<ReadinessReport | null>(null);

  const stepLabels = ["Upload", "Review", "Generate"];
  const currentStepIndex = step === "upload" || step === "parsing" ? 0 : step === "review" ? 1 : 2;

  const handleFileDrop = async (file: File) => {
    setStep("parsing");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/genie-spaces/parse-requirements", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error(await parseErrorResponse(res, "Parsing failed"));
      }

      const result = (await safeJsonParse<ParseResult>(res))!;
      if (!result) throw new Error("Invalid response from server");
      setParseResult(result);
      setTitle(result.requirements.suggestedTitle);
      setStep("review");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Parsing failed");
      setStep("upload");
    }
  };

  const handleTextSubmit = async () => {
    if (!textInput.trim()) {
      toast.error("Enter some requirements text");
      return;
    }

    setStep("parsing");

    try {
      const formData = new FormData();
      formData.append("text", textInput.trim());

      const res = await fetch("/api/genie-spaces/parse-requirements", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error(await parseErrorResponse(res, "Parsing failed"));
      }

      const result = (await safeJsonParse<ParseResult>(res))!;
      if (!result) throw new Error("Invalid response from server");
      setParseResult(result);
      setTitle(result.requirements.suggestedTitle);
      setStep("review");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Parsing failed");
      setStep("upload");
    }
  };

  const handleGenerate = async (mode: BuildMode = "full") => {
    if (!parseResult) return;

    const allTables = [
      ...parseResult.requirements.tables,
      ...additionalTables
        .split(/[,\n]/)
        .map((t) => t.trim())
        .filter(Boolean),
    ];

    if (allTables.length === 0) {
      toast.error("At least one table is required. Add table names in the tables field.");
      return;
    }

    setStep("generating");

    try {
      const res = await fetch("/api/genie-spaces/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tables: allTables,
          config: {
            title: title || parseResult.requirements.suggestedTitle,
            domain: parseResult.requirements.domainContext,
            conversationSummary: parseResult.requirements.domainContext,
            globalInstructions: parseResult.requirements.instructions.join("\n"),
            mode,
            generateBenchmarks: true,
          },
        }),
      });

      if (!res.ok) {
        throw new Error(await parseErrorResponse(res, "Generation failed"));
      }

      const data = await res.json();
      if (data.jobId) {
        toast.success("Genie Space generation started");
        router.push(`/genie/build/${data.jobId}`);
      } else if (data.recommendation) {
        toast.success("Genie Space generated!");
        router.push("/genie");
      } else {
        toast.success("Genie Space generation started!");
        router.push("/genie");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
      setStep("review");
    }
  };

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
        title="Create from Requirements"
        subtitle="Upload a requirements document (PDF, Markdown, or text). Forge extracts tables, questions, instructions, and domain context to build your Genie Space."
      />

      <StepIndicator steps={stepLabels} currentStep={currentStepIndex} />

      {/* Step 1: Upload */}
      {(step === "upload" || step === "parsing") && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Upload className="size-4" />
                Upload Document
              </CardTitle>
              <CardDescription>
                Drag and drop a PDF or Markdown file, or paste requirements text below.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed py-12 transition-all ${
                  dragActive
                    ? "border-primary bg-primary/5 scale-[1.01] shadow-sm"
                    : "hover:border-primary/50 hover:bg-muted/30"
                }`}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragActive(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragActive(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragActive(false);
                  const file = e.dataTransfer.files[0];
                  if (file) handleFileDrop(file);
                }}
              >
                {step === "parsing" ? (
                  <>
                    <Loader2 className="mb-3 size-8 animate-spin text-primary" />
                    <p className="text-sm font-medium">
                      Parsing document and extracting requirements...
                    </p>
                  </>
                ) : (
                  <>
                    <FileText className="mb-3 size-8 text-muted-foreground" />
                    <p className="text-sm font-medium">Drop a file here or click to browse</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Supports PDF, Markdown (.md), and plain text files
                    </p>
                  </>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.md,.markdown,.txt,.text"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileDrop(file);
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Or Paste Requirements Text</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                placeholder="Paste your requirements, analytics brief, or data dictionary here..."
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                rows={8}
                disabled={step === "parsing"}
              />
              <Button onClick={handleTextSubmit} disabled={step === "parsing" || !textInput.trim()}>
                {step === "parsing" ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 size-4" />
                )}
                Extract Requirements
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 2: Review extracted requirements */}
      {step === "review" && parseResult && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base">Extracted Requirements</CardTitle>
                  <CardDescription>
                    From &quot;{parseResult.document.title}&quot; ({parseResult.document.wordCount}{" "}
                    words, {parseResult.document.format})
                  </CardDescription>
                </div>
                <Badge
                  variant={parseResult.requirements.confidence >= 70 ? "default" : "secondary"}
                  className="text-xs"
                >
                  {parseResult.requirements.confidence}% confidence
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {parseResult.requirements.tables.length > 0 && (
                <div>
                  <h4 className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <Table2 className="size-3.5" />
                    Tables ({parseResult.requirements.tables.length})
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {parseResult.requirements.tables.map((t) => (
                      <Badge key={t} variant="outline" className="text-xs font-mono">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {parseResult.requirements.businessQuestions.length > 0 && (
                <div>
                  <h4 className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <MessageSquare className="size-3.5" />
                    Business Questions ({parseResult.requirements.businessQuestions.length})
                  </h4>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {parseResult.requirements.businessQuestions.slice(0, 8).map((q, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="shrink-0 text-muted-foreground/50">{i + 1}.</span>
                        {q}
                      </li>
                    ))}
                    {parseResult.requirements.businessQuestions.length > 8 && (
                      <li className="text-muted-foreground/50">
                        +{parseResult.requirements.businessQuestions.length - 8} more...
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {parseResult.requirements.instructions.length > 0 && (
                <div>
                  <h4 className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <BookOpen className="size-3.5" />
                    Instructions ({parseResult.requirements.instructions.length})
                  </h4>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {parseResult.requirements.instructions.slice(0, 5).map((inst, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Check className="mt-0.5 size-3 shrink-0 text-green-500" />
                        {inst}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {parseResult.requirements.sqlExamples.length > 0 && (
                <div>
                  <h4 className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <Code className="size-3.5" />
                    SQL Examples ({parseResult.requirements.sqlExamples.length})
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    {parseResult.requirements.sqlExamples.length} question-SQL pairs extracted
                  </p>
                </div>
              )}

              {parseResult.requirements.domainContext && (
                <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                  <span className="font-medium">Domain context:</span>{" "}
                  {parseResult.requirements.domainContext}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Configure and Generate</CardTitle>
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
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  Additional Tables{" "}
                  <span className="text-muted-foreground">(optional, comma-separated FQNs)</span>
                </label>
                <Input
                  value={additionalTables}
                  onChange={(e) => setAdditionalTables(e.target.value)}
                  placeholder="e.g. main.sales.orders, main.sales.customers"
                />
              </div>
              <BuildModeSelector onSelect={handleGenerate} />
              <Button variant="outline" onClick={() => setStep("upload")}>
                Back
              </Button>
            </CardContent>
          </Card>

          {/* Optional pre-flight readiness panel */}
          {parseResult.requirements.tables.length > 0 &&
            parseResult.requirements.businessQuestions.length > 0 &&
            (() => {
              const allTables = [
                ...parseResult.requirements.tables,
                ...additionalTables
                  .split(/[,\n]/)
                  .map((t) => t.trim())
                  .filter(Boolean),
              ];
              const firstFqn = allTables.find((t) => t.split(".").length === 3);
              if (!firstFqn) return null;
              const [catalog, schema] = firstFqn.split(".");
              return (
                <>
                  <ReadinessPanel
                    catalog={catalog}
                    schema={schema}
                    tables={allTables.map((fqn) => ({ fqn }))}
                    questions={parseResult.requirements.businessQuestions.slice(0, 12)}
                    onReport={setReadinessReport}
                  />
                  {readinessReport && !readinessReport.ready && (
                    <p className="text-xs text-amber-600">
                      Some extracted questions look hard to answer with the proposed tables.
                      Consider adding tables in the field above before generating.
                    </p>
                  )}
                </>
              );
            })()}
        </div>
      )}

      {/* Step 3: Generating */}
      {step === "generating" && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Sparkles className="mb-4 size-12 animate-pulse text-primary" />
            <h2 className="text-lg font-semibold">Generating Genie Space</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Building from your requirements with full LLM analysis...
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
