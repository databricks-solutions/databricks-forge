"use client";

import { useState, useCallback } from "react";
import { ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CompanyInfoStep } from "./steps/company-info-step";
import { ResearchResultsStep } from "./steps/research-results-step";
import { CatalogSelectionStep } from "./steps/catalog-selection-step";
import { SchemaReviewStep } from "./steps/schema-review-step";
import { GenerationProgressStep } from "./steps/generation-progress-step";
import { CompleteStep } from "./steps/complete-step";
import type { ResearchPreset, DemoScope, ParsedDocument } from "@/lib/demo/types";
import type { ResearchEngineResult } from "@/lib/demo/research-engine/types";

type WizardStep =
  | "company-info"
  | "research"
  | "catalog"
  | "schema-review"
  | "progress"
  | "complete";

const STEPS: { key: WizardStep; label: string }[] = [
  { key: "company-info", label: "Company" },
  { key: "research", label: "Research" },
  { key: "catalog", label: "Catalog" },
  { key: "schema-review", label: "Review" },
  { key: "progress", label: "Generate" },
  { key: "complete", label: "Launch" },
];

interface DemoWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DemoWizard({ open, onOpenChange }: DemoWizardProps) {
  const [step, setStep] = useState<WizardStep>("company-info");
  const [sessionId, setSessionId] = useState<string>("");
  const [retryCount, setRetryCount] = useState(0);

  // Step 1 state
  const [customerName, setCustomerName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [industryId, setIndustryId] = useState("");
  const [preset, setPreset] = useState<ResearchPreset>("balanced");
  const [scope, setScope] = useState<DemoScope>({});
  const [uploadedDocs, setUploadedDocs] = useState<ParsedDocument[]>([]);
  const [pastedContext, setPastedContext] = useState("");
  const [genieMode, setGenieMode] = useState(false);

  // Step 2 state
  const [research, setResearch] = useState<ResearchEngineResult | null>(null);

  // Step 3 state
  const [catalog, setCatalog] = useState("");
  const [schema, setSchema] = useState("");
  const [catalogCreated, setCatalogCreated] = useState(false);

  // Timing
  const [wizardStartTime, setWizardStartTime] = useState<number>(0);

  const currentStepIndex = STEPS.findIndex((s) => s.key === step);

  const handleStartResearch = useCallback(async () => {
    try {
      const resp = await fetch("/api/demo/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName,
          industryId: industryId || undefined,
          preset,
          websiteUrl: websiteUrl || undefined,
          scope,
          pastedContext: pastedContext || undefined,
        }),
      });
      const data = await resp.json();
      if (data.sessionId) {
        setSessionId(data.sessionId);
        setWizardStartTime(Date.now());
        setStep("research");
      }
    } catch {
      // handled in step component
    }
  }, [customerName, industryId, preset, websiteUrl, scope, pastedContext]);

  const handleResearchComplete = useCallback((result: ResearchEngineResult) => {
    setResearch(result);
    if (result.industryId) setIndustryId(result.industryId);
  }, []);

  const handleStartGeneration = useCallback(async () => {
    try {
      const resp = await fetch("/api/demo/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          catalog,
          schema,
          catalogCreated,
          genieMode,
        }),
      });
      const data = await resp.json();
      if (data.sessionId) {
        setStep("progress");
      }
    } catch {
      // handled in step component
    }
  }, [sessionId, catalog, schema, catalogCreated, genieMode]);

  const handleRetryFailedTables = useCallback(
    async (_failedTables: string[]) => {
      setRetryCount((c) => c + 1);
      // Re-trigger generation; backend will restart the job for the same session
      await handleStartGeneration();
    },
    [handleStartGeneration],
  );

  const handleClose = () => {
    onOpenChange(false);
    // Reset state after close animation
    setTimeout(() => {
      setStep("company-info");
      setSessionId("");
      setCustomerName("");
      setWebsiteUrl("");
      setIndustryId("");
      setPreset("balanced");
      setScope({});
      setUploadedDocs([]);
      setPastedContext("");
      setResearch(null);
      setCatalog("");
      setSchema("");
      setCatalogCreated(false);
      setWizardStartTime(0);
      setRetryCount(0);
      setGenieMode(false);
    }, 300);
  };

  const stepDescriptions: Record<WizardStep, string> = {
    "company-info": "Tell us about the customer to research.",
    research: "Reviewing research results...",
    catalog: "Choose where to create the demo data.",
    "schema-review": "Review the proposed table schema.",
    progress: "Generating demo data...",
    complete: "Launching discovery pipeline...",
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Demo Data Wizard</DialogTitle>
          <DialogDescription>{stepDescriptions[step]}</DialogDescription>
          <div className="flex items-center gap-1 pt-2">
            {STEPS.map((s, idx) => (
              <span key={s.key} className="flex items-center gap-1">
                {idx > 0 && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                )}
                <StepIndicator
                  label={s.label}
                  active={s.key === step}
                  done={idx < currentStepIndex}
                />
              </span>
            ))}
          </div>
        </DialogHeader>

        <Separator />

        <div className="flex-1 overflow-y-auto min-h-0 py-4">
          {step === "company-info" && (
            <CompanyInfoStep
              customerName={customerName}
              onCustomerNameChange={setCustomerName}
              websiteUrl={websiteUrl}
              onWebsiteUrlChange={setWebsiteUrl}
              industryId={industryId}
              onIndustryIdChange={setIndustryId}
              preset={preset}
              onPresetChange={setPreset}
              scope={scope}
              onScopeChange={setScope}
              uploadedDocs={uploadedDocs}
              onUploadedDocsChange={setUploadedDocs}
              pastedContext={pastedContext}
              onPastedContextChange={setPastedContext}
              genieMode={genieMode}
              onGenieModeChange={setGenieMode}
            />
          )}

          {step === "research" && (
            <ResearchResultsStep
              sessionId={sessionId}
              onResearchComplete={handleResearchComplete}
              research={research}
            />
          )}

          {step === "catalog" && (
            <CatalogSelectionStep
              catalog={catalog}
              onCatalogChange={setCatalog}
              schema={schema}
              onSchemaChange={setSchema}
              customerName={customerName}
              scope={scope}
              onCatalogCreatedChange={setCatalogCreated}
            />
          )}

          {step === "schema-review" && research && (
            <SchemaReviewStep research={research} />
          )}

          {step === "progress" && (
            <GenerationProgressStep
              key={retryCount}
              sessionId={sessionId}
              onComplete={() => setStep("complete")}
              onRetryNeeded={handleRetryFailedTables}
            />
          )}

          {step === "complete" && (
            <CompleteStep
              sessionId={sessionId}
              catalog={catalog}
              schema={schema}
              customerName={customerName}
              industryId={industryId}
              wizardStartTime={wizardStartTime}
              genieMode={genieMode}
            />
          )}
        </div>

        <DialogFooter>
          {step !== "company-info" && step !== "progress" && step !== "complete" && (
            <Button
              variant="outline"
              onClick={() => {
                const idx = STEPS.findIndex((s) => s.key === step);
                if (idx > 0) setStep(STEPS[idx - 1].key);
              }}
            >
              Back
            </Button>
          )}

          {step === "company-info" && (
            <Button
              disabled={!customerName.trim()}
              onClick={handleStartResearch}
            >
              Start Research
            </Button>
          )}

          {step === "research" && research && (
            <Button onClick={() => setStep("catalog")}>
              Continue to Catalog
            </Button>
          )}

          {step === "catalog" && (
            <Button
              disabled={!catalog || !schema}
              onClick={() => setStep("schema-review")}
            >
              Review Schema
            </Button>
          )}

          {step === "schema-review" && (
            <Button onClick={handleStartGeneration}>
              Generate Data
            </Button>
          )}

          {step === "complete" && (
            <Button onClick={handleClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StepIndicator({
  label,
  active,
  done,
}: {
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
        active
          ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
          : done
            ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
            : "bg-muted text-muted-foreground"
      }`}
    >
      {label}
    </span>
  );
}
