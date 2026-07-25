"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Label } from "@/components/ui/label";
import {
  Upload,
  FileText,
  Sparkles,
  Check,
  AlertCircle,
  Loader2,
  ArrowLeft,
  ArrowRight,
  Trash2,
  Plus,
  Target,
  Users,
  BarChart3,
  Save,
  Eye,
  Pencil,
  Download,
  Info,
} from "lucide-react";
import type { IndustryOutcome } from "@/lib/domain/industry-outcomes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Step = "upload" | "parsing" | "review" | "saving" | "done";

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

const OUTCOME_MAP_TEMPLATE = `# Outcome Map -- [Your Industry Name]

> Sub-verticals: [Sub-vertical 1], [Sub-vertical 2], [Sub-vertical 3]

---

## Objective: Drive Growth

**Why Change:** Describe the macro trends, competitive pressures, or market shifts
that make this objective urgent for organisations in this industry. Two to three
sentences is ideal.

### Strategic Priority: Customer Intelligence & Personalisation

#### Use Cases

- **Next-Best-Offer Engine**
  Leverage transaction history and behavioural signals to recommend the most
  relevant product or service to each customer in real time.
  _Business Value:_ Increased cross-sell conversion and customer lifetime value.

- **Customer Churn Prediction**
  Build propensity models that identify customers at risk of leaving, enabling
  proactive retention campaigns before attrition occurs.
  _Business Value:_ Reduced churn rate and lower cost-to-retain.

#### Key Personas
- Chief Marketing Officer
- Head of Customer Analytics

#### KPIs
- Cross-sell / upsell conversion rate
- Customer lifetime value (CLV)
- Net Promoter Score (NPS)

---

### Strategic Priority: Revenue Forecasting & Planning

#### Use Cases

- **Demand Sensing & Forecasting**
  Combine internal sales data with external signals (weather, events, economic
  indicators) to produce short-horizon demand forecasts.
  _Business Value:_ Improved inventory planning and reduced stockouts.

- **Dynamic Pricing Optimisation**
  Use elasticity models and competitor benchmarking to adjust pricing in
  near-real-time across channels.
  _Business Value:_ Maximised margin while remaining competitive.

#### Key Personas
- Chief Revenue Officer
- Head of Pricing Strategy

#### KPIs
- Forecast accuracy (MAPE)
- Revenue per unit
- Price realisation rate

---

## Objective: Manage Risk & Compliance

**Why Change:** Describe regulatory pressures, fraud trends, or operational risks
that are driving this objective. Two to three sentences.

### Strategic Priority: Fraud Detection & Prevention

#### Use Cases

- **Real-Time Transaction Monitoring**
  Apply ML anomaly detection to payment streams, flagging suspicious
  transactions for review within milliseconds.
  _Business Value:_ Reduced fraud losses and faster investigation cycles.

- **Identity Verification & KYC Automation**
  Automate document verification and entity resolution to streamline
  onboarding while meeting regulatory requirements.
  _Business Value:_ Faster onboarding with lower compliance cost.

#### Key Personas
- Chief Risk Officer
- Head of Financial Crime

#### KPIs
- Fraud detection rate
- False-positive ratio
- Mean time to investigate

---

### Strategic Priority: Regulatory Reporting & Governance

#### Use Cases

- **Automated Regulatory Report Generation**
  Extract, validate, and assemble data from multiple source systems to
  produce regulatory submissions with full audit trails.
  _Business Value:_ Reduced manual effort and fewer restatements.

- **Data Quality Monitoring Dashboard**
  Continuously profile key data assets, surfacing anomalies, schema drift,
  and completeness issues before they impact downstream consumers.
  _Business Value:_ Higher trust in data and fewer production incidents.

#### Key Personas
- Chief Compliance Officer
- Head of Data Governance

#### KPIs
- Report accuracy rate
- Data quality score
- Regulatory findings per audit cycle
`;

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function IngestOutcomeMapPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Workflow state
  const [step, setStep] = useState<Step>("upload");
  const [rawMarkdown, setRawMarkdown] = useState("");
  const [fileName, setFileName] = useState("");
  const [parsedOutcome, setParsedOutcome] = useState<IndustryOutcome | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);

  // Stats
  const stats = useMemo(() => {
    if (!parsedOutcome) return null;
    const objectives = parsedOutcome.objectives.length;
    const priorities = parsedOutcome.objectives.reduce((acc, o) => acc + o.priorities.length, 0);
    const useCases = parsedOutcome.objectives.reduce(
      (acc, o) => acc + o.priorities.reduce((pacc, p) => pacc + p.useCases.length, 0),
      0,
    );
    const personas = new Set(
      parsedOutcome.objectives.flatMap((o) => o.priorities.flatMap((p) => p.personas)),
    ).size;
    const kpis = new Set(
      parsedOutcome.objectives.flatMap((o) => o.priorities.flatMap((p) => p.kpis)),
    ).size;
    return { objectives, priorities, useCases, personas, kpis };
  }, [parsedOutcome]);

  // -------------------------------------------------------------------------
  // Template download
  // -------------------------------------------------------------------------

  function handleDownloadTemplate() {
    const blob = new Blob([OUTCOME_MAP_TEMPLATE], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "outcome-map-template.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  // -------------------------------------------------------------------------
  // File handling
  // -------------------------------------------------------------------------

  const readFile = useCallback((file: File) => {
    if (!file.name.endsWith(".md") && !file.name.endsWith(".markdown")) {
      setParseError("Please upload a markdown (.md) file.");
      return;
    }
    setFileName(file.name);
    setParseError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setRawMarkdown(text);
    };
    reader.readAsText(file);
  }, []);

  const handleFileDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer.files[0];
      if (file) readFile(file);
    },
    [readFile],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) readFile(file);
    },
    [readFile],
  );

  // -------------------------------------------------------------------------
  // AI Parse
  // -------------------------------------------------------------------------

  async function handleParse() {
    if (!rawMarkdown.trim()) return;
    setStep("parsing");
    setParseError(null);

    try {
      const res = await fetch("/api/outcome-maps/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: rawMarkdown }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setParseError(data.error ?? "AI parsing failed. Please try again.");
        setStep("upload");
        return;
      }

      setParsedOutcome(data.outcome);
      setStep("review");
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Failed to reach parse endpoint");
      setStep("upload");
    }
  }

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------

  async function handleSave() {
    if (!parsedOutcome || !rawMarkdown) return;
    setStep("saving");
    setSaveError(null);

    try {
      const res = await fetch("/api/outcome-maps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawMarkdown, parsedOutcome }),
      });
      const data = await res.json();

      if (!res.ok) {
        setSaveError(data.error ?? "Failed to save outcome map.");
        setStep("review");
        return;
      }

      setStep("done");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save outcome map");
      setStep("review");
    }
  }

  // -------------------------------------------------------------------------
  // Inline editing helpers
  // -------------------------------------------------------------------------

  function updateOutcomeField(field: keyof IndustryOutcome, value: unknown) {
    if (!parsedOutcome) return;
    setParsedOutcome({ ...parsedOutcome, [field]: value });
  }

  function updateObjective(objIdx: number, field: string, value: unknown) {
    if (!parsedOutcome) return;
    const objectives = [...parsedOutcome.objectives];
    objectives[objIdx] = { ...objectives[objIdx], [field]: value };
    setParsedOutcome({ ...parsedOutcome, objectives });
  }

  function updatePriority(objIdx: number, priIdx: number, field: string, value: unknown) {
    if (!parsedOutcome) return;
    const objectives = [...parsedOutcome.objectives];
    const priorities = [...objectives[objIdx].priorities];
    priorities[priIdx] = { ...priorities[priIdx], [field]: value };
    objectives[objIdx] = { ...objectives[objIdx], priorities };
    setParsedOutcome({ ...parsedOutcome, objectives });
  }

  function removeUseCase(objIdx: number, priIdx: number, ucIdx: number) {
    if (!parsedOutcome) return;
    const objectives = [...parsedOutcome.objectives];
    const priorities = [...objectives[objIdx].priorities];
    const useCases = priorities[priIdx].useCases.filter((_, i) => i !== ucIdx);
    priorities[priIdx] = { ...priorities[priIdx], useCases };
    objectives[objIdx] = { ...objectives[objIdx], priorities };
    setParsedOutcome({ ...parsedOutcome, objectives });
  }

  function addUseCase(objIdx: number, priIdx: number) {
    if (!parsedOutcome) return;
    const objectives = [...parsedOutcome.objectives];
    const priorities = [...objectives[objIdx].priorities];
    const useCases = [
      ...priorities[priIdx].useCases,
      { name: "New Use Case", description: "Description" },
    ];
    priorities[priIdx] = { ...priorities[priIdx], useCases };
    objectives[objIdx] = { ...objectives[objIdx], priorities };
    setParsedOutcome({ ...parsedOutcome, objectives });
  }

  function updateUseCase(
    objIdx: number,
    priIdx: number,
    ucIdx: number,
    field: string,
    value: string,
  ) {
    if (!parsedOutcome) return;
    const objectives = [...parsedOutcome.objectives];
    const priorities = [...objectives[objIdx].priorities];
    const useCases = [...priorities[priIdx].useCases];
    useCases[ucIdx] = { ...useCases[ucIdx], [field]: value };
    priorities[priIdx] = { ...priorities[priIdx], useCases };
    objectives[objIdx] = { ...objectives[objIdx], priorities };
    setParsedOutcome({ ...parsedOutcome, objectives });
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-[1400px] space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/outcomes">
            <Button variant="ghost" size="icon" aria-label="Back to outcome maps">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Ingest Outcome Map</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload a markdown outcome map and let AI extract structured data
            </p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="hidden md:flex items-center gap-2">
          <StepIndicator
            label="Upload"
            stepNum={1}
            active={step === "upload"}
            completed={
              step === "parsing" || step === "review" || step === "saving" || step === "done"
            }
          />
          <ChevronSep />
          <StepIndicator
            label="AI Parse"
            stepNum={2}
            active={step === "parsing"}
            completed={step === "review" || step === "saving" || step === "done"}
          />
          <ChevronSep />
          <StepIndicator
            label="Review & Edit"
            stepNum={3}
            active={step === "review"}
            completed={step === "saving" || step === "done"}
          />
          <ChevronSep />
          <StepIndicator
            label="Save"
            stepNum={4}
            active={step === "saving" || step === "done"}
            completed={step === "done"}
          />
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Step 1: Upload */}
      {/* ----------------------------------------------------------------- */}
      {step === "upload" && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Drop zone */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Upload className="h-4 w-4 text-primary" />
                  Upload Markdown File
                </CardTitle>
                <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
                  <Download className="mr-2 h-3 w-3" />
                  Download Template
                </Button>
              </div>
              <CardDescription>
                Drop your industry outcome map document (.md) here, or download the template to get
                started
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className="flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed border-muted-foreground/25 bg-muted/30 p-8 transition-colors hover:border-primary/50 hover:bg-muted/50"
              >
                {fileName ? (
                  <>
                    <FileText className="h-10 w-10 text-primary" />
                    <div className="text-center">
                      <p className="font-medium">{fileName}</p>
                      <p className="text-sm text-muted-foreground">
                        {(rawMarkdown.length / 1024).toFixed(1)} KB &middot;{" "}
                        {rawMarkdown.split("\n").length} lines
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRawMarkdown("");
                        setFileName("");
                      }}
                    >
                      Replace file
                    </Button>
                  </>
                ) : (
                  <>
                    <Upload className="h-10 w-10 text-muted-foreground/50" />
                    <div className="text-center">
                      <p className="font-medium">Drop your .md file here</p>
                      <p className="text-sm text-muted-foreground">or click to browse</p>
                    </div>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.markdown"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>

              {parseError && (
                <div className="mt-4 flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {parseError}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Or paste markdown */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Pencil className="h-4 w-4 text-primary" />
                Or Paste Markdown
              </CardTitle>
              <CardDescription>Paste the outcome map content directly</CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder="# Industry Data Intelligence Outcome Map&#10;&#10;## Objective: Drive Growth&#10;&#10;### Strategic Priority: ..."
                className="min-h-[200px] font-mono text-xs"
                value={rawMarkdown}
                onChange={(e) => {
                  setRawMarkdown(e.target.value);
                  if (!fileName) setFileName("pasted-content.md");
                }}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                {rawMarkdown.length > 0
                  ? `${(rawMarkdown.length / 1024).toFixed(1)} KB · ${rawMarkdown.split("\n").length} lines`
                  : "Paste your markdown content above"}
              </p>
            </CardContent>
          </Card>

          {/* Format guidance */}
          <div className="lg:col-span-2 rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900 dark:bg-blue-950/20">
            <div className="flex gap-3">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
              <div className="space-y-2 text-sm">
                <p className="font-medium text-blue-900 dark:text-blue-300">
                  Expected markdown structure
                </p>
                <div className="grid gap-x-8 gap-y-1 text-blue-800 dark:text-blue-400 sm:grid-cols-2">
                  <div>
                    <p className="font-medium text-xs uppercase tracking-wide text-blue-600 dark:text-blue-500 mb-1">
                      Required
                    </p>
                    <ul className="space-y-0.5 text-xs">
                      <li>
                        <span className="font-mono"># Industry Name</span> -- top-level heading
                      </li>
                      <li>
                        <span className="font-mono">## Objective:</span> -- strategic objectives
                        (e.g. Drive Growth)
                      </li>
                      <li>
                        <span className="font-mono">### Strategic Priority:</span> -- priorities per
                        objective
                      </li>
                      <li>
                        <span className="font-mono">- **Use Case Name**</span> -- use cases with
                        descriptions
                      </li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-xs uppercase tracking-wide text-blue-600 dark:text-blue-500 mb-1">
                      Recommended
                    </p>
                    <ul className="space-y-0.5 text-xs">
                      <li>
                        <span className="font-mono">**Why Change:**</span> -- narrative per
                        objective
                      </li>
                      <li>
                        <span className="font-mono">#### Key Personas</span> -- job titles per
                        priority
                      </li>
                      <li>
                        <span className="font-mono">#### KPIs</span> -- measurable metrics per
                        priority
                      </li>
                      <li>
                        <span className="font-mono">_Business Value:_</span> -- per use case
                      </li>
                    </ul>
                  </div>
                </div>
                <p className="text-xs text-blue-700 dark:text-blue-500">
                  Accepts <span className="font-mono">.md</span> or{" "}
                  <span className="font-mono">.markdown</span> files. Minimum 100 characters. The AI
                  parser is flexible with heading styles and layout variations.
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="lg:col-span-2 flex justify-end">
            <Button
              size="lg"
              disabled={!rawMarkdown.trim() || rawMarkdown.length < 100}
              onClick={handleParse}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Parse with AI
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Step 2: Parsing (loading) */}
      {/* ----------------------------------------------------------------- */}
      {step === "parsing" && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-4 py-16">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <div className="text-center">
              <p className="text-lg font-medium">AI is analyzing your outcome map...</p>
              <p className="text-sm text-muted-foreground">
                Extracting objectives, priorities, use cases, KPIs, and personas
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Step 3: Review & Edit */}
      {/* ----------------------------------------------------------------- */}
      {step === "review" && parsedOutcome && (
        <div className="flex flex-col gap-8">
          {/* Summary header */}
          <Card className="bg-gradient-to-r from-primary/5 to-primary/0">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-xl">
                    {editMode ? (
                      <Input
                        value={parsedOutcome.name}
                        onChange={(e) => updateOutcomeField("name", e.target.value)}
                        className="text-xl font-bold"
                      />
                    ) : (
                      parsedOutcome.name
                    )}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {editMode ? (
                      <Input
                        value={parsedOutcome.id}
                        onChange={(e) => updateOutcomeField("id", e.target.value)}
                        className="font-mono text-xs"
                      />
                    ) : (
                      <span className="font-mono text-xs">ID: {parsedOutcome.id}</span>
                    )}
                  </CardDescription>
                </div>
                <Button
                  variant={editMode ? "default" : "outline"}
                  size="sm"
                  onClick={() => setEditMode(!editMode)}
                >
                  {editMode ? (
                    <>
                      <Eye className="mr-2 h-3 w-3" />
                      Preview
                    </>
                  ) : (
                    <>
                      <Pencil className="mr-2 h-3 w-3" />
                      Edit
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {/* Stats row */}
              {stats && (
                <div className="flex flex-wrap gap-4">
                  <StatBadge
                    icon={<Target className="h-3 w-3" />}
                    label="Objectives"
                    count={stats.objectives}
                  />
                  <StatBadge
                    icon={<Sparkles className="h-3 w-3" />}
                    label="Priorities"
                    count={stats.priorities}
                  />
                  <StatBadge
                    icon={<BarChart3 className="h-3 w-3" />}
                    label="Use Cases"
                    count={stats.useCases}
                  />
                  <StatBadge
                    icon={<Users className="h-3 w-3" />}
                    label="Personas"
                    count={stats.personas}
                  />
                  <StatBadge
                    icon={<BarChart3 className="h-3 w-3" />}
                    label="KPIs"
                    count={stats.kpis}
                  />
                </div>
              )}

              {/* Sub-verticals */}
              {parsedOutcome.subVerticals && parsedOutcome.subVerticals.length > 0 && (
                <div className="mt-4">
                  <Label className="text-xs text-muted-foreground">Sub-verticals</Label>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {parsedOutcome.subVerticals.map((sv, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {sv}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggested domains & priorities */}
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <Label className="text-xs text-muted-foreground">
                    Suggested Business Domains
                  </Label>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {parsedOutcome.suggestedDomains.map((d, i) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {d}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Suggested Priorities</Label>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {parsedOutcome.suggestedPriorities.map((p, i) => (
                      <Badge key={i} variant="outline" className="text-xs">
                        {p}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Objectives and priorities */}
          {parsedOutcome.objectives.map((objective, objIdx) => (
            <Card key={objIdx}>
              <CardHeader>
                <CardTitle className="text-base">
                  {editMode ? (
                    <Input
                      value={objective.name}
                      onChange={(e) => updateObjective(objIdx, "name", e.target.value)}
                    />
                  ) : (
                    <span className="flex items-center gap-2">
                      <Target className="h-4 w-4 text-primary" />
                      {objective.name}
                    </span>
                  )}
                </CardTitle>
                {objective.whyChange && (
                  <CardDescription className="text-xs leading-relaxed">
                    {editMode ? (
                      <Textarea
                        value={objective.whyChange}
                        onChange={(e) => updateObjective(objIdx, "whyChange", e.target.value)}
                        className="text-xs"
                        rows={3}
                      />
                    ) : (
                      objective.whyChange
                    )}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <Accordion type="multiple" className="w-full">
                  {objective.priorities.map((priority, priIdx) => (
                    <AccordionItem key={priIdx} value={`${objIdx}-${priIdx}`}>
                      <AccordionTrigger className="text-sm">
                        <div className="flex items-center gap-2">
                          {editMode ? (
                            <Input
                              value={priority.name}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                updatePriority(objIdx, priIdx, "name", e.target.value)
                              }
                              className="text-sm"
                            />
                          ) : (
                            <>
                              <Sparkles className="h-3 w-3 text-amber-500" />
                              {priority.name}
                              <Badge variant="secondary" className="text-xs">
                                {priority.useCases.length} use cases
                              </Badge>
                            </>
                          )}
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-3 pl-2">
                          {/* Use cases */}
                          {priority.useCases.map((uc, ucIdx) => (
                            <div
                              key={ucIdx}
                              className="group flex items-start gap-3 rounded-md border bg-muted/30 p-3"
                            >
                              <div className="flex-1">
                                {editMode ? (
                                  <div className="space-y-2">
                                    <Input
                                      value={uc.name}
                                      onChange={(e) =>
                                        updateUseCase(objIdx, priIdx, ucIdx, "name", e.target.value)
                                      }
                                      className="text-sm font-medium"
                                      placeholder="Use case name"
                                    />
                                    <Textarea
                                      value={uc.description}
                                      onChange={(e) =>
                                        updateUseCase(
                                          objIdx,
                                          priIdx,
                                          ucIdx,
                                          "description",
                                          e.target.value,
                                        )
                                      }
                                      className="text-xs"
                                      rows={2}
                                      placeholder="Description"
                                    />
                                  </div>
                                ) : (
                                  <>
                                    <p className="text-sm font-medium">{uc.name}</p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      {uc.description}
                                    </p>
                                    {uc.businessValue && (
                                      <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                                        Value: {uc.businessValue}
                                      </p>
                                    )}
                                  </>
                                )}
                              </div>
                              {editMode && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 shrink-0 text-destructive"
                                  onClick={() => removeUseCase(objIdx, priIdx, ucIdx)}
                                  aria-label="Remove use case"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          ))}
                          {editMode && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => addUseCase(objIdx, priIdx)}
                            >
                              <Plus className="mr-1 h-3 w-3" />
                              Add Use Case
                            </Button>
                          )}

                          {/* KPIs & Personas */}
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            {priority.kpis.length > 0 && (
                              <div>
                                <Label className="text-xs text-muted-foreground">KPIs</Label>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {priority.kpis.map((kpi, i) => (
                                    <Badge key={i} variant="outline" className="text-xs">
                                      {kpi}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                            {priority.personas.length > 0 && (
                              <div>
                                <Label className="text-xs text-muted-foreground">Personas</Label>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {priority.personas.map((p, i) => (
                                    <Badge key={i} variant="secondary" className="text-xs">
                                      {p}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </Card>
          ))}

          {saveError && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {saveError}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-between">
            <Button
              variant="outline"
              onClick={() => {
                setStep("upload");
                setParsedOutcome(null);
              }}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Start Over
            </Button>
            <Button size="lg" onClick={handleSave}>
              <Save className="mr-2 h-4 w-4" />
              Save Outcome Map
            </Button>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Step 4: Saving */}
      {/* ----------------------------------------------------------------- */}
      {step === "saving" && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-4 py-16">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <div className="text-center">
              <p className="text-lg font-medium">Saving outcome map to Lakebase...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Step 5: Done */}
      {/* ----------------------------------------------------------------- */}
      {step === "done" && parsedOutcome && (
        <Card className="border-emerald-200 bg-gradient-to-r from-emerald-50/50 to-emerald-50/0 dark:border-emerald-800 dark:from-emerald-950/20">
          <CardContent className="flex flex-col items-center justify-center gap-6 py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/50">
              <Check className="h-8 w-8 text-emerald-600" />
            </div>
            <div className="text-center">
              <p className="text-xl font-bold">Outcome Map Ingested!</p>
              <p className="mt-2 text-sm text-muted-foreground">
                <strong>{parsedOutcome.name}</strong> with {stats?.useCases ?? 0} use cases is now
                part of the Forge engine.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                It will appear in the industry dropdown when configuring new pipeline runs.
              </p>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setStep("upload");
                  setRawMarkdown("");
                  setFileName("");
                  setParsedOutcome(null);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Ingest Another
              </Button>
              <Button onClick={() => router.push("/outcomes")}>
                <ArrowRight className="mr-2 h-4 w-4" />
                View All Outcome Maps
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StepIndicator({
  label,
  stepNum,
  active,
  completed,
}: {
  label: string;
  stepNum: number;
  active: boolean;
  completed: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
          completed
            ? "bg-emerald-500 text-white"
            : active
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
        }`}
      >
        {completed ? <Check className="h-3 w-3" /> : stepNum}
      </div>
      <span
        className={`text-xs ${active ? "font-medium text-foreground" : "text-muted-foreground"}`}
      >
        {label}
      </span>
    </div>
  );
}

function ChevronSep() {
  return <div className="h-px w-4 bg-muted-foreground/25" />;
}

function StatBadge({
  icon,
  label,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2.5 py-1.5">
      {icon}
      <span className="text-xs font-medium">{count}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
