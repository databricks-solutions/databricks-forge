"use client";

import { useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { loadSettings } from "@/lib/settings";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Database,
  BarChart3,
  LayoutDashboard,
  Sparkles,
  Table2,
  AlertTriangle,
  Code2,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types (mirrors migration-orchestrator.ts)
// ---------------------------------------------------------------------------

type ArtifactStatus = "pending" | "proposed" | "deployed" | "failed" | "skipped";

interface GoldTableProposal {
  pbiTableName: string;
  ucTableName: string;
  ddl: string;
  columns: Array<{ pbiName: string; ucName: string; pbiType: string; sparkType: string }>;
  relationships: Array<{ fromColumn: string; toTable: string; toColumn: string }>;
  sensitivityLabel?: string | null;
  tagDdl?: string;
  deployStatus: ArtifactStatus;
  error?: string;
}

interface DaxTranslation {
  measureName: string;
  daxExpression: string;
  sqlExpression: string;
  confidence: "high" | "medium" | "low";
  warnings: string[];
  method?: "template" | "llm";
}

interface RlsWarning {
  roleName: string;
  pbiTableName: string;
  ucTableName: string;
  filterExpression: string;
  members: string[];
  suggestedAction: string;
}

interface MigrationState {
  id: string;
  scanId: string;
  targetCatalog: string;
  targetSchema: string;
  status: string;
  currentStep: string | null;
  goldTables: GoldTableProposal[];
  metricViews: Array<{ name: string; yaml: string; deployStatus: ArtifactStatus; error?: string }>;
  dashboards: Array<{
    name: string;
    id?: string;
    url?: string;
    deployStatus: ArtifactStatus;
    error?: string;
  }>;
  genieSpaces: Array<{
    name: string;
    id?: string;
    url?: string;
    deployStatus: ArtifactStatus;
    error?: string;
  }>;
  daxTranslations: DaxTranslation[];
  nameMapping: Array<{ original: string; normalized: string; source: string }>;
  rlsWarnings: RlsWarning[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Steps config
// ---------------------------------------------------------------------------

const STEPS = [
  {
    key: "config",
    label: "Target",
    icon: Database,
    description: "Select target catalog and schema",
  },
  {
    key: "gold",
    label: "Gold Tables",
    icon: Table2,
    description: "Propose and deploy Gold schema",
  },
  { key: "metrics", label: "Metric Views", icon: BarChart3, description: "Translate DAX measures" },
  {
    key: "dashboards",
    label: "Dashboards",
    icon: LayoutDashboard,
    description: "Generate Lakeview dashboards",
  },
  { key: "genie", label: "Genie Spaces", icon: Sparkles, description: "Generate Genie spaces" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MigrationWizardPage() {
  const searchParams = useSearchParams();
  const scanId = searchParams?.get("scanId") ?? "";

  const [step, setStep] = useState<StepKey>("config");
  const [targetCatalog, setTargetCatalog] = useState("");
  const [targetSchema, setTargetSchema] = useState("");
  const [migration, setMigration] = useState<MigrationState | null>(null);
  const [loading, setLoading] = useState(false);

  const currentStepIdx = STEPS.findIndex((s) => s.key === step);

  const runAction = useCallback(async (endpoint: string, body: Record<string, unknown>) => {
    setLoading(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Request failed");
      }
      const state: MigrationState = await res.json();
      setMigration(state);
      return state;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Request failed");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const handleStartMigration = async () => {
    if (!scanId || !targetCatalog.trim() || !targetSchema.trim()) {
      toast.error("All fields are required");
      return;
    }
    const state = await runAction("/api/fabric/migrate", {
      scanId,
      targetCatalog: targetCatalog.trim(),
      targetSchema: targetSchema.trim(),
      resourcePrefix: loadSettings().catalogResourcePrefix,
    });
    if (state) setStep("gold");
  };

  const handleDeployGold = async () => {
    if (!migration) return;
    await runAction(`/api/fabric/migrate/${migration.id}`, { action: "deploy-gold" });
  };

  const handleMetricViews = async () => {
    if (!migration) return;
    const state = await runAction(`/api/fabric/migrate/${migration.id}`, {
      action: "metric-views",
    });
    if (state) setStep("metrics");
  };

  const handleDashboards = async () => {
    if (!migration) return;
    const state = await runAction(`/api/fabric/migrate/${migration.id}`, { action: "dashboards" });
    if (state) setStep("dashboards");
  };

  const handleGenie = async () => {
    if (!migration) return;
    const state = await runAction(`/api/fabric/migrate/${migration.id}`, { action: "genie" });
    if (state) setStep("genie");
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-8">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Link href="/fabric">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Migration Wizard</h1>
          <p className="text-muted-foreground text-sm">
            Migrate Power BI artifacts to Databricks-native Gold tables, metric views, dashboards,
            and Genie spaces.
          </p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const active = s.key === step;
          const completed = i < currentStepIdx;
          return (
            <div key={s.key} className="flex items-center gap-1">
              {i > 0 && (
                <div
                  className={`h-px w-6 ${completed ? "bg-primary" : "bg-muted-foreground/20"}`}
                />
              )}
              <div
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors
                  ${active ? "bg-primary text-primary-foreground" : completed ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
              >
                {completed ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <Icon className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">{s.label}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Warnings */}
      {migration?.warnings && migration.warnings.length > 0 && (
        <Card className="border-yellow-300 dark:border-yellow-700">
          <CardContent className="pt-4 space-y-1">
            {migration.warnings.map((w, i) => (
              <p
                key={i}
                className="text-xs text-yellow-700 dark:text-yellow-300 flex items-start gap-1.5"
              >
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                {w}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Step content */}
      {step === "config" && (
        <Card>
          <CardHeader>
            <CardTitle>Target Catalog & Schema</CardTitle>
            <CardDescription>
              All Gold tables and artifacts will be created in this location.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Catalog</Label>
                <Input
                  placeholder="e.g. main"
                  value={targetCatalog}
                  onChange={(e) => setTargetCatalog(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Schema</Label>
                <Input
                  placeholder="e.g. gold"
                  value={targetSchema}
                  onChange={(e) => setTargetSchema(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Scan: {scanId || "Not specified"}</p>
            <Button
              onClick={handleStartMigration}
              disabled={loading || !scanId || !targetCatalog.trim() || !targetSchema.trim()}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4 mr-2" />
              )}
              Propose Gold Schema
            </Button>
          </CardContent>
        </Card>
      )}

      {step === "gold" && migration && (
        <GoldSchemaStep
          tables={migration.goldTables}
          rlsWarnings={migration.rlsWarnings ?? []}
          loading={loading}
          onDeploy={handleDeployGold}
          onNext={handleMetricViews}
        />
      )}

      {step === "metrics" && migration && (
        <MetricViewStep
          translations={migration.daxTranslations}
          metricViews={migration.metricViews}
          loading={loading}
          onNext={handleDashboards}
        />
      )}

      {step === "dashboards" && migration && (
        <DashboardStep dashboards={migration.dashboards} loading={loading} onNext={handleGenie} />
      )}

      {step === "genie" && migration && (
        <GenieStep spaces={migration.genieSpaces} completed={migration.status === "completed"} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step Components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: ArtifactStatus }) {
  const variants: Record<
    ArtifactStatus,
    { variant: "default" | "secondary" | "destructive" | "outline"; label: string }
  > = {
    pending: { variant: "outline", label: "Pending" },
    proposed: { variant: "secondary", label: "Proposed" },
    deployed: { variant: "default", label: "Deployed" },
    failed: { variant: "destructive", label: "Failed" },
    skipped: { variant: "outline", label: "Skipped" },
  };
  const cfg = variants[status];
  return (
    <Badge variant={cfg.variant} className="text-xs">
      {cfg.label}
    </Badge>
  );
}

function GoldSchemaStep({
  tables,
  rlsWarnings,
  loading,
  onDeploy,
  onNext,
}: {
  tables: GoldTableProposal[];
  rlsWarnings: RlsWarning[];
  loading: boolean;
  onDeploy: () => void;
  onNext: () => void;
}) {
  const allDeployed = tables.every(
    (t) => t.deployStatus === "deployed" || t.deployStatus === "skipped",
  );
  const hasSensitivityLabels = tables.some((t) => t.sensitivityLabel);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Table2 className="h-5 w-5" />
          Gold Schema ({tables.length} tables)
        </CardTitle>
        <CardDescription>
          Review proposed CREATE TABLE DDL, then deploy to Unity Catalog.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasSensitivityLabels && (
          <Card className="border-blue-200 dark:border-blue-800">
            <CardContent className="pt-4">
              <p className="text-xs text-blue-700 dark:text-blue-300 flex items-start gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                Sensitivity labels detected. Tables with mapped labels will have UC tags applied on
                deployment. Tables with unmapped labels are shown below.
              </p>
            </CardContent>
          </Card>
        )}

        <Accordion type="multiple" className="w-full">
          {tables.map((t) => (
            <AccordionItem key={t.ucTableName} value={t.ucTableName}>
              <AccordionTrigger className="text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{t.ucTableName}</span>
                  <span className="text-xs text-muted-foreground">(was: {t.pbiTableName})</span>
                  <StatusBadge status={t.deployStatus} />
                  {t.sensitivityLabel && (
                    <Badge variant={t.tagDdl ? "secondary" : "outline"} className="text-[10px]">
                      {t.tagDdl ? "Sensitivity: mapped" : "Sensitivity: unmapped"}
                    </Badge>
                  )}
                  {t.error && (
                    <span className="text-xs text-destructive truncate max-w-[200px]">
                      {t.error}
                    </span>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3">
                  <div className="grid grid-cols-4 gap-1 text-xs">
                    <span className="font-semibold text-muted-foreground">PBI Name</span>
                    <span className="font-semibold text-muted-foreground">UC Name</span>
                    <span className="font-semibold text-muted-foreground">PBI Type</span>
                    <span className="font-semibold text-muted-foreground">Spark Type</span>
                    {t.columns.map((c) => (
                      <div key={c.ucName} className="contents text-xs">
                        <span>{c.pbiName}</span>
                        <span className="font-mono">{c.ucName}</span>
                        <span className="text-muted-foreground">{c.pbiType}</span>
                        <span className="text-muted-foreground">{c.sparkType}</span>
                      </div>
                    ))}
                  </div>
                  {t.tagDdl && (
                    <>
                      <Separator />
                      <div className="text-xs">
                        <span className="font-semibold text-muted-foreground">UC Tag DDL:</span>
                        <pre className="mt-1 bg-muted p-2 rounded-md font-mono">{t.tagDdl}</pre>
                      </div>
                    </>
                  )}
                  <Separator />
                  <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-60 font-mono">
                    {t.ddl}
                  </pre>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        {rlsWarnings.length > 0 && (
          <Card className="border-amber-300 dark:border-amber-700">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-amber-600" />
                RLS Security Roles ({rlsWarnings.length})
              </CardTitle>
              <CardDescription className="text-xs">
                The following Power BI row-level security roles were detected. These must be
                manually recreated as Unity Catalog row filters.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {rlsWarnings.map((rls, i) => (
                <div
                  key={i}
                  className="border rounded p-3 text-xs space-y-1.5 bg-amber-50/50 dark:bg-amber-950/20"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{rls.roleName}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {rls.ucTableName}
                    </Badge>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-muted-foreground">
                      PBI table: <span className="font-mono">{rls.pbiTableName}</span>
                    </p>
                    <p className="text-muted-foreground">
                      DAX filter:{" "}
                      <code className="bg-muted px-1 py-0.5 rounded">{rls.filterExpression}</code>
                    </p>
                    {rls.members.length > 0 && (
                      <p className="text-muted-foreground">Members: {rls.members.join(", ")}</p>
                    )}
                  </div>
                  <p className="text-amber-700 dark:text-amber-300">{rls.suggestedAction}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <div className="flex items-center gap-3 pt-2">
          {!allDeployed && (
            <Button onClick={onDeploy} disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Database className="h-4 w-4 mr-2" />
              )}
              Deploy Gold Tables
            </Button>
          )}
          <Button
            onClick={onNext}
            disabled={loading || !tables.some((t) => t.deployStatus === "deployed")}
            variant={allDeployed ? "default" : "outline"}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <ArrowRight className="h-4 w-4 mr-2" />
            )}
            Generate Metric Views
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricViewStep({
  translations,
  metricViews,
  loading,
  onNext,
}: {
  translations: DaxTranslation[];
  metricViews: Array<{ name: string; yaml: string; deployStatus: ArtifactStatus }>;
  loading: boolean;
  onNext: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          DAX Translations & Metric Views
        </CardTitle>
        <CardDescription>
          DAX measures translated to Databricks SQL, then fed into the metric view engine.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {translations.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">
              DAX → SQL Translations ({translations.length})
            </h3>
            <div className="space-y-2 max-h-96 overflow-auto">
              {translations.map((t, i) => (
                <div key={i} className="border rounded p-3 text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <Code2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{t.measureName}</span>
                    <Badge
                      variant={
                        t.confidence === "high"
                          ? "default"
                          : t.confidence === "medium"
                            ? "secondary"
                            : "destructive"
                      }
                      className="text-[10px]"
                    >
                      {t.confidence}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {t.method}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground font-mono">DAX: {t.daxExpression}</p>
                  <p className="font-mono text-primary">SQL: {t.sqlExpression}</p>
                  {t.warnings.map((w, wi) => (
                    <p
                      key={wi}
                      className="text-yellow-600 dark:text-yellow-400 flex items-center gap-1"
                    >
                      <AlertTriangle className="h-3 w-3" />
                      {w}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {metricViews.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Generated Metric Views ({metricViews.length})</h3>
            {metricViews.map((mv, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{mv.name}</span>
                <StatusBadge status={mv.deployStatus} />
              </div>
            ))}
          </div>
        )}

        <Button onClick={onNext} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <ArrowRight className="h-4 w-4 mr-2" />
          )}
          Generate Dashboards
        </Button>
      </CardContent>
    </Card>
  );
}

function DashboardStep({
  dashboards,
  loading,
  onNext,
}: {
  dashboards: Array<{
    name: string;
    id?: string;
    url?: string;
    deployStatus: ArtifactStatus;
    error?: string;
  }>;
  loading: boolean;
  onNext: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LayoutDashboard className="h-5 w-5" />
          Lakeview Dashboards ({dashboards.length})
        </CardTitle>
        <CardDescription>PBI reports converted to Databricks Lakeview dashboards.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {dashboards.length === 0 ? (
          <p className="text-sm text-muted-foreground">No dashboards generated yet.</p>
        ) : (
          <div className="space-y-2">
            {dashboards.map((d, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <LayoutDashboard className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium">{d.name}</span>
                <StatusBadge status={d.deployStatus} />
                {d.url && (
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary underline"
                  >
                    Open
                  </a>
                )}
                {d.error && (
                  <span className="text-xs text-destructive truncate max-w-[200px]">{d.error}</span>
                )}
              </div>
            ))}
          </div>
        )}

        <Button onClick={onNext} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <ArrowRight className="h-4 w-4 mr-2" />
          )}
          Generate Genie Spaces
        </Button>
      </CardContent>
    </Card>
  );
}

function GenieStep({
  spaces,
  completed,
}: {
  spaces: Array<{
    name: string;
    id?: string;
    url?: string;
    deployStatus: ArtifactStatus;
    error?: string;
  }>;
  completed: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          Genie Spaces ({spaces.length})
        </CardTitle>
        <CardDescription>
          Gold tables converted to Databricks Genie spaces for natural language exploration.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {spaces.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Genie spaces generated yet.</p>
        ) : (
          <div className="space-y-2">
            {spaces.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-medium">{s.name}</span>
                <StatusBadge status={s.deployStatus} />
                {s.url && (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary underline"
                  >
                    Open
                  </a>
                )}
                {s.error && (
                  <span className="text-xs text-destructive truncate max-w-[200px]">{s.error}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {completed && (
          <div className="flex items-center gap-2 p-4 bg-green-50 dark:bg-green-950/30 rounded-lg">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <div>
              <p className="text-sm font-semibold text-green-700 dark:text-green-300">
                Migration Complete
              </p>
              <p className="text-xs text-green-600 dark:text-green-400">
                All Databricks-native artifacts have been generated. Power BI assets can now be
                decommissioned.
              </p>
            </div>
          </div>
        )}

        <Link href="/fabric">
          <Button variant="outline">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Fabric Hub
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
