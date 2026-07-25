"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { InfoTip, LabelWithTip } from "@/components/ui/info-tip";
import { CONFIG } from "@/lib/help-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Keyboard,
  X,
  Plus,
  Building2,
  Target,
  Scale,
  Layers,
  ScanLine,
  ChevronDown,
  Search,
  Zap,
  TrendingUp,
  Database,
  Lock,
} from "lucide-react";
import { CatalogBrowser } from "@/components/pipeline/catalog-browser";
import {
  BUSINESS_PRIORITIES,
  DISCOVERY_DEPTHS,
  type BusinessPriority,
  type DiscoveryDepth,
} from "@/lib/domain/types";

const DEPTH_OPTIONS: Array<{
  value: DiscoveryDepth;
  label: string;
  description: string;
  icon: typeof Target;
}> = [
  {
    value: "focused",
    label: "Focused",
    description: "Fewer, highest-quality use cases. Best for targeted workshops or demos.",
    icon: Target,
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "Good mix of breadth and quality. Recommended for most discovery runs.",
    icon: Scale,
  },
  {
    value: "comprehensive",
    label: "Comprehensive",
    description: "Maximum coverage across your data estate. Best for large-scale assessments.",
    icon: Layers,
  },
];
import { loadSettings } from "@/lib/settings";
import { useIndustryOutcomes } from "@/lib/hooks/use-industry-outcomes";

const SUGGESTED_DOMAINS = [
  "Finance",
  "Risk & Compliance",
  "Marketing",
  "Sales",
  "Operations",
  "Supply Chain",
  "Human Resources",
  "Customer Experience",
  "Healthcare",
  "Manufacturing",
  "Retail",
  "Insurance",
  "Cybersecurity",
  "Sustainability",
];

export function ConfigForm({
  onBusinessNameChange,
  sourceScanId = null,
  sourceUcPath = null,
  onRemoveSource,
}: {
  onBusinessNameChange?: (name: string) => void;
  /** When set, seed metadata from this estate scan instead of live UC extraction. */
  sourceScanId?: string | null;
  /** Authoritative UC scope derived server-side from the source scan. */
  sourceUcPath?: string | null;
  /** Clear the source scan and switch back to live extraction. */
  onRemoveSource?: () => void;
} = {}) {
  const router = useRouter();
  const sourceActive = Boolean(sourceScanId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [discoveryDepth, setDiscoveryDepth] = useState<DiscoveryDepth>(() => {
    if (typeof window === "undefined") return "balanced";
    return loadSettings().defaultDiscoveryDepth ?? "balanced";
  });
  const [estateScanEnabled, setEstateScanEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    return loadSettings().estateScanEnabled;
  });
  const [assetDiscoveryEnabled, setAssetDiscoveryEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    return loadSettings().assetDiscoveryEnabled;
  });
  const [businessValueEnabled, setBusinessValueEnabled] = useState(true);
  const [businessName, setBusinessName] = useState("");
  const settingsIndustry = typeof window !== "undefined" ? loadSettings().industry : "";
  const [industry, setIndustry] = useState(settingsIndustry);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [excludedSources, setExcludedSources] = useState<string[]>([]);
  const [exclusionPatterns, setExclusionPatterns] = useState<string[]>([]);
  const [manualMode, setManualMode] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [businessDomains, setBusinessDomains] = useState<string[]>([]);
  const [domainInput, setDomainInput] = useState("");

  const {
    getOptions: getIndustryOptions,
    getOutcome: getIndustryOutcome,
    loading: industryOutcomesLoading,
  } = useIndustryOutcomes();
  const industryOptions = getIndustryOptions();

  const applyIndustrySuggestions = (industryId: string) => {
    const outcome = getIndustryOutcome(industryId);
    if (!outcome) return;
    if (businessDomains.length === 0) {
      setBusinessDomains(outcome.suggestedDomains);
    }
    if (selectedPriorities.length <= 1 && selectedPriorities[0] === "Increase Revenue") {
      const mapped = outcome.suggestedPriorities.filter((p) =>
        (BUSINESS_PRIORITIES as readonly string[]).includes(p),
      ) as BusinessPriority[];
      if (mapped.length > 0) {
        setSelectedPriorities(mapped);
      }
    }
  };

  const handleIndustryChange = (value: string) => {
    const newIndustry = value === "__none__" ? "" : value;
    setIndustry(newIndustry);
    if (newIndustry) applyIndustrySuggestions(newIndustry);
  };

  // When industry is pre-set from global settings, apply suggestions once outcomes load
  useEffect(() => {
    if (settingsIndustry && !industryOutcomesLoading) {
      applyIndustrySuggestions(settingsIndustry);
    }
  }, [industryOutcomesLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive ucMetadata. When a source scan is active the scope is authoritative
  // from the server (the run route re-derives it from the scan anyway), so the
  // live selection is ignored and locked in the UI.
  const ucMetadata = sourceActive
    ? (sourceUcPath ?? "")
    : manualMode
      ? manualInput.trim()
      : selectedSources.join(", ");
  const [fabricScanId, setFabricScanId] = useState<string | null>(null);
  const [fabricScans, setFabricScans] = useState<Array<{ id: string; label: string }>>([]);

  useEffect(() => {
    fetch("/api/fabric/scan")
      .then((res) => (res.ok ? res.json() : { scans: [] }))
      .then((data) => {
        const completed = (data.scans ?? [])
          .filter((s: { status: string }) => s.status === "completed")
          .slice(0, 20)
          .map(
            (s: {
              id: string;
              datasetCount?: number;
              reportCount?: number;
              createdAt?: string;
            }) => ({
              id: s.id,
              label: `${s.datasetCount ?? 0} datasets, ${s.reportCount ?? 0} reports (${s.createdAt ? new Date(s.createdAt).toLocaleDateString() : "unknown"})`,
            }),
          );
        setFabricScans(completed);
      })
      .catch(() => {});
  }, []);

  const [selectedPriorities, setSelectedPriorities] = useState<BusinessPriority[]>([
    "Increase Revenue",
  ]);
  const [strategicGoals, setStrategicGoals] = useState("");
  const [additionalContext, setAdditionalContext] = useState("");
  const [customerMaturity, setCustomerMaturity] = useState<"nascent" | "developing" | "advanced">(
    "developing",
  );
  const [riskPosture, setRiskPosture] = useState<"conservative" | "balanced" | "aggressive">(
    "balanced",
  );
  const [transformationHorizon, setTransformationHorizon] = useState<
    "quarter" | "half-year" | "year-plus"
  >("half-year");

  // Hydrate from sessionStorage (for "Duplicate Config" flow)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("forge:duplicate-config");
      if (!raw) return;
      sessionStorage.removeItem("forge:duplicate-config");
      const cfg = JSON.parse(raw);
      if (cfg.discoveryDepth && DISCOVERY_DEPTHS.includes(cfg.discoveryDepth))
        setDiscoveryDepth(cfg.discoveryDepth);
      if (cfg.businessName) setBusinessName(cfg.businessName);
      if (cfg.industry) setIndustry(cfg.industry);
      if (cfg.ucMetadata) {
        setManualMode(true);
        setManualInput(cfg.ucMetadata);
      }
      if (cfg.businessDomains?.length) {
        const domains = Array.isArray(cfg.businessDomains)
          ? cfg.businessDomains
          : cfg.businessDomains
              .split(",")
              .map((d: string) => d.trim())
              .filter(Boolean);
        setBusinessDomains(domains);
      }
      if (cfg.businessPriorities?.length) setSelectedPriorities(cfg.businessPriorities);
      if (cfg.strategicGoals) setStrategicGoals(cfg.strategicGoals);
      if (cfg.additionalContext) setAdditionalContext(cfg.additionalContext);
      if (cfg.customerMaturity) setCustomerMaturity(cfg.customerMaturity);
      if (cfg.riskPosture) setRiskPosture(cfg.riskPosture);
      if (cfg.transformationHorizon) setTransformationHorizon(cfg.transformationHorizon);
    } catch {
      // Ignore malformed data
    }
  }, []);

  const togglePriority = (priority: BusinessPriority) => {
    setSelectedPriorities((prev) =>
      prev.includes(priority) ? prev.filter((p) => p !== priority) : [...prev, priority],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const errors: Record<string, string> = {};
    if (!businessName.trim()) {
      errors.businessName = "Business Name is required";
    }
    if (!ucMetadata) {
      errors.ucMetadata = "Select at least one catalog or schema from Unity Catalog";
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      toast.error(Object.values(errors)[0]);
      return;
    }
    setFieldErrors({});

    setIsSubmitting(true);

    try {
      // Read app-wide settings (configured in Settings page)
      const appSettings = loadSettings();

      // Create the run
      const createRes = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: businessName.trim(),
          ucMetadata,
          excludedScope: excludedSources.join(", "),
          exclusionPatterns: exclusionPatterns.join(", "),
          industry,
          businessDomains: businessDomains.join(", "),
          businessPriorities: selectedPriorities,
          strategicGoals: strategicGoals.trim(),
          additionalContext: additionalContext.trim(),
          customerMaturity,
          riskPosture,
          transformationHorizon,
          languages: ["English"],
          outputLanguage: appSettings.aiCommentLanguage,
          sampleRowsPerTable: appSettings.sampleRowsPerTable,
          discoveryDepth,
          depthConfig: appSettings.discoveryDepthConfigs[discoveryDepth],
          // A source-scan run reconstitutes metadata from the scan; never
          // re-run a live estate scan during the pipeline.
          estateScanEnabled: sourceActive ? false : estateScanEnabled,
          assetDiscoveryEnabled,
          businessValueEnabled,
          ...(fabricScanId ? { fabricScanId } : {}),
          ...(sourceActive ? { sourceScanId } : {}),
        }),
      });

      if (!createRes.ok) {
        const err = await createRes.json();
        throw new Error(err.error ?? "Failed to create run");
      }

      const { runId } = await createRes.json();

      // Start execution
      const execRes = await fetch(`/api/runs/${runId}/execute`, {
        method: "POST",
      });

      if (!execRes.ok) {
        const err = await execRes.json();
        throw new Error(err.error ?? "Failed to start pipeline");
      }

      toast.success("Pipeline started! Redirecting to run details...");
      router.push(`/runs/${runId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Discovery Depth */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1">
            Discovery Depth
            <InfoTip tip={CONFIG.discoveryDepth} />
          </CardTitle>
          <CardDescription>
            Choose how broadly to search for use cases. This affects how many use cases are
            generated and the quality threshold applied.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            {DEPTH_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const selected = discoveryDepth === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDiscoveryDepth(opt.value)}
                  className={`flex flex-col items-start gap-2 rounded-lg border-2 p-4 text-left transition-colors ${
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-muted hover:border-muted-foreground/30"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon
                      className={`h-4 w-4 ${selected ? "text-primary" : "text-muted-foreground"}`}
                    />
                    <span className={`text-sm font-medium ${selected ? "text-primary" : ""}`}>
                      {opt.label}
                    </span>
                    {opt.value === "balanced" && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        Recommended
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{opt.description}</p>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Required Fields */}
      <Card>
        <CardHeader>
          <CardTitle>Required Configuration</CardTitle>
          <CardDescription>
            These fields are needed to start a discovery run. The AI uses your business name to
            generate industry context and tailor use case recommendations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="businessName">
              <LabelWithTip label="Business Name" tip={CONFIG.businessName} />
            </Label>
            <Input
              id="businessName"
              placeholder="e.g. Acme Financial Services"
              value={businessName}
              onChange={(e) => {
                setBusinessName(e.target.value);
                onBusinessNameChange?.(e.target.value);
                if (fieldErrors.businessName)
                  setFieldErrors((prev) => {
                    const next = { ...prev };
                    delete next.businessName;
                    return next;
                  });
              }}
              aria-invalid={!!fieldErrors.businessName}
              className={
                fieldErrors.businessName ? "border-destructive focus-visible:ring-destructive" : ""
              }
              required
            />
            {fieldErrors.businessName ? (
              <p className="text-xs text-destructive">{fieldErrors.businessName}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Your organisation or project name -- the AI derives industry context, value chain,
                and revenue model from this.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="industry">
              <LabelWithTip label="Industry (optional)" tip={CONFIG.industry} />
            </Label>
            {settingsIndustry ? (
              <>
                <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {industryOptions.find((o) => o.id === settingsIndustry)?.name ??
                      settingsIndustry}
                  </span>
                  <Badge variant="secondary" className="ml-auto text-[10px]">
                    From Settings
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Industry is set globally in{" "}
                  <Link href="/settings" className="underline text-primary hover:text-primary/80">
                    Settings
                  </Link>
                  . All runs will use this industry automatically.
                </p>
              </>
            ) : (
              <>
                <Select value={industry || "__none__"} onValueChange={handleIndustryChange}>
                  <SelectTrigger id="industry">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <SelectValue placeholder="Select an industry..." />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not specified</SelectItem>
                    {industryOptions.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id}>
                        {opt.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {industry ? (
                    <span className="text-primary">
                      Industry context will be injected into prompts with curated use cases, KPIs,
                      and strategic context.
                    </span>
                  ) : (
                    <>
                      If left empty, the system will auto-detect the best matching industry from the
                      business context generated in Step 1.
                    </>
                  )}
                </p>
              </>
            )}
          </div>

          <div className="space-y-2">
            <LabelWithTip label="UC Metadata Sources" tip={CONFIG.ucMetadata} />
            {fieldErrors.ucMetadata && (
              <p className="text-xs text-destructive">{fieldErrors.ucMetadata}</p>
            )}
            {sourceActive ? (
              <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-4">
                <div className="flex items-start gap-3">
                  <Database className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      Sourced from estate scan
                      <Badge variant="secondary" className="gap-1 text-[10px]">
                        <Lock className="h-3 w-3" />
                        Scope locked
                      </Badge>
                    </p>
                    <p className="break-all font-mono text-xs text-muted-foreground">
                      {sourceUcPath}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Metadata is reconstituted from the completed estate scan — no live Unity
                      Catalog extraction runs. The scope above is authoritative.
                    </p>
                    {onRemoveSource && (
                      <button
                        type="button"
                        onClick={onRemoveSource}
                        className="inline-flex items-center gap-1 pt-1 text-xs text-primary hover:underline"
                      >
                        <X className="h-3 w-3" />
                        Remove &amp; use live extraction
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : manualMode ? (
              <>
                <Input
                  id="ucMetadata"
                  placeholder="e.g. main.finance or catalog1, catalog2"
                  value={manualInput}
                  onChange={(e) => {
                    setManualInput(e.target.value);
                    if (fieldErrors.ucMetadata)
                      setFieldErrors((prev) => {
                        const next = { ...prev };
                        delete next.ucMetadata;
                        return next;
                      });
                  }}
                  aria-invalid={!!fieldErrors.ucMetadata}
                  className={
                    fieldErrors.ucMetadata
                      ? "border-destructive focus-visible:ring-destructive"
                      : ""
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Comma-separated list: catalog, catalog.schema, or mix
                </p>
                <button
                  type="button"
                  onClick={() => setManualMode(false)}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Keyboard className="h-3 w-3" />
                  Switch to catalog browser
                </button>
              </>
            ) : (
              <>
                <CatalogBrowser
                  selectedSources={selectedSources}
                  excludedSources={excludedSources}
                  exclusionPatterns={exclusionPatterns}
                  onSelectionChange={(sources, excluded, patterns) => {
                    setSelectedSources(sources);
                    setExcludedSources(excluded);
                    setExclusionPatterns(patterns);
                    if (fieldErrors.ucMetadata)
                      setFieldErrors((prev) => {
                        const next = { ...prev };
                        delete next.ucMetadata;
                        return next;
                      });
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setManualMode(true);
                    setManualInput(selectedSources.join(", "));
                  }}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  <Keyboard className="h-3 w-3" />
                  Or type manually
                </button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Business Priorities */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1">
            Business Priorities
            <InfoTip tip={CONFIG.priorities} />
          </CardTitle>
          <CardDescription>
            Select the priorities that matter most to your organisation. These directly influence
            how use cases are scored -- higher weight is given to use cases aligned with your
            selected priorities.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              onClick={() =>
                setSelectedPriorities(
                  selectedPriorities.length === BUSINESS_PRIORITIES.length
                    ? []
                    : [...BUSINESS_PRIORITIES],
                )
              }
              className="text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              {selectedPriorities.length === BUSINESS_PRIORITIES.length
                ? "Deselect all"
                : "Select all"}
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {BUSINESS_PRIORITIES.map((priority) => (
              <label key={priority} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={selectedPriorities.includes(priority)}
                  onCheckedChange={() => togglePriority(priority)}
                />
                {priority}
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Optional Fields */}
      <Collapsible defaultOpen={false}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer select-none">
              <div className="flex items-center justify-between">
                <CardTitle>Advanced Configuration</CardTitle>
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
              </div>
              <CardDescription>
                Optional settings -- defaults are auto-detected by the AI. Only override these if
                you want to constrain the analysis to specific business domains or use a particular
                AI model.
              </CardDescription>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <LabelWithTip label="Business Domains (optional)" tip={CONFIG.domains} />

                {/* Selected domains */}
                {businessDomains.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {businessDomains.map((domain) => (
                      <Badge key={domain} variant="secondary" className="gap-1 pr-1">
                        {domain}
                        <button
                          type="button"
                          onClick={() =>
                            setBusinessDomains((prev) => prev.filter((d) => d !== domain))
                          }
                          className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                          aria-label={`Remove ${domain}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Quick-add suggestions */}
                <div>
                  <p className="mb-1.5 text-xs text-muted-foreground">Quick add:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {SUGGESTED_DOMAINS.filter((d) => !businessDomains.includes(d)).map((domain) => (
                      <button
                        key={domain}
                        type="button"
                        onClick={() => setBusinessDomains((prev) => [...prev, domain])}
                        className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                      >
                        <Plus className="h-3 w-3" />
                        {domain}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom domain input */}
                <div className="flex gap-2">
                  <Input
                    id="businessDomains"
                    placeholder="Add a custom domain..."
                    value={domainInput}
                    onChange={(e) => setDomainInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && domainInput.trim()) {
                        e.preventDefault();
                        const val = domainInput.trim();
                        if (!businessDomains.includes(val)) {
                          setBusinessDomains((prev) => [...prev, val]);
                        }
                        setDomainInput("");
                      }
                    }}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!domainInput.trim()}
                    onClick={() => {
                      const val = domainInput.trim();
                      if (val && !businessDomains.includes(val)) {
                        setBusinessDomains((prev) => [...prev, val]);
                      }
                      setDomainInput("");
                    }}
                  >
                    Add
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">Leave empty for AI auto-detection</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="strategicGoals">
                  <LabelWithTip label="Strategic Goals (optional)" tip={CONFIG.strategicGoals} />
                </Label>
                <Textarea
                  id="strategicGoals"
                  placeholder="Custom strategic goals for use case prioritisation..."
                  value={strategicGoals}
                  onChange={(e) => setStrategicGoals(e.target.value)}
                  rows={3}
                />
                <p className="text-xs text-muted-foreground">Leave blank for AI-generated goals</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="additionalContext">
                  <LabelWithTip
                    label="Additional Context (optional)"
                    tip="Provide KPI targets, constraints, regulatory context, and must-win initiatives."
                  />
                </Label>
                <Textarea
                  id="additionalContext"
                  placeholder="e.g. Reduce claim leakage by 15% in 2 quarters, prioritize regulatory reporting readiness, avoid high-change architecture..."
                  value={additionalContext}
                  onChange={(e) => setAdditionalContext(e.target.value)}
                  rows={4}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Customer Maturity</Label>
                  <Select
                    value={customerMaturity}
                    onValueChange={(v) => setCustomerMaturity(v as typeof customerMaturity)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="nascent">Nascent</SelectItem>
                      <SelectItem value="developing">Developing</SelectItem>
                      <SelectItem value="advanced">Advanced</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Risk Posture</Label>
                  <Select
                    value={riskPosture}
                    onValueChange={(v) => setRiskPosture(v as typeof riskPosture)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="conservative">Conservative</SelectItem>
                      <SelectItem value="balanced">Balanced</SelectItem>
                      <SelectItem value="aggressive">Aggressive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Transformation Horizon</Label>
                  <Select
                    value={transformationHorizon}
                    onValueChange={(v) =>
                      setTransformationHorizon(v as typeof transformationHorizon)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="quarter">Quarter</SelectItem>
                      <SelectItem value="half-year">Half-Year</SelectItem>
                      <SelectItem value="year-plus">Year Plus</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div
                className={`flex items-center justify-between rounded-lg border-2 p-4 transition-colors ${
                  estateScanEnabled ? "border-emerald-500/50 bg-emerald-500/5" : "border-muted"
                }`}
              >
                <div className="flex items-start gap-3">
                  <ScanLine
                    className={`mt-0.5 h-4 w-4 shrink-0 ${estateScanEnabled ? "text-emerald-500" : "text-muted-foreground"}`}
                  />
                  <div>
                    <p className="text-sm font-medium flex items-center gap-1">
                      Estate Scan
                      <InfoTip tip={CONFIG.estateScan} />
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Run environment intelligence (domain classification, PII detection, health
                      scoring, lineage) during this run
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEstateScanEnabled((prev) => !prev)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    estateScanEnabled ? "bg-emerald-500" : "bg-muted"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${
                      estateScanEnabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              <div
                className={`flex items-center justify-between rounded-lg border-2 p-4 transition-colors ${
                  assetDiscoveryEnabled ? "border-sky-500/50 bg-sky-500/5" : "border-muted"
                }`}
              >
                <div className="flex items-start gap-3">
                  <Search
                    className={`mt-0.5 h-4 w-4 shrink-0 ${assetDiscoveryEnabled ? "text-sky-500" : "text-muted-foreground"}`}
                  />
                  <div>
                    <p className="text-sm font-medium flex items-center gap-1">
                      Asset Discovery
                      <InfoTip tip={CONFIG.assetDiscovery} />
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Discover existing Genie spaces, dashboards, and metric views to avoid
                      duplicate recommendations and identify gaps
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAssetDiscoveryEnabled((prev) => !prev)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    assetDiscoveryEnabled ? "bg-sky-500" : "bg-muted"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${
                      assetDiscoveryEnabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              <div
                className={`flex items-center justify-between rounded-lg border-2 p-4 transition-colors ${
                  businessValueEnabled ? "border-amber-500/50 bg-amber-500/5" : "border-muted"
                }`}
              >
                <div className="flex items-start gap-3">
                  <TrendingUp
                    className={`mt-0.5 h-4 w-4 shrink-0 ${businessValueEnabled ? "text-amber-500" : "text-muted-foreground"}`}
                  />
                  <div>
                    <p className="text-sm font-medium">Business Value Analysis</p>
                    <p className="text-xs text-muted-foreground">
                      Run financial quantification, roadmap phasing, executive synthesis, and
                      stakeholder analysis as part of this pipeline run. Can also be run
                      independently from the Business Value page.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setBusinessValueEnabled((prev) => !prev)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    businessValueEnabled ? "bg-amber-500" : "bg-muted"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${
                      businessValueEnabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {fabricScans.length > 0 && (
                <div
                  className={`flex items-center justify-between rounded-lg border-2 p-4 transition-colors ${
                    fabricScanId ? "border-violet-500/50 bg-violet-500/5" : "border-muted"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <Zap
                      className={`mt-0.5 h-4 w-4 shrink-0 ${fabricScanId ? "text-violet-500" : "text-muted-foreground"}`}
                    />
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Link Power BI Scan</p>
                      <p className="text-xs text-muted-foreground">
                        Use case generation will be aware of your PBI estate and propose
                        replacements
                      </p>
                      <Select
                        value={fabricScanId ?? "__none__"}
                        onValueChange={(v) => setFabricScanId(v === "__none__" ? null : v)}
                      >
                        <SelectTrigger className="w-full max-w-sm">
                          <SelectValue placeholder="No scan linked" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No scan linked</SelectItem>
                          {fabricScans.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Submit */}
      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? "Starting Discovery..." : "Start Discovery"}
        </Button>
      </div>
    </form>
  );
}
